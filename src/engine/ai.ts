/**
 * IA: minimax con poda alfa-beta sobre el motor de reglas.
 * Profundidad configurable = nivel de dificultad (1 fácil, 2 medio, 3 difícil).
 *
 * La evaluación es material + ocupación de Regiones + un leve gradiente de
 * avance hacia el centro. La seguridad del Diablo no necesita término
 * estático: con profundidad >= 2 la búsqueda ve la captura del Diablo en la
 * respuesta rival y la evita sola.
 */

import { REGIONES, TIEMPO } from './board';
import { applyMove, cloneState } from './apply';
import { allMoves, pieceAt } from './rules';
import type { GameState, Move, Owner, PieceType } from './types';

export const PIECE_VALUES: Record<PieceType, number> = {
  DI: 0,
  CU: 10,
  PU: 20,
  VI: 25,
  PO: 35,
  ID: 45,
  DB: 120,
};

/** La victoria "más valiosa" ocupa Regiones con Virtudes: bonus extra. */
const REGION_BONUS: Partial<Record<PieceType, number>> = {
  VI: 45,
  ID: 32,
  PU: 30,
  PO: 28,
  CU: 26,
  DB: 26,
};

export function evaluate(state: GameState, me: Owner): number {
  let score = 0;
  for (const p of state.pieces) {
    if (!p.alive || p.type === 'DI') continue;
    const sign = p.owner === me ? 1 : -1;
    let v = PIECE_VALUES[p.type];
    if (p.ring === REGIONES) v += REGION_BONUS[p.type] ?? 25;
    else if (p.ring === TIEMPO && p.type !== 'VI') v += 6;
    else if (p.type !== 'VI' && p.type !== 'DB') v += (6 - p.ring) * 1.2; // avance suave hacia el centro
    score += sign * v;
  }
  return score;
}

function terminalScore(state: GameState, me: Owner, ply: number): number | null {
  if (!state.result) return null;
  if (state.result.type === 'eliminacion') {
    return state.result.winner === me ? 100000 - ply : -100000 + ply;
  }
  const diff = state.result.rojo - state.result.dorado;
  const myDiff = me === 'rojo' ? diff : -diff;
  return myDiff * 1000;
}

function orderedMoves(state: GameState, owner: Owner): Move[] {
  // La IA no usa la cortesía de mover Virtudes rivales: no la ayuda a ganar
  // y multiplica el árbol de búsqueda.
  const moves = allMoves(state, owner, { includeRivalVirtudes: false });
  const keyOf = (m: Move): number => {
    if (m.kind === 'cangeo') return 60;
    const target = pieceAt(state, m.to);
    if (target) return 100 + PIECE_VALUES[target.type];
    return m.to.ring === REGIONES ? 40 : 0;
  };
  return moves
    .map((m) => ({ m, k: keyOf(m) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.m);
}

function negamax(state: GameState, depth: number, alpha: number, beta: number, me: Owner, ply: number): number {
  const term = terminalScore(state, me, ply);
  if (term !== null) return term;
  if (depth === 0) return evaluate(state, me);

  const maximizing = state.turn === me;
  const moves = orderedMoves(state, state.turn);
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const child = cloneState(state);
    applyMove(child, move, true);
    const val = negamax(child, depth - 1, alpha, beta, me, ply + 1);
    if (maximizing) {
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
    } else {
      best = Math.min(best, val);
      beta = Math.min(beta, val);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function bestMove(state: GameState, depth: number, rng: () => number = Math.random): Move | null {
  const me = state.turn;
  const moves = orderedMoves(state, me);
  if (moves.length === 0) return null;
  let best: Move[] = [];
  let bestVal = -Infinity;
  for (const move of moves) {
    const child = cloneState(state);
    applyMove(child, move, true);
    const val = negamax(child, depth - 1, -Infinity, Infinity, me, 1);
    if (val > bestVal + 1e-9) {
      bestVal = val;
      best = [move];
    } else if (Math.abs(val - bestVal) <= 1e-9) {
      best.push(move);
    }
  }
  return best[Math.floor(rng() * best.length)];
}
