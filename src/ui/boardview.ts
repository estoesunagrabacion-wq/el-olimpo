/**
 * Contrato entre la app y el tablero.
 *
 * Existen dos implementaciones —el tablero 3D con three.js y el liviano en
 * canvas 2D— y la app no sabe cuál tiene enfrente: cada entry inyecta la suya
 * a través de `boardimpl`. Gracias a eso el build liviano no arrastra three.js,
 * que es lo único que hace la diferencia entre 612 kB y unas decenas.
 */

import type { Cell, GameState, MoveDest, Piece } from '../engine/types';

export interface BoardView {
  /** Elemento que recibe los eventos de puntero. */
  readonly domElement: HTMLElement;
  /** Estilo con el que se construyó; la app lo compara para saber si recrear. */
  readonly style: string;
  /** Mientras anima, la app ignora los clics. */
  readonly animating: boolean;

  resize(size: number): void;
  syncPieces(state: GameState): void;
  updateMarkers(selected: Piece | null, dests: MoveDest[], lastMove: Cell[] | null): void;
  animateMove(pieceId: number, to: Cell, capturedId: number | null): Promise<void>;
  animateCanje(dbId: number, dbCell: Cell, sacrificeIds: number[]): Promise<void>;
  /** Con `tilesOnly` el rayo ignora las piezas (destinos tapados por una alta). */
  pick(clientX: number, clientY: number, tilesOnly?: boolean): Cell | null;
  dispose(): void;
}

/** Iconos de las piezas como data-URI, para la leyenda y las capturas. */
export type IconMap = Map<string, string>;
