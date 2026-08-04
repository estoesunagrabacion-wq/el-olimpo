/** Geometría del tablero circular: radios, ángulos, centroides y hit-testing. */

import { NUM_RINGS, RING_SIZES } from '../engine/board';
import type { Cell } from '../engine/types';

/** Límites [r0, r1] de cada anillo como fracción del radio total. */
export const RING_BOUNDS: [number, number][] = [
  [0.09, 0.215], // Regiones
  [0.215, 0.32], // Tiempo
  [0.32, 0.437], // Pasiones I
  [0.437, 0.554], // Pasiones II
  [0.554, 0.671], // Pasiones III (Ídolos)
  [0.671, 0.788], // Pasiones IV (Ejército)
  [0.788, 0.925], // Averno
];
export const CENTER_R = 0.09;
export const BORDER_R = 0.955;

/** Ángulos [a0, a1] de la casilla (0 = este, sentido horario en pantalla). */
export function cellAngles(cell: Cell): [number, number] {
  const n = RING_SIZES[cell.ring];
  const a0 = (cell.idx / n) * Math.PI * 2;
  return [a0, a0 + (Math.PI * 2) / n];
}

export interface Centroid {
  x: number;
  y: number;
  band: number; // ancho radial del anillo en px
  arc: number; // largo del arco de la casilla en px
}

export function cellCentroid(cell: Cell, R: number): Centroid {
  const [r0, r1] = RING_BOUNDS[cell.ring];
  const [a0, a1] = cellAngles(cell);
  const rMid = ((r0 + r1) / 2) * R;
  const aMid = (a0 + a1) / 2;
  return {
    x: rMid * Math.cos(aMid),
    y: rMid * Math.sin(aMid),
    band: (r1 - r0) * R,
    arc: ((a1 - a0) * (r0 + r1) * R) / 2,
  };
}

/** Traza el contorno de la casilla en el contexto (coords centradas en 0,0). */
export function cellPath(ctx: CanvasRenderingContext2D, cell: Cell, R: number, inset = 0): void {
  const [r0, r1] = RING_BOUNDS[cell.ring];
  const [a0, a1] = cellAngles(cell);
  ctx.beginPath();
  ctx.arc(0, 0, r1 * R - inset, a0, a1);
  ctx.arc(0, 0, r0 * R + inset, a1, a0, true);
  ctx.closePath();
}

export function hitTest(x: number, y: number, R: number): Cell | 'center' | null {
  const r = Math.hypot(x, y) / R;
  if (r < CENTER_R) return 'center';
  let a = Math.atan2(y, x);
  if (a < 0) a += Math.PI * 2;
  for (let ring = 0; ring < NUM_RINGS; ring++) {
    const [r0, r1] = RING_BOUNDS[ring];
    if (r >= r0 && r <= r1) {
      const n = RING_SIZES[ring];
      const idx = Math.min(n - 1, Math.floor((a / (Math.PI * 2)) * n));
      return { ring, idx };
    }
  }
  return null;
}
