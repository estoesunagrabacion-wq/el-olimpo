/**
 * Tablero del build completo: la escena 3D con three.js.
 *
 * `main.ts` importa el tablero siempre desde acá y nunca desde `ui3d/`, así el
 * build liviano puede sustituir este módulo por `boardimpl.liviano.ts` con un
 * alias de Vite. Es lo que mantiene a three.js fuera del bundle chico: si
 * `main.ts` lo importara directo, entraría en los dos.
 */

import { Board3D, type BoardStyle } from './ui3d/board3d';
import type { BoardView, IconMap } from './ui/boardview';

export type { BoardStyle, IconMap };
export { makeIcons } from './ui3d/pieces3d';

/** Estilos que ofrece este build; la app arma el selector con esto. */
export const BOARD_STYLES: { value: BoardStyle; label: string }[] = [
  { value: 'lamina', label: 'Lámina original de 1891' },
  { value: 'moderno', label: 'Moderno (anillos de color)' },
  { value: 'madera', label: 'Madera y latón — el que nunca se fabricó' },
];

export function createBoard(container: HTMLElement, style: BoardStyle): BoardView {
  return new Board3D(container, style);
}
