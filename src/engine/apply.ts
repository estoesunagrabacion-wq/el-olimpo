/** Aplicación de jugadas, detección de fin de partida y conteo de Regiones. */

import { REGIONES, cellLabel } from './board';
import { getPiece, hasAnyMove, isLegal, pieceAt } from './rules';
import type { GameResult, GameState, Move, Owner, Piece } from './types';
import { PIECE_NAMES, otherOwner } from './types';

/** Clon superficial pero suficiente: las piezas se copian una a una. */
export function cloneState(state: GameState): GameState {
  return {
    pieces: state.pieces.map((p) => ({ ...p, home: { ...p.home } })),
    turn: state.turn,
    options: { ...state.options },
    canjeUsado: { ...state.canjeUsado },
    history: state.history, // la historia no se muta en la búsqueda; se reemplaza al aplicar de verdad
    result: state.result,
  };
}

export interface ApplyInfo {
  captured: Piece | null;
  text: string;
}

/**
 * Aplica una jugada legal MUTANDO el estado, pasa el turno y evalúa el fin
 * de partida. Con `quiet` no escribe historia (para la búsqueda de la IA).
 */
export function applyMove(state: GameState, move: Move, quiet = false): ApplyInfo {
  if (!isLegal(state, move)) throw new Error('jugada ilegal: ' + JSON.stringify(move));
  const mover = state.turn;
  let captured: Piece | null = null;
  let text: string;

  if (move.kind === 'canje') {
    const db = state.pieces.find((p) => p.type === 'DB' && p.owner === mover)!;
    for (const id of move.sacrificeIds) getPiece(state, id).alive = false;
    db.alive = true;
    db.ring = db.home.ring;
    db.idx = db.home.idx;
    state.canjeUsado[mover] = true;
    const names = move.sacrificeIds.map((id) => PIECE_NAMES[getPiece(state, id).type]).join(' + ');
    text = `canjea su Diablo (sacrifica ${names}); reaparece en ${cellLabel(db.home)}`;
  } else {
    const piece = getPiece(state, move.pieceId);
    const from = cellLabel({ ring: piece.ring, idx: piece.idx });
    const target = pieceAt(state, move.to);
    if (target) {
      target.alive = false;
      captured = target;
    }
    piece.ring = move.to.ring;
    piece.idx = move.to.idx;
    const ajena = piece.owner !== mover ? ` (${PIECE_NAMES.VI} ${piece.owner})` : '';
    text = target
      ? `${PIECE_NAMES[piece.type]} ${from} × ${PIECE_NAMES[target.type]} en ${cellLabel(move.to)}`
      : `${PIECE_NAMES[piece.type]}${ajena} ${from} → ${cellLabel(move.to)}`;
  }

  if (!quiet) {
    state.history = [...state.history, { n: state.history.length + 1, owner: mover, text }];
  }
  state.turn = otherOwner(mover);
  state.result = evaluateEnd(state);
  return { captured, text };
}

export function regionCounts(state: GameState): Record<Owner, number> {
  const counts: Record<Owner, number> = { rojo: 0, dorado: 0 };
  for (const p of state.pieces) {
    if (p.alive && p.ring === REGIONES) counts[p.owner]++;
  }
  return counts;
}

/** Resultado por conteo de Regiones (fin acordado o sin jugadas). */
export function scoreByRegions(state: GameState): GameResult {
  const { rojo, dorado } = regionCounts(state);
  const winner = rojo > dorado ? 'rojo' : dorado > rojo ? 'dorado' : null;
  return { type: 'regiones', winner, rojo, dorado };
}

/**
 * Fin automático: un bando sin piezas pierde; un bando sin jugadas legales
 * termina la partida y se cuentan las Regiones ocupadas.
 */
export function evaluateEnd(state: GameState): GameResult | null {
  for (const owner of ['rojo', 'dorado'] as Owner[]) {
    if (!state.pieces.some((p) => p.alive && p.owner === owner)) {
      return { type: 'eliminacion', winner: otherOwner(owner) };
    }
  }
  if (!hasAnyMove(state, state.turn)) {
    return scoreByRegions(state);
  }
  return null;
}
