/** Tipos compartidos del motor de reglas. Sin dependencias de DOM. */

export type Owner = 'rojo' | 'dorado';
export type PieceType = 'DI' | 'VI' | 'ID' | 'PO' | 'PU' | 'CU' | 'DB';

export interface Cell {
  ring: number; // 0..6 (ver board.ts); la Divinidad central queda fuera de la grilla
  idx: number;
}

export interface Piece {
  id: number;
  type: PieceType;
  owner: Owner;
  ring: number;
  idx: number;
  alive: boolean;
  /** Casilla de origen (usada por el cangeo del Diablo). */
  home: Cell;
}

export interface GameOptions {
  /**
   * Regla original de 1891: un jugador puede mover una Virtud del rival
   * para salvarla si está amenazada.
   */
  virtudRival: boolean;
}

export interface MoveDest extends Cell {
  capture: boolean;
}

export type Move =
  | { kind: 'move'; pieceId: number; to: Cell }
  | { kind: 'cangeo'; combo: 'ID+CU' | '2CU+PO'; sacrificeIds: number[] };

export interface HistoryEntry {
  n: number;
  owner: Owner;
  text: string;
}

export type GameResult =
  | { type: 'eliminacion'; winner: Owner }
  | { type: 'regiones'; winner: Owner | null; rojo: number; dorado: number };

export interface GameState {
  pieces: Piece[];
  turn: Owner;
  options: GameOptions;
  cangeoUsado: Record<Owner, boolean>;
  history: HistoryEntry[];
  result: GameResult | null;
}

export const PIECE_NAMES: Record<PieceType, string> = {
  DI: 'Divinidad',
  VI: 'Virtud',
  ID: 'Ídolo',
  PO: 'Pontífice',
  PU: 'Pueblo',
  CU: 'Cura',
  DB: 'Diablo',
};

export function otherOwner(o: Owner): Owner {
  return o === 'rojo' ? 'dorado' : 'rojo';
}
