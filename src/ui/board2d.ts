/**
 * Tablero liviano en canvas 2D: misma partida y mismas reglas que el 3D, pero
 * sin three.js ni WebGL. Es el que usa el build `liviano`, pensado para
 * máquinas viejas, navegadores con la aceleración desactivada y para mandar
 * un archivo chico.
 *
 * Envuelve el dibujo que ya vivía en `render.ts` y le da la interfaz que la
 * app espera de un tablero (`BoardView`), incluidas las animaciones de
 * movimiento y de canje.
 */

import type { Cell, GameState, MoveDest, Piece } from '../engine/types';
import type { BoardView } from './boardview';
import { cellCentroid, hitTest } from './geometry';
import { drawBoard, type PieceAnim, type ViewState } from './render';
import { loadSprites, type SpriteMap } from './sprites';

const MOVE_MS = 340;
const CANJE_MS = 620;

export class Board2D implements BoardView {
  readonly domElement: HTMLCanvasElement;
  readonly style = 'liviano';

  private ctx: CanvasRenderingContext2D;
  private sprites: SpriteMap = new Map();
  private state: GameState | null = null;
  private view: ViewState = { selected: null, dests: [], lastMove: null, anim: null };
  private size = 600;
  /** Radio del tablero en píxeles CSS; el dibujo usa coordenadas centradas. */
  private R = 282;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.domElement = document.createElement('canvas');
    this.domElement.style.display = 'block';
    this.domElement.style.touchAction = 'none';
    container.appendChild(this.domElement);
    const ctx = this.domElement.getContext('2d');
    if (!ctx) throw new Error('El navegador no da un contexto 2D');
    this.ctx = ctx;
    this.resize(this.size);
    // los sprites son SVG en data-URI: llegan enseguida, pero hasta entonces
    // se dibuja el tablero sin piezas en vez de no dibujar nada
    void loadSprites().then((s) => {
      if (this.disposed) return;
      this.sprites = s;
      this.render();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.domElement.remove();
  }

  get animating(): boolean {
    return this.view.anim !== null;
  }

  resize(size: number): void {
    this.size = size;
    this.R = (size / 2) * 0.94;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.domElement.width = Math.round(size * dpr);
    this.domElement.height = Math.round(size * dpr);
    this.domElement.style.width = size + 'px';
    this.domElement.style.height = size + 'px';
    this.render();
  }

  syncPieces(state: GameState): void {
    this.state = state;
    this.render();
  }

  updateMarkers(selected: Piece | null, dests: MoveDest[], lastMove: Cell[] | null): void {
    this.view.selected = selected;
    this.view.dests = dests;
    this.view.lastMove = lastMove;
    this.render();
  }

  pick(clientX: number, clientY: number): Cell | null {
    const rect = this.domElement.getBoundingClientRect();
    // a coordenadas centradas en el tablero, que es como razona la geometría
    const x = clientX - rect.left - rect.width / 2;
    const y = clientY - rect.top - rect.height / 2;
    const hit = hitTest(x, y, this.R);
    return hit === 'center' || hit === null ? null : hit;
  }

  animateMove(pieceId: number, to: Cell, capturedId: number | null): Promise<void> {
    const piece = this.state?.pieces.find((p) => p.id === pieceId);
    if (!piece) return Promise.resolve();
    const from = cellCentroid({ ring: piece.ring, idx: piece.idx }, this.R);
    const dest = cellCentroid(to, this.R);
    const captured = capturedId === null ? undefined : this.state?.pieces.find((p) => p.id === capturedId);
    const anim: PieceAnim = {
      pieceId,
      from: { x: from.x, y: from.y },
      to: { x: dest.x, y: dest.y },
      t: 0,
      fading: captured ? { piece: captured, x: dest.x, y: dest.y } : undefined,
    };
    return this.runAnim(anim, MOVE_MS);
  }

  animateCanje(dbId: number, dbCell: Cell, sacrificeIds: number[]): Promise<void> {
    void sacrificeIds;
    // el Diablo "cae" a su casilla desde afuera del tablero
    const dest = cellCentroid(dbCell, this.R);
    const anim: PieceAnim = {
      pieceId: dbId,
      from: { x: dest.x * 1.35, y: dest.y * 1.35 },
      to: { x: dest.x, y: dest.y },
      t: 0,
    };
    return this.runAnim(anim, CANJE_MS);
  }

  private runAnim(anim: PieceAnim, ms: number): Promise<void> {
    this.view.anim = anim;
    const t0 = performance.now();
    return new Promise((resolve) => {
      const step = (now: number): void => {
        if (this.disposed) {
          resolve();
          return;
        }
        anim.t = Math.min(1, (now - t0) / ms);
        this.render();
        if (anim.t < 1) {
          requestAnimationFrame(step);
        } else {
          this.view.anim = null;
          this.render();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  private render(): void {
    if (this.disposed || !this.state) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.translate(this.size / 2, this.size / 2);
    drawBoard(ctx, this.R, this.state, this.view, this.sprites);
  }
}
