/** Dibujo del tablero en canvas 2D, con la paleta del rediseño de la lámina. */

import { AVERNO, IDOLOS_RING, EJERCITO_RING, NUM_RINGS, REGIONES, RING_SIZES, TIEMPO } from '../engine/board';
import type { Cell, GameState, MoveDest, Piece } from '../engine/types';
import { BORDER_R, CENTER_R, RING_BOUNDS, cellCentroid, cellPath } from './geometry';
import type { SpriteMap } from './sprites';

const INK = '#3a2a18';
const GOLD = '#b6862f';
const GOLD_LIGHT = '#d9b673';

const RING_FILLS: [string, string][] = [
  ['#efe2b8', '#ece0c4'], // Regiones
  ['#c7dbd6', '#dbe9e5'], // Tiempo
  ['#372f28', '#dcb2a8'], // Pasiones I
  ['#372f28', '#dcb2a8'], // Pasiones II
  ['#372f28', '#dcb2a8'], // Pasiones III
  ['#372f28', '#dcb2a8'], // Pasiones IV
  ['#8f2c2c', '#a53a3a'], // Averno
];

export interface PieceAnim {
  pieceId: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 0..1 */
  t: number;
  /** pieza capturada que se desvanece, si la hay */
  fading?: { piece: Piece; x: number; y: number };
}

export interface ViewState {
  selected: Piece | null;
  dests: MoveDest[];
  lastMove: Cell[] | null;
  anim: PieceAnim | null;
}

/** Radio del medallón de una pieza según el tamaño de su casilla. */
function tokenRadius(cell: Cell, R: number): number {
  const c = cellCentroid(cell, R);
  const r = Math.min(c.band, c.arc) * 0.44;
  return Math.min(Math.max(r, R * 0.03), R * 0.054);
}

export function drawBoard(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: GameState,
  view: ViewState,
  sprites: SpriteMap,
): void {
  ctx.save();

  // fondo pergamino
  const bg = ctx.createRadialGradient(0, -R * 0.2, R * 0.2, 0, 0, R * 1.5);
  bg.addColorStop(0, '#f2e9d3');
  bg.addColorStop(1, '#e9dcbb');
  ctx.fillStyle = bg;
  ctx.fillRect(-R * 1.05, -R * 1.05, R * 2.1, R * 2.1);

  // sombra del disco del tablero
  ctx.save();
  ctx.shadowColor = 'rgba(40,25,10,0.4)';
  ctx.shadowBlur = R * 0.06;
  ctx.shadowOffsetY = R * 0.015;
  ctx.beginPath();
  ctx.arc(0, 0, BORDER_R * R, 0, Math.PI * 2);
  ctx.fillStyle = '#ece0c4';
  ctx.fill();
  ctx.restore();

  // casillas
  for (let ring = 0; ring < NUM_RINGS; ring++) {
    const n = RING_SIZES[ring];
    for (let idx = 0; idx < n; idx++) {
      const cell = { ring, idx };
      cellPath(ctx, cell, R);
      ctx.fillStyle = RING_FILLS[ring][idx % 2];
      ctx.fill();
      ctx.strokeStyle = 'rgba(36,26,16,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // sombreado de profundidad a lo largo de los bordes de cada anillo
  for (let ring = 0; ring < NUM_RINGS; ring++) {
    const [r0, r1] = RING_BOUNDS[ring];
    const grad = ctx.createRadialGradient(0, 0, r0 * R, 0, 0, r1 * R);
    grad.addColorStop(0, 'rgba(36,26,16,0.16)');
    grad.addColorStop(0.18, 'rgba(36,26,16,0)');
    grad.addColorStop(0.82, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,244,214,0.10)');
    ctx.beginPath();
    ctx.arc(0, 0, r1 * R, 0, Math.PI * 2);
    ctx.arc(0, 0, r0 * R, 0, Math.PI * 2, true);
    ctx.fillStyle = grad;
    ctx.fill();
    // divisor del anillo
    ctx.beginPath();
    ctx.arc(0, 0, r1 * R, 0, Math.PI * 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // marcas de origen: rombos en el anillo de Ídolos, puntos en el del Ejército
  for (const idx of [2, 6, 10, 14, 18, 22]) {
    const c = cellCentroid({ ring: IDOLOS_RING, idx }, R);
    diamond(ctx, c.x, c.y, R * 0.011, GOLD);
  }
  for (let idx = 0; idx < 24; idx++) {
    if (idx === 0 || idx === 12) continue;
    const c = cellCentroid({ ring: EJERCITO_RING, idx }, R);
    ctx.beginPath();
    ctx.arc(c.x, c.y, R * 0.006, 0, Math.PI * 2);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // último movimiento
  if (view.lastMove) {
    for (const cell of view.lastMove) {
      cellPath(ctx, cell, R, 1.5);
      ctx.strokeStyle = 'rgba(182,134,47,0.95)';
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }
  }

  // casilla de la pieza seleccionada
  if (view.selected) {
    const cell = { ring: view.selected.ring, idx: view.selected.idx };
    cellPath(ctx, cell, R, 1.5);
    ctx.fillStyle = 'rgba(217,182,115,0.4)';
    ctx.fill();
    ctx.strokeStyle = '#d9b673';
    ctx.lineWidth = 2.6;
    ctx.stroke();
  }

  // destinos legales de la pieza seleccionada
  for (const d of view.dests) {
    cellPath(ctx, d, R, 2.5);
    ctx.fillStyle = d.capture ? 'rgba(143,44,44,0.4)' : 'rgba(76,128,84,0.32)';
    ctx.fill();
    const c = cellCentroid(d, R);
    if (d.capture) {
      // anillo de amenaza alrededor de la pieza a capturar
      ctx.beginPath();
      ctx.arc(c.x, c.y, tokenRadius(d, R) * 1.28, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(143,44,44,0.95)';
      ctx.lineWidth = Math.max(2, R * 0.006);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(3, R * 0.011), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46,94,56,0.85)';
      ctx.fill();
    }
  }

  // Meridiana: la línea roja que separa las mitades, con remates
  ctx.beginPath();
  ctx.moveTo(-BORDER_R * R, 0);
  ctx.lineTo(-CENTER_R * R, 0);
  ctx.moveTo(CENTER_R * R, 0);
  ctx.lineTo(BORDER_R * R, 0);
  ctx.strokeStyle = '#8f2c2c';
  ctx.lineWidth = Math.max(2, R * 0.006);
  ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(sx * BORDER_R * R, 0, Math.max(3, R * 0.009), 0, Math.PI * 2);
    ctx.fillStyle = '#8f2c2c';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // centro: medallón de la Divinidad
  const cg = ctx.createRadialGradient(-CENTER_R * R * 0.3, -CENTER_R * R * 0.35, CENTER_R * R * 0.1, 0, 0, CENTER_R * R);
  cg.addColorStop(0, '#e9cd92');
  cg.addColorStop(1, '#c49a4d');
  ctx.beginPath();
  ctx.arc(0, 0, CENTER_R * R, 0, Math.PI * 2);
  ctx.fillStyle = cg;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, CENTER_R * R * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(58,42,24,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  star4(ctx, 0, 0, CENTER_R * R * 0.6, GOLD);

  // borde dorado exterior
  ctx.beginPath();
  ctx.arc(0, 0, BORDER_R * R, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();

  // piezas
  const anim = view.anim;
  if (anim?.fading) {
    drawPiece(ctx, R, anim.fading.piece, sprites, anim.fading.x, anim.fading.y, 1 - anim.t, false);
  }
  for (const p of state.pieces) {
    if (!p.alive || p.type === 'DI') continue;
    let { x, y } = cellCentroid({ ring: p.ring, idx: p.idx }, R);
    if (anim && anim.pieceId === p.id) {
      const e = easeInOut(anim.t);
      x = anim.from.x + (anim.to.x - anim.from.x) * e;
      y = anim.from.y + (anim.to.y - anim.from.y) * e;
    }
    drawPiece(ctx, R, p, sprites, x, y, 1, view.selected?.id === p.id);
  }
  ctx.restore();
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  R: number,
  p: Piece,
  sprites: SpriteMap,
  x: number,
  y: number,
  alpha: number,
  selected: boolean,
): void {
  const img = sprites.get(p.type + '-' + p.owner);
  if (!img) return;
  const r = tokenRadius({ ring: p.ring, idx: p.idx }, R) * (selected ? 1.12 : 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  // sombra del medallón
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.28, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(36,26,16,0.3)';
  ctx.fill();
  if (selected) {
    ctx.shadowColor = '#ffd873';
    ctx.shadowBlur = r * 0.9;
  }
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.42;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function ringName(ring: number): string {
  if (ring === REGIONES) return 'Regiones';
  if (ring === TIEMPO) return 'Tiempo';
  if (ring === AVERNO) return 'Averno';
  return 'Pasiones';
}
