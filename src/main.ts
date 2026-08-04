/** App: menú, modos de juego, interacción con el tablero 3D, HUD e historial. */

import reglasMd from '../docs/reglas-el-olimpo.md?raw';
import AiWorkerCtor from './ai/worker?worker&inline';
import { bestMove } from './engine/ai';
import { applyMove, regionCounts, scoreByRegions } from './engine/apply';
import { newGame } from './engine/setup';
import { cangeoOptions, canSelect, pieceAt, pieceDests } from './engine/rules';
import type { GameResult, GameState, Move, MoveDest, Owner, Piece } from './engine/types';
import { PIECE_NAMES } from './engine/types';
import { mdToHtml } from './ui/markdown';
import { Board3D, type BoardStyle } from './ui3d/board3d';
import { makeIcons, type IconMap } from './ui3d/pieces3d';
import { isMuted, setMuted, sfx } from './ui3d/sound';

type Mode = 'ai' | 'hotseat';
const HUMAN: Owner = 'rojo';
const SAVE_KEY = 'el-olimpo-partida';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let state: GameState;
let mode: Mode = 'hotseat';
let difficulty = 2;
let thinking = false;
let selected: Piece | null = null;
let dests: MoveDest[] = [];
let lastMove: { ring: number; idx: number }[] | null = null;

const STYLE_KEY = 'el-olimpo-estilo';

function storedStyle(): BoardStyle {
  try {
    return localStorage.getItem(STYLE_KEY) === 'moderno' ? 'moderno' : 'lamina';
  } catch {
    return 'lamina';
  }
}

/**
 * El tablero 3D y los iconos se crean recién al entrar a una partida: así el
 * menú funciona siempre, aun si WebGL falla o tarda (clave en mobile), y el
 * error se puede mostrar en pantalla en vez de matar todo el script.
 */
let board: Board3D | null = null;
let icons: IconMap = new Map();

function ensureGraphics(style: BoardStyle): boolean {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {
    /* sin almacenamiento */
  }
  try {
    if (icons.size === 0) {
      icons = makeIcons();
      buildLegend();
    }
    if (board && board.style !== style) {
      board.dispose();
      board = null;
    }
    if (!board) {
      board = new Board3D($('boardWrap'), style);
      attachBoardInput();
      resize();
    }
    return true;
  } catch (err) {
    console.error('No se pudo iniciar el tablero 3D:', err);
    showBanner('No se pudo iniciar el tablero 3D (¿WebGL deshabilitado?). Probá con otro navegador.', true);
    return false;
  }
}

const aiWorker: Worker | null = (() => {
  try {
    return new AiWorkerCtor();
  } catch {
    return null;
  }
})();

/* ---------- tamaño ---------- */

function resize(): void {
  const sideRoom = window.innerWidth > 900 ? 270 : 0;
  const maxW = Math.min(window.innerWidth - 32 - sideRoom, 760);
  const maxH = window.innerHeight - 190;
  const size = Math.max(300, Math.min(maxW, maxH));
  const wrap = $('boardWrap');
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  board?.resize(size);
}

function refreshMarkers(): void {
  board?.updateMarkers(selected, dests, lastMove);
}

/* ---------- HUD / historial ---------- */

function icon(type: Piece['type'], owner: Owner, title = ''): string {
  return `<img src="${icons.get(type + '-' + owner) ?? ''}" alt="${PIECE_NAMES[type]}" title="${title || PIECE_NAMES[type]}">`;
}

function updateHud(): void {
  const pill = $('turnPill');
  if (thinking) {
    pill.textContent = 'La IA está pensando…';
    pill.classList.add('pensando');
  } else {
    pill.textContent = 'Turno: ' + state.turn.toUpperCase();
    pill.classList.remove('pensando');
  }
  pill.style.color = state.turn === 'rojo' ? '#8f2c2c' : '#7a5a12';
  const counts = regionCounts(state);
  $('regRojo').textContent = String(counts.rojo);
  $('regDorado').textContent = String(counts.dorado);

  const lost = (owner: Owner) =>
    state.pieces
      .filter((p) => !p.alive && p.owner === owner)
      .map((p) => icon(p.type, p.owner))
      .join('') || '—';
  $('lostRojo').innerHTML = lost('rojo');
  $('lostDorado').innerHTML = lost('dorado');

  const cangeoBtn = $('btnCangeo');
  const humanTurn = mode === 'hotseat' || state.turn === HUMAN;
  const opts = !state.result && humanTurn && !thinking ? cangeoOptions(state, state.turn) : [];
  cangeoBtn.hidden = opts.length === 0;

  const hist = $('history');
  hist.innerHTML = state.history
    .map((h) => `<li class="${h.owner}"><b>${h.owner}</b>: ${h.text}</li>`)
    .join('');
  hist.scrollTop = hist.scrollHeight;
}

let bannerTimer: number | undefined;
function showBanner(text: string, sticky = false): void {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  window.clearTimeout(bannerTimer);
  if (!sticky) bannerTimer = window.setTimeout(() => (b.hidden = true), 5500);
}

function resultText(r: GameResult): string {
  if (r.type === 'eliminacion') {
    return `¡Gana el bando ${r.winner.toUpperCase()}! El rival perdió todas sus piezas.`;
  }
  if (r.winner) {
    return `Fin de la partida: ${r.winner.toUpperCase()} ocupa más Regiones (${r.rojo} vs ${r.dorado}). ¡Victoria!`;
  }
  return `Fin de la partida: empate en Regiones (${r.rojo} a ${r.dorado}). ¡Tablas!`;
}

function announceResult(r: GameResult): void {
  showBanner(resultText(r), true);
  if (r.type === 'eliminacion' || r.winner) sfx.win();
  else sfx.draw();
}

/* ---------- persistencia ---------- */

function save(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ state, mode, difficulty }));
  } catch {
    /* almacenamiento no disponible: se juega sin guardar */
  }
}

function loadSave(): { state: GameState; mode: Mode; difficulty: number } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.state?.pieces) return null;
    return data;
  } catch {
    return null;
  }
}

/* ---------- flujo de juego ---------- */

function execMove(move: Move): void {
  const targetId =
    move.kind === 'move'
      ? (pieceAt(state, move.to)?.id ?? null)
      : null;
  applyMove(state, move);
  selected = null;
  dests = [];
  save();

  const b = board;
  let anim: Promise<void>;
  if (move.kind === 'move') {
    lastMove = [{ ring: move.to.ring, idx: move.to.idx }];
    if (targetId !== null) sfx.capture();
    else sfx.move();
    anim = b ? b.animateMove(move.pieceId, move.to, targetId) : Promise.resolve();
  } else {
    lastMove = null;
    sfx.cangeo();
    const last = state.history[state.history.length - 1];
    const db = state.pieces.find((p) => p.type === 'DB' && p.alive && last?.owner === p.owner);
    anim = b
      ? b.animateCangeo(db?.id ?? -1, db ? { ring: db.ring, idx: db.idx } : { ring: 0, idx: 0 }, move.sacrificeIds)
      : Promise.resolve();
  }
  refreshMarkers();
  updateHud();
  void anim.then(() => {
    b?.syncPieces(state);
    afterMove();
  });
}

function afterMove(): void {
  updateHud();
  refreshMarkers();
  if (state.result) {
    announceResult(state.result);
    return;
  }
  if (mode === 'ai' && state.turn !== HUMAN) {
    aiTurn();
  }
}

function aiTurn(): void {
  thinking = true;
  updateHud();
  if (aiWorker) {
    aiWorker.postMessage({ state, depth: difficulty });
  } else {
    window.setTimeout(() => onAiMove(bestMove(state, difficulty)), 60);
  }
}

function onAiMove(move: Move | null): void {
  thinking = false;
  if (!move) {
    state.result = scoreByRegions(state);
    updateHud();
    announceResult(state.result);
    return;
  }
  execMove(move);
}

if (aiWorker) {
  aiWorker.onmessage = (e: MessageEvent<Move | null>) => onAiMove(e.data);
  aiWorker.onerror = () => {
    aiWorker.terminate();
    if (thinking) window.setTimeout(() => onAiMove(bestMove(state, difficulty)), 60);
  };
}

/* ---------- interacción ---------- */

function attachBoardInput(): void {
  if (!board) return;
  board.domElement.addEventListener('pointerdown', onBoardPointerDown);
  board.domElement.addEventListener('pointermove', onBoardPointerMove);
}

function onBoardPointerDown(ev: PointerEvent): void {
  if (!board || !state || state.result || thinking || board.animating) return;
  if (mode === 'ai' && state.turn !== HUMAN) return;
  if (ev.button !== 0) return;
  const cell = board.pick(ev.clientX, ev.clientY);
  if (!cell) {
    selected = null;
    dests = [];
    refreshMarkers();
    return;
  }
  if (selected) {
    let dest = dests.find((d) => d.ring === cell.ring && d.idx === cell.idx);
    if (!dest) {
      // el rayo pudo chocar con una pieza que tapa la casilla de destino:
      // reintentar mirando solo las losetas
      const tileCell = board.pick(ev.clientX, ev.clientY, true);
      if (tileCell) dest = dests.find((d) => d.ring === tileCell.ring && d.idx === tileCell.idx);
    }
    if (dest) {
      execMove({ kind: 'move', pieceId: selected.id, to: { ring: dest.ring, idx: dest.idx } });
      return;
    }
  }
  const p = pieceAt(state, cell);
  if (p && canSelect(state, p, state.turn)) {
    selected = p;
    dests = pieceDests(state, p);
    sfx.select();
  } else {
    selected = null;
    dests = [];
  }
  refreshMarkers();
}

// cursor contextual sobre piezas seleccionables y destinos legales
let hoverPending = false;
function onBoardPointerMove(ev: PointerEvent): void {
  if (hoverPending) return;
  hoverPending = true;
  requestAnimationFrame(() => {
    hoverPending = false;
    if (!board) return;
    if (!state || state.result || thinking) {
      board.domElement.style.cursor = 'grab';
      return;
    }
    const cell = board.pick(ev.clientX, ev.clientY);
    let pointer = false;
    if (cell) {
      if (dests.some((d) => d.ring === cell.ring && d.idx === cell.idx)) pointer = true;
      else {
        const p = pieceAt(state, cell);
        pointer = !!p && canSelect(state, p, state.turn);
      }
    }
    board.domElement.style.cursor = pointer ? 'pointer' : 'grab';
  });
}

/* ---------- cangeo ---------- */

$('btnCangeo').addEventListener('click', () => {
  const opts = cangeoOptions(state, state.turn);
  if (opts.length === 0) return;
  let chosen = opts[0];
  if (opts.length > 1) {
    const quiere = window.confirm(
      'Cangear el Diablo:\n\nAceptar = sacrificar un Ídolo y un Cura\nCancelar = sacrificar dos Curas y un Pontífice',
    );
    chosen = quiere ? opts.find((o) => o.combo === 'ID+CU')! : opts.find((o) => o.combo === '2CU+PO')!;
  } else {
    const names = chosen.combo === 'ID+CU' ? 'un Ídolo y un Cura' : 'dos Curas y un Pontífice';
    if (!window.confirm(`Cangear el Diablo sacrificando ${names}. ¿Confirmás?`)) return;
  }
  execMove({ kind: 'cangeo', combo: chosen.combo, sacrificeIds: chosen.sacrificeIds });
});

/* ---------- botones ---------- */

function startGame(m: Mode, resume?: { state: GameState; difficulty: number }): void {
  mode = m;
  if (!ensureGraphics(($('boardStyle') as HTMLSelectElement).value as BoardStyle)) return;
  if (resume) {
    state = resume.state;
    difficulty = resume.difficulty;
  } else {
    difficulty = Number(($('difficulty') as HTMLSelectElement).value);
    state = newGame({ virtudRival: ($('optVirtudRival') as HTMLInputElement).checked });
    save();
  }
  selected = null;
  dests = [];
  lastMove = null;
  thinking = false;
  $('menu').hidden = true;
  $('game').hidden = false;
  $('banner').hidden = true;
  resize();
  board?.syncPieces(state);
  refreshMarkers();
  updateHud();
  if (state.result) showBanner(resultText(state.result), true);
  else if (mode === 'ai' && state.turn !== HUMAN) aiTurn();
}

document.querySelectorAll<HTMLButtonElement>('.mode-btn[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startGame(btn.dataset.mode as Mode));
});

$('btnContinue').addEventListener('click', () => {
  const data = loadSave();
  if (data) startGame(data.mode, { state: data.state, difficulty: data.difficulty });
});

$('btnScore').addEventListener('click', () => {
  if (state.result) return;
  if (!window.confirm('¿Terminar la partida y contar las Regiones ocupadas?')) return;
  state.result = scoreByRegions(state);
  save();
  updateHud();
  announceResult(state.result);
});

$('btnMenu').addEventListener('click', () => {
  $('game').hidden = true;
  $('banner').hidden = true;
  $('menu').hidden = false;
  refreshContinue();
});

const soundBtn = $('btnSound');
function refreshSoundBtn(): void {
  soundBtn.textContent = isMuted() ? '🔇' : '🔊';
  soundBtn.title = isMuted() ? 'Activar sonido' : 'Silenciar';
}
soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  refreshSoundBtn();
});
refreshSoundBtn();

/* ---------- reglas ---------- */

const rulesModal = $('rulesModal');
$('rulesContent').innerHTML = mdToHtml(reglasMd);
const openRules = (e: Event) => {
  e.preventDefault();
  rulesModal.hidden = false;
};
$('btnRules').addEventListener('click', openRules);
$('verReglas1').addEventListener('click', openRules);
$('btnCloseRules').addEventListener('click', () => (rulesModal.hidden = true));
rulesModal.addEventListener('click', (e) => {
  if (e.target === rulesModal) rulesModal.hidden = true;
});

/* ---------- arranque ---------- */

function refreshContinue(): void {
  const data = loadSave();
  $('btnContinue').hidden = !data || !!data.state.result;
}

function buildLegend(): void {
  const types = ['VI', 'ID', 'PO', 'PU', 'CU', 'DB'] as const;
  $('pieceLegend').innerHTML = types
    .map((t) => `<span>${icon(t, 'dorado')}${PIECE_NAMES[t]}</span>`)
    .join('');
}

window.addEventListener('resize', resize);
($('boardStyle') as HTMLSelectElement).value = storedStyle();
refreshContinue();

// hook de inspección para depurar desde la consola del navegador
Object.defineProperty(window, '__olimpo', {
  get: () => ({ state, selected, dests, mode, difficulty, thinking, board, fn: { pieceDests, canSelect } }),
});
