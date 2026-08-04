/**
 * Posición inicial según las reglas de 1891: cada jugador acomoda su ejército
 * en su mitad del tablero, separado del rival por la Meridiana.
 * 37 piezas en total (18 por bando + la Divinidad central, que en el motor
 * no ocupa casilla de la grilla: es el centro, intocable e inamovible).
 */

import { AVERNO, EJERCITO_RING, IDOLOS_RING, RING_SIZES, TIEMPO, mod } from './board';
import type { GameOptions, GameState, Owner, Piece, PieceType } from './types';

let nextId = 0;

function make(type: PieceType, owner: Owner, ring: number, idx: number): Piece {
  idx = mod(idx, RING_SIZES[ring]);
  return { id: nextId++, type, owner, ring, idx, alive: true, home: { ring, idx } };
}

export function initialPieces(): Piece[] {
  nextId = 0;
  const pieces: Piece[] = [];
  // Mitades: rojo ocupa los índices bajos (sur), dorado los altos (norte).
  const halves: { owner: Owner; base: number }[] = [
    { owner: 'rojo', base: 0 },
    { owner: 'dorado', base: 1 }, // base*  (n/2) por anillo
  ];
  for (const h of halves) {
    const off = (ring: number) => (h.base * RING_SIZES[ring]) / 2;
    // Diablo: centro de su mitad del Averno (12 casillas -> 6 por mitad).
    pieces.push(make('DB', h.owner, AVERNO, off(AVERNO) + 3));
    // Ídolos: 3 repartidos en su mitad del anillo de Ídolos (12 casillas por mitad).
    for (const i of [2, 6, 10]) pieces.push(make('ID', h.owner, IDOLOS_RING, off(IDOLOS_RING) + i));
    // Virtudes: descansan alternadas en el Tiempo (6 casillas por mitad).
    for (const i of [1, 3, 5]) pieces.push(make('VI', h.owner, TIEMPO, off(TIEMPO) + i));
    // Ejército: 11 piezas en su mitad del anillo exterior de Pasiones,
    // con el Pontífice "papa" en el centro (orden tomado del prototipo).
    const order: PieceType[] = ['CU', 'CU', 'PO', 'CU', 'PU', 'PO', 'PU', 'CU', 'PO', 'CU', 'CU'];
    order.forEach((t, i) => pieces.push(make(t, h.owner, EJERCITO_RING, off(EJERCITO_RING) + 1 + i)));
  }
  return pieces;
}

export function newGame(options: GameOptions, first: Owner = 'rojo'): GameState {
  return {
    pieces: initialPieces(),
    turn: first,
    options,
    cangeoUsado: { rojo: false, dorado: false },
    history: [],
    result: null,
  };
}
