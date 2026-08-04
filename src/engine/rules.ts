/**
 * Reglas de movimiento y captura, según docs/reglas-el-olimpo.md.
 *
 * Interpretaciones (heredadas del prototipo, documentadas como decisión):
 *  - Distancias "avanza N" se leen como "hasta N" (puede avanzar 1..N).
 *  - Las piezas con alcance >1 saltan: no importa si hay piezas en el medio;
 *    la captura ocurre solo en la casilla de destino.
 *  - El Averno es territorio exclusivo de los Diablos: ninguna otra pieza
 *    puede entrar (los Diablos de ambos bandos sí).
 *  - La Divinidad central no es casilla de la grilla: nadie la ocupa.
 */

import {
  AVERNO,
  REGIONES,
  TIEMPO,
  allNeighbors,
  cellKey,
  diagonalStep,
  lateral,
  radialReach,
  sameCell,
} from './board';
import type { Cell, GameState, Move, MoveDest, Owner, Piece } from './types';
import { otherOwner } from './types';

export function pieceAt(state: GameState, cell: Cell): Piece | null {
  for (const p of state.pieces) {
    if (p.alive && p.ring === cell.ring && p.idx === cell.idx) return p;
  }
  return null;
}

export function getPiece(state: GameState, id: number): Piece {
  const p = state.pieces.find((q) => q.id === id);
  if (!p) throw new Error('pieza inexistente: ' + id);
  return p;
}

function canEnter(piece: Piece, cell: Cell): boolean {
  if (cell.ring === AVERNO) return piece.type === 'DB';
  if (piece.type === 'VI') return cell.ring === REGIONES || cell.ring === TIEMPO;
  return true;
}

/**
 * Destinos legales de una pieza (sin considerar de quién es el turno).
 * `capture: true` marca los destinos que capturan una pieza rival.
 */
export function pieceDests(state: GameState, piece: Piece): MoveDest[] {
  if (!piece.alive || piece.type === 'DI') return [];
  const res: MoveDest[] = [];
  const seen = new Set<string>();

  type Opt = { onlyEmpty?: boolean; onlyCapture?: boolean };
  const tryDest = (cell: Cell, opt: Opt = {}) => {
    if (!canEnter(piece, cell)) return;
    const k = cellKey(cell);
    if (seen.has(k)) return;
    const occ = pieceAt(state, cell);
    if (occ && occ.owner === piece.owner) return;
    if (occ && piece.type === 'VI') return; // la Virtud jamás captura
    if (opt.onlyEmpty && occ) return;
    if (opt.onlyCapture && !occ) return;
    seen.add(k);
    res.push({ ...cell, capture: !!occ });
  };

  const cur: Cell = { ring: piece.ring, idx: piece.idx };

  switch (piece.type) {
    case 'VI': {
      // Una casilla en cualquier dirección, solo dentro de Regiones y Tiempo,
      // solo a casilla vacía.
      for (const nb of allNeighbors(cur)) tryDest(nb, { onlyEmpty: true });
      break;
    }
    case 'ID': {
      // Hasta 2 de frente/atrás, hasta 3 de costado.
      for (const dir of [-1, 1] as const) for (const c of radialReach(cur, dir, 2)) tryDest(c);
      for (const d of [-3, -2, -1, 1, 2, 3]) tryDest(lateral(cur, d));
      break;
    }
    case 'PO': {
      // 1 de frente/atrás, hasta 2 de costado.
      for (const dir of [-1, 1] as const) for (const c of radialReach(cur, dir, 1)) tryDest(c);
      for (const d of [-2, -1, 1, 2]) tryDest(lateral(cur, d));
      break;
    }
    case 'PU': {
      // Camina 1 en línea recta (radial o lateral) solo a casilla vacía;
      // captura a 1 en cualquier dirección (como el peón: camina derecho,
      // come al sesgo).
      for (const dir of [-1, 1] as const) for (const c of radialReach(cur, dir, 1)) tryDest(c, { onlyEmpty: true });
      for (const d of [-1, 1]) tryDest(lateral(cur, d), { onlyEmpty: true });
      for (const nb of allNeighbors(cur)) tryDest(nb, { onlyCapture: true });
      break;
    }
    case 'CU': {
      // Siempre en diagonal, 1 casilla; mueve o captura.
      for (const dir of [-1, 1] as const) for (const c of diagonalStep(cur, dir)) tryDest(c);
      break;
    }
    case 'DB': {
      // Hasta 3 de frente/atrás y 4 de costado; dentro del Averno, solo 2 y 2.
      const inAverno = piece.ring === AVERNO;
      const maxR = inAverno ? 2 : 3;
      const maxS = inAverno ? 2 : 4;
      for (const dir of [-1, 1] as const) for (const c of radialReach(cur, dir, maxR)) tryDest(c);
      for (let d = 1; d <= maxS; d++) {
        tryDest(lateral(cur, d));
        tryDest(lateral(cur, -d));
      }
      break;
    }
  }
  return res;
}

/** ¿Alguna pieza (de cualquier bando, o de `by` si se indica) amenaza esta casilla? */
export function isCellThreatened(state: GameState, cell: Cell, by?: Owner): boolean {
  for (const p of state.pieces) {
    if (!p.alive || p.type === 'VI' || p.type === 'DI') continue;
    if (by && p.owner !== by) continue;
    const occ = pieceAt(state, cell);
    if (occ && occ.owner === p.owner) continue;
    for (const d of pieceDests(state, p)) {
      if (d.ring === cell.ring && d.idx === cell.idx) return true;
    }
  }
  return false;
}

export interface CanjeOption {
  combo: 'ID+CU' | '2CU+PO';
  sacrificeIds: number[];
}

/**
 * Canje del Diablo: si el Diablo propio murió, una vez por partida puede
 * canjearse por (un Ídolo + un Cura) o (dos Curas + un Pontífice) vivos,
 * y reaparece en su casilla original del Averno (que debe estar libre).
 */
export function canjeOptions(state: GameState, owner: Owner): CanjeOption[] {
  if (state.canjeUsado[owner]) return [];
  const db = state.pieces.find((p) => p.type === 'DB' && p.owner === owner);
  if (!db || db.alive) return [];
  if (pieceAt(state, db.home)) return [];
  const alive = (t: string) => state.pieces.filter((p) => p.alive && p.owner === owner && p.type === t);
  const out: CanjeOption[] = [];
  const ids = alive('ID');
  const cus = alive('CU');
  const pos = alive('PO');
  if (ids.length >= 1 && cus.length >= 1) out.push({ combo: 'ID+CU', sacrificeIds: [ids[0].id, cus[0].id] });
  if (cus.length >= 2 && pos.length >= 1) out.push({ combo: '2CU+PO', sacrificeIds: [cus[0].id, cus[1].id, pos[0].id] });
  return out;
}

/**
 * Todas las jugadas legales de un bando (movimientos + canje).
 * Con la opción `virtudRival` activa incluye mover una Virtud del rival,
 * solo si está amenazada (para salvarla, como dice el texto original).
 */
export function allMoves(
  state: GameState,
  owner: Owner,
  opts: { includeRivalVirtudes?: boolean } = {},
): Move[] {
  const includeRival = opts.includeRivalVirtudes ?? true;
  const out: Move[] = [];
  for (const p of state.pieces) {
    if (!p.alive || p.type === 'DI') continue;
    let movable = p.owner === owner;
    if (!movable && includeRival && state.options.virtudRival && p.type === 'VI') {
      movable = isCellThreatened(state, { ring: p.ring, idx: p.idx }, owner) ||
        isCellThreatened(state, { ring: p.ring, idx: p.idx }, otherOwner(owner));
    }
    if (!movable) continue;
    for (const d of pieceDests(state, p)) {
      out.push({ kind: 'move', pieceId: p.id, to: { ring: d.ring, idx: d.idx } });
    }
  }
  for (const c of canjeOptions(state, owner)) {
    out.push({ kind: 'canje', combo: c.combo, sacrificeIds: c.sacrificeIds });
  }
  return out;
}

/** ¿Tiene el bando al menos una jugada legal? (corta en la primera que encuentra) */
export function hasAnyMove(state: GameState, owner: Owner): boolean {
  for (const p of state.pieces) {
    if (!p.alive || p.type === 'DI' || p.owner !== owner) continue;
    if (pieceDests(state, p).length > 0) return true;
  }
  if (canjeOptions(state, owner).length > 0) return true;
  if (state.options.virtudRival) {
    for (const p of state.pieces) {
      if (!p.alive || p.type !== 'VI' || p.owner === owner) continue;
      if (
        isCellThreatened(state, { ring: p.ring, idx: p.idx }) &&
        pieceDests(state, p).length > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

/** ¿Puede este jugador mover esta pieza en su turno? (para la UI) */
export function canSelect(state: GameState, piece: Piece, owner: Owner): boolean {
  if (!piece.alive || piece.type === 'DI') return false;
  if (piece.owner === owner) return true;
  if (state.options.virtudRival && piece.type === 'VI') {
    return isCellThreatened(state, { ring: piece.ring, idx: piece.idx });
  }
  return false;
}

export function isLegal(state: GameState, move: Move): boolean {
  if (move.kind === 'canje') {
    return canjeOptions(state, state.turn).some((c) => c.combo === move.combo);
  }
  const piece = getPiece(state, move.pieceId);
  if (!canSelect(state, piece, state.turn)) return false;
  return pieceDests(state, piece).some((d) => sameCell(d, move.to));
}
