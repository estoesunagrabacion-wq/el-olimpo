/**
 * Topología del tablero real de 1891: anillos concéntricos con distinta
 * cantidad de casillas. Como 6 | 12 | 24 (cada tamaño divide al siguiente),
 * la alineación radial entre anillos es exacta: una casilla de Regiones
 * abarca 2 de Tiempo y 4 de Pasiones.
 *
 * Anillos, de adentro hacia afuera (la Divinidad central no es una casilla
 * de la grilla):
 *   0 Regiones   (6)   — objetivo del juego
 *   1 Tiempo     (12)  — casa de las Virtudes
 *   2 Pasiones I (24)
 *   3 Pasiones II(24)
 *   4 Pasiones III (24) — casa de los Ídolos
 *   5 Pasiones IV  (24) — casa del Ejército (Pontífices, Pueblos, Curas)
 *   6 Averno     (12)  — territorio exclusivo de los Diablos
 *
 * Total: 126 casillas.
 *
 * Ángulos: la fracción angular de la casilla `idx` de un anillo de n casillas
 * es [idx/n, (idx+1)/n), medida desde la Meridiana (este, 3 en punto) en
 * sentido horario de pantalla. Mitad "rojo" = fracciones [0, 0.5) (sur),
 * mitad "dorado" = [0.5, 1) (norte).
 */

import type { Cell } from './types';

export const RING_SIZES = [6, 12, 24, 24, 24, 24, 12] as const;
export const NUM_RINGS = RING_SIZES.length;

export const REGIONES = 0;
export const TIEMPO = 1;
export const IDOLOS_RING = 4;
export const EJERCITO_RING = 5;
export const AVERNO = 6;

export type RingKind = 'regiones' | 'tiempo' | 'pasiones' | 'averno';
export const RING_KINDS: RingKind[] = [
  'regiones',
  'tiempo',
  'pasiones',
  'pasiones',
  'pasiones',
  'pasiones',
  'averno',
];

/** Nombres cortos para notación de jugadas. */
export const RING_LABELS = ['R', 'T', 'P1', 'P2', 'P3', 'P4', 'A'];

export function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export function cellKey(c: Cell): string {
  return c.ring + ':' + c.idx;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.ring === b.ring && a.idx === b.idx;
}

export function cellLabel(c: Cell): string {
  return RING_LABELS[c.ring] + '-' + (c.idx + 1);
}

/** Vecino lateral (de costado) dentro del mismo anillo. */
export function lateral(c: Cell, d: number): Cell {
  const n = RING_SIZES[c.ring];
  return { ring: c.ring, idx: mod(c.idx + d, n) };
}

/**
 * Vecinos radiales inmediatos (de frente / de atrás).
 * Hacia un anillo con más casillas se "expande" (varias hijas);
 * hacia uno con menos, se "contrae" (una sola madre).
 */
export function radialStep(c: Cell, dir: 1 | -1): Cell[] {
  const r2 = c.ring + dir;
  if (r2 < 0 || r2 >= NUM_RINGS) return [];
  const n = RING_SIZES[c.ring];
  const m = RING_SIZES[r2];
  if (m === n) return [{ ring: r2, idx: c.idx }];
  if (m > n) {
    const k = m / n;
    const out: Cell[] = [];
    for (let j = 0; j < k; j++) out.push({ ring: r2, idx: c.idx * k + j });
    return out;
  }
  const k = n / m;
  return [{ ring: r2, idx: Math.floor(c.idx / k) }];
}

/**
 * Casillas alcanzables avanzando radialmente hasta `maxSteps` pasos en una
 * dirección. Devuelve todas las casillas intermedias y finales (movimiento
 * "hasta N", con salto: la ocupación de las intermedias no bloquea).
 */
export function radialReach(c: Cell, dir: 1 | -1, maxSteps: number): Cell[] {
  let frontier: Cell[] = [c];
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (let s = 0; s < maxSteps; s++) {
    const next: Cell[] = [];
    for (const f of frontier) {
      for (const nb of radialStep(f, dir)) {
        const k = cellKey(nb);
        if (!seen.has(k)) {
          seen.add(k);
          next.push(nb);
          out.push(nb);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return out;
}

/**
 * Vecinos diagonales hacia el anillo adyacente en la dirección dada:
 * las casillas angularmente contiguas a las imágenes radiales, excluidas
 * las imágenes mismas. En anillos del mismo tamaño coincide con la
 * diagonal clásica (2 casillas).
 */
export function diagonalStep(c: Cell, dir: 1 | -1): Cell[] {
  const images = radialStep(c, dir);
  if (images.length === 0) return [];
  const m = RING_SIZES[images[0].ring];
  const imgSet = new Set(images.map((i) => i.idx));
  const out: Cell[] = [];
  const added = new Set<number>();
  for (const img of images) {
    for (const d of [-1, 1]) {
      const idx = mod(img.idx + d, m);
      if (!imgSet.has(idx) && !added.has(idx)) {
        added.add(idx);
        out.push({ ring: img.ring, idx });
      }
    }
  }
  return out;
}

/** Las 8 (o más, por expansión) casillas vecinas "en cualquier dirección". */
export function allNeighbors(c: Cell): Cell[] {
  const out: Cell[] = [lateral(c, -1), lateral(c, 1)];
  for (const dir of [-1, 1] as const) {
    out.push(...radialStep(c, dir));
    out.push(...diagonalStep(c, dir));
  }
  return out;
}
