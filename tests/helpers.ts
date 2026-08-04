import type { GameOptions, GameState, Owner, Piece, PieceType } from '../src/engine/types';

let id = 100;

export function piece(
  type: PieceType,
  owner: Owner,
  ring: number,
  idx: number,
  extra: Partial<Piece> = {},
): Piece {
  return { id: id++, type, owner, ring, idx, alive: true, home: { ring, idx }, ...extra };
}

export function makeState(
  pieces: Piece[],
  turn: Owner = 'rojo',
  options: Partial<GameOptions> = {},
): GameState {
  return {
    pieces,
    turn,
    options: { virtudRival: true, ...options },
    canjeUsado: { rojo: false, dorado: false },
    history: [],
    result: null,
  };
}
