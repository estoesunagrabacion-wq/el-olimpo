/**
 * Tablero del build liviano: canvas 2D, sin three.js ni WebGL.
 *
 * Sustituye a `boardimpl.ts` mediante un alias en `vite.liviano.config.ts`.
 * Expone la misma superficie, así que `main.ts` no distingue cuál está usando.
 */

import { Board2D } from './ui/board2d';
import type { BoardView, IconMap } from './ui/boardview';
import { tokenDataUri } from './ui/sprites';
import type { Owner, PieceType } from './engine/types';

export type BoardStyle = 'liviano';
export type { IconMap };

/** Un solo estilo: la app oculta el selector cuando hay menos de dos. */
export const BOARD_STYLES: { value: BoardStyle; label: string }[] = [
  { value: 'liviano', label: 'Tablero plano' },
];

export function createBoard(container: HTMLElement): BoardView {
  return new Board2D(container);
}

/**
 * Los iconos del build completo se obtienen renderizando cada pieza en WebGL;
 * acá se usan los mismos medallones SVG que dibuja el tablero, que además
 * pesan nada y no necesitan contexto gráfico.
 */
export function makeIcons(): IconMap {
  const map: IconMap = new Map();
  const types: PieceType[] = ['VI', 'ID', 'PO', 'PU', 'CU', 'DB'];
  const owners: Owner[] = ['rojo', 'dorado'];
  for (const t of types) {
    for (const o of owners) map.set(t + '-' + o, tokenDataUri(t, o));
  }
  return map;
}
