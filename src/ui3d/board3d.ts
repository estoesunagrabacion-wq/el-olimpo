/**
 * Tablero 3D fiel a la lámina original de 1891: superficie clara con las 126
 * casillas como discos de colores dispuestos en rayos alrededor de la estrella
 * central, letras en las casillas de origen (S, P, Pb, I, D), meridiana roja,
 * doble filete verde en el borde y el Averno como discos rojos junto al canto.
 * Escena Three.js con luces cálidas, sombras, cámara orbitable y animaciones.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AVERNO, EJERCITO_RING, IDOLOS_RING, NUM_RINGS, REGIONES, RING_SIZES, TIEMPO } from '../engine/board';
import type { Cell, GameState, MoveDest, Piece } from '../engine/types';
import { BORDER_R, CENTER_R, RING_BOUNDS } from '../ui/geometry';
import { buildPieceMesh, type PiecePalette } from './pieces3d';

const BOARD_R = 100;
/** Altura donde apoyan las piezas: la cara superior de los discos. */
const TILE_TOP = 1.75;
const DISC_TOP = TILE_TOP;
const DISC_H = 0.6;
const BOARD_TOP = 1.12; // cara superior de la madera clara

// Paleta tomada de la lámina original
const COL_BOARD = 0xefe8d5; // tapa crema
const COL_WOOD = 0x6b4a30; // madera de la mesa
const COL_GREEN_RIM = 0x5a7d4f;
const COL_REGION = 0x7fa06a; // discos verdes (Regiones)
const COL_TIEMPO = 0x6f9d95; // discos verdeazulados (Tiempo)
const COL_SALMON = 0xe6b8a2;
const COL_BLACK = 0x2e2a26;
const COL_AVERNO = 0xcf6448; // discos rojos del borde
const COL_MERIDIANA = 0x9e2f2f;

/**
 * Tres estéticas conviven:
 *  - 'lamina'  reproduce la lámina original de 1891 (discos sobre tapa clara).
 *  - 'moderno' es el tablero de anillos de color de la primera versión 3D.
 *  - 'madera'  imagina el objeto que nunca se fabricó: marquetería de chapas
 *    de madera con las divisiones embutidas en latón. El libro de 1891 describe
 *    el juego pero nunca se construyó, así que este tablero es la única de las
 *    tres estéticas que no reproduce nada: propone.
 */
export type BoardStyle = 'lamina' | 'moderno' | 'madera';

/** Junta entre losetas del estilo 'moderno': marca la división de casillas. */
const COL_JUNTA = 0x241a10;
/**
 * Latón de las divisiones embutidas del estilo 'madera'.
 *
 * Van dos tonos porque la escena no tiene mapa de entorno: un material muy
 * metálico no tiene qué reflejar y se ve casi negro salvo en el brillo
 * especular. En las piezas torneadas (aros del canto) eso no molesta, porque
 * la curva siempre atrapa la luz en algún punto; en las embutidas, que son
 * planas y miran hacia arriba, hay que bajar el metal y subir el brillo para
 * que se lea el color difuso.
 */
const COL_LATON = 0xc9a227;
const COL_LATON_PLANO = 0xd8b33a;
/** Cuánto se achica cada loseta por lado para dejar ver la junta. */
const TILE_INSET = 0.45;
/** En marquetería el filete de latón es más fino que una junta pintada. */
const TILE_INSET_MADERA = 0.34;

const MODERNO_RING_COLORS: [number, number][] = [
  // Regiones y Tiempo llevan pares bien separados en claridad: con los tonos
  // originales (efe2b8/ece0c4 y c7dbd6/dbe9e5) el damero era imperceptible y
  // no se podían contar las 6 y 12 casillas de un vistazo. Cada anillo
  // conserva su familia de color —cálida el central, fría el del Tiempo.
  [0xefe2b8, 0xcfae6a], // Regiones
  [0xc7dbd6, 0x89ada6], // Tiempo
  [0x372f28, 0xdcb2a8], // Pasiones I
  [0x372f28, 0xdcb2a8], // Pasiones II
  [0x372f28, 0xdcb2a8], // Pasiones III
  [0x372f28, 0xdcb2a8], // Pasiones IV
  [0x8f2c2c, 0xa53a3a], // Averno
];

/**
 * Chapas de madera del estilo 'madera'. Cada anillo usa un par de maderas
 * reales que un ebanista de 1891 habría tenido a mano, y el contraste crece
 * hacia afuera: arce y cerezo en el centro, boj contra palisandro en las
 * Pasiones —donde se juega y hace falta leer la casilla— y padauk en el
 * Averno, la madera más roja que se usaba en marquetería.
 */
const MADERA_RING_COLORS: [number, number][] = [
  [0xe0cba4, 0xc79a5e], // Regiones — arce / cerezo
  [0xcbb187, 0x9d7c4e], // Tiempo — fresno / nogal
  [0xd9c096, 0x5f3b28], // Pasiones I — boj / palisandro
  [0xd9c096, 0x5f3b28], // Pasiones II
  [0xd9c096, 0x5f3b28], // Pasiones III
  [0xd9c096, 0x5f3b28], // Pasiones IV
  [0x8c3a24, 0x63291a], // Averno — padauk / caoba quemada
];

/** Maderas del cuerpo: nogal oscuro el canto, y la mesa en roble ahumado. */
const COL_NOGAL = 0x4a2f1c;
const COL_ROBLE = 0x2b1c12;

interface Tween {
  t0: number;
  dur: number;
  update: (k: number) => void;
  done?: () => void;
}

function ease(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function cellAngle(cell: Cell): number {
  return ((cell.idx + 0.5) / RING_SIZES[cell.ring]) * Math.PI * 2;
}

export function cellCenter3d(cell: Cell): THREE.Vector3 {
  const [r0, r1] = RING_BOUNDS[cell.ring];
  const r = ((r0 + r1) / 2) * BOARD_R;
  const a = cellAngle(cell);
  return new THREE.Vector3(r * Math.cos(a), TILE_TOP, r * Math.sin(a));
}

function discRadius(cell: Cell): number {
  const [r0, r1] = RING_BOUNDS[cell.ring];
  const band = (r1 - r0) * BOARD_R;
  const arc = ((Math.PI * 2) / RING_SIZES[cell.ring]) * (((r0 + r1) / 2) * BOARD_R);
  return Math.min(Math.max(Math.min(band, arc) * 0.4, 3.2), 5.4);
}

function markerSize(cell: Cell): number {
  return discRadius(cell) + 0.6;
}

function discColor(cell: Cell): number {
  if (cell.ring === REGIONES) return COL_REGION;
  if (cell.ring === TIEMPO) return COL_TIEMPO;
  if (cell.ring === AVERNO) return COL_AVERNO;
  return (cell.ring + cell.idx) % 2 === 0 ? COL_BLACK : COL_SALMON;
}

/** Letras de las casillas de origen, como en la lámina (S, P, Pb, I, D). */
function homeLetter(cell: Cell): string | null {
  if (cell.ring === EJERCITO_RING) {
    const letters = ['S', 'S', 'P', 'S', 'Pb', 'P', 'Pb', 'S', 'P', 'S', 'S'];
    for (const base of [1, 13]) {
      if (cell.idx >= base && cell.idx < base + 11) return letters[cell.idx - base];
    }
    return null;
  }
  if (cell.ring === IDOLOS_RING && [2, 6, 10, 14, 18, 22].includes(cell.idx)) return 'I';
  if (cell.ring === AVERNO && (cell.idx === 3 || cell.idx === 9)) return 'D';
  return null;
}

const noRaycast = (): void => {};

export class Board3D {
  readonly domElement: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private cellsGroup = new THREE.Group();
  private piecesGroup = new THREE.Group();
  private markersGroup = new THREE.Group();
  private pieceMeshes = new Map<number, THREE.Group>();
  private tweens: Tween[] = [];
  private matCache = new Map<number, THREE.MeshStandardMaterial>();
  private disposed = false;
  readonly style: BoardStyle;
  /** Las piezas del tablero de marquetería van sin pintar. */
  private get piecePalette(): PiecePalette {
    return this.style === 'madera' ? 'madera' : 'pintado';
  }

  constructor(container: HTMLElement, style: BoardStyle = 'lamina') {
    this.style = style;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.domElement = this.renderer.domElement;
    container.appendChild(this.domElement);

    this.scene.background = new THREE.Color(0x17100a);
    this.scene.fog = new THREE.Fog(0x17100a, 380, 900);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 1200);
    this.camera.position.set(0, 185, 200);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 130;
    this.controls.maxDistance = 460;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = 1.25;

    this.buildLights();
    this.buildTable();
    this.buildCells();
    this.buildDiscs();
    this.buildOrnaments();
    this.scene.add(this.cellsGroup, this.piecesGroup, this.markersGroup);

    const loop = (now: number): void => {
      if (this.disposed) return;
      requestAnimationFrame(loop);
      this.controls.update();
      this.runTweens(now);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  /** Libera el contexto WebGL (al cambiar de estilo se crea otra escena). */
  dispose(): void {
    this.disposed = true;
    this.controls.dispose();
    this.renderer.dispose();
    this.domElement.remove();
  }

  /* ---------- construcción de la escena ---------- */

  private mat(color: number, rough = 0.75, metal = 0.05): THREE.MeshStandardMaterial {
    const key = color * 1000 + Math.round(rough * 100) * 10 + Math.round(metal * 10);
    let m = this.matCache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      this.matCache.set(key, m);
    }
    return m;
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffe8c8, 0.45));
    this.scene.add(new THREE.HemisphereLight(0xfff1d8, 0x2a1c10, 0.55));
    const dir = new THREE.DirectionalLight(0xfff0dc, 2.4);
    dir.position.set(90, 170, 70);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -140;
    dir.shadow.camera.right = 140;
    dir.shadow.camera.top = 140;
    dir.shadow.camera.bottom = -140;
    dir.shadow.camera.far = 500;
    dir.shadow.bias = -0.0004;
    this.scene.add(dir);
  }

  private buildTable(): void {
    // mesa de apoyo
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(BOARD_R * 2.4, BOARD_R * 2.4, 5, 64),
      this.mat(this.style === 'madera' ? COL_ROBLE : 0x231710, 0.9),
    );
    table.position.y = -5.6;
    table.receiveShadow = true;
    this.scene.add(table);

    if (this.style === 'madera') {
      // caja de nogal con un aro de latón embutido en el canto
      const caja = new THREE.Mesh(
        new THREE.CylinderGeometry(BOARD_R * 1.02, BOARD_R * 1.06, 4.2, 96),
        this.mat(COL_NOGAL, 0.62),
      );
      caja.position.y = -1.6;
      caja.castShadow = true;
      caja.receiveShadow = true;
      this.scene.add(caja);
      for (const [r, grosor] of [
        [BOARD_R * 1.035, 1.15],
        [BOARD_R * 0.945, 0.5],
      ] as const) {
        const aro = new THREE.Mesh(new THREE.TorusGeometry(r, grosor, 12, 140), this.mat(COL_LATON, 0.26, 0.92));
        aro.rotation.x = Math.PI / 2;
        aro.position.y = TILE_TOP - 0.5;
        aro.castShadow = true;
        aro.raycast = noRaycast;
        this.scene.add(aro);
      }
      return;
    }

    if (this.style === 'moderno') {
      // cuerpo oscuro con aro dorado, como la primera versión 3D
      const base = new THREE.Mesh(new THREE.CylinderGeometry(BOARD_R * 1.0, BOARD_R * 1.04, 3, 96), this.mat(0x3a2a18, 0.7));
      base.position.y = -1.5;
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(BOARD_R * 0.972, 1.4, 12, 120), this.mat(0xb6862f, 0.3, 0.85));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 1.5;
      rim.castShadow = true;
      rim.raycast = noRaycast;
      this.scene.add(rim);
      return;
    }

    // canto de madera con moldura, como la mesita de la lámina
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(BOARD_R * 1.04, BOARD_R * 1.08, 3.4, 96), this.mat(COL_WOOD, 0.55, 0.1));
    edge.position.y = -1.2;
    edge.castShadow = true;
    edge.receiveShadow = true;
    this.scene.add(edge);
    // tapa clara donde viven las casillas
    const top = new THREE.Mesh(new THREE.CylinderGeometry(BOARD_R * 0.99, BOARD_R * 1.0, 2.2, 96), this.mat(COL_BOARD, 0.8));
    top.position.y = BOARD_TOP - 1.1;
    top.receiveShadow = true;
    top.raycast = noRaycast;
    this.scene.add(top);
    // doble filete verde del borde
    const rimOuter = new THREE.Mesh(new THREE.RingGeometry(BOARD_R * 0.955, BOARD_R * 0.968, 96), this.mat(COL_GREEN_RIM, 0.7));
    rimOuter.rotation.x = -Math.PI / 2;
    rimOuter.position.y = BOARD_TOP + 0.02;
    rimOuter.raycast = noRaycast;
    this.scene.add(rimOuter);
    const rimInner = new THREE.Mesh(new THREE.RingGeometry(BOARD_R * 0.935, BOARD_R * 0.941, 96), this.mat(COL_GREEN_RIM, 0.7));
    rimInner.rotation.x = -Math.PI / 2;
    rimInner.position.y = BOARD_TOP + 0.02;
    rimInner.raycast = noRaycast;
    this.scene.add(rimInner);
  }

  /** Con `inset` la casilla se achica por los cuatro lados, dejando junta. */
  private cellShape(cell: Cell, inset = 0): THREE.Shape {
    const n = RING_SIZES[cell.ring];
    const [rb0, rb1] = RING_BOUNDS[cell.ring];
    // el margen angular se mide sobre el radio medio para que la junta tenga
    // más o menos el mismo ancho en los dos bordes rectos de la casilla
    const dA = inset / (((rb0 + rb1) / 2) * BOARD_R);
    const a0 = (cell.idx / n) * Math.PI * 2 + dA;
    const a1 = ((cell.idx + 1) / n) * Math.PI * 2 - dA;
    const rIn = rb0 * BOARD_R + inset;
    const rOut = rb1 * BOARD_R - inset;
    // el shape vive en XY y se extruye en Z; con rotation.x = -PI/2 el mundo
    // queda x'=x, y'=z, z'=-y, así que se construye con ángulos negados
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rOut, -a1, -a0, false);
    shape.absarc(0, 0, rIn, -a0, -a1, true);
    return shape;
  }

  /**
   * En 'lamina' son la tapa lisa (y la zona de clic); en 'moderno', losetas de
   * color separadas por una junta.
   *
   * En 'moderno' cada casilla son dos mallas: una base oscura del tamaño
   * completo, que resuelve el clic en toda el área y asoma entre las losetas
   * haciendo de junta, y encima la loseta de color con un margen. Sin esa
   * junta los cuatro anillos de Pasiones —que comparten paleta y fase— se
   * fundían en una sola banda de 24 gajos y el tablero perdía las divisiones
   * que sí se ven en 'lamina'.
   */
  /** Colores y medidas de las losetas, para los estilos que las usan. */
  private tileLook(): { colors: [number, number][]; junta: number; inset: number } | null {
    if (this.style === 'moderno') {
      return { colors: MODERNO_RING_COLORS, junta: COL_JUNTA, inset: TILE_INSET };
    }
    if (this.style === 'madera') {
      return { colors: MADERA_RING_COLORS, junta: COL_LATON, inset: TILE_INSET_MADERA };
    }
    return null;
  }

  private buildCells(): void {
    const look = this.tileLook();
    for (let ring = 0; ring < NUM_RINGS; ring++) {
      for (let idx = 0; idx < RING_SIZES[ring]; idx++) {
        const cell = { ring, idx };

        if (look) {
          const base = new THREE.Mesh(
            new THREE.ExtrudeGeometry(this.cellShape(cell), { depth: 1.25, bevelEnabled: false }),
            // el latón va pulido; la junta oscura del moderno, mate
            this.style === 'madera' ? this.mat(COL_LATON_PLANO, 0.34, 0.45) : this.mat(look.junta, 0.95),
          );
          base.rotation.x = -Math.PI / 2;
          base.position.y = TILE_TOP - 1.75;
          base.receiveShadow = true;
          base.userData.cell = cell;
          this.cellsGroup.add(base);

          const tile = new THREE.Mesh(
            new THREE.ExtrudeGeometry(this.cellShape(cell, look.inset), {
              depth: 0.36,
              bevelEnabled: true,
              bevelThickness: 0.12,
              bevelSize: 0.1,
              bevelSegments: 1,
            }),
            // la chapa de madera va casi mate: el brillo lo pone el latón
            this.mat(look.colors[ring][idx % 2], this.style === 'madera' ? 0.82 : 0.75),
          );
          tile.rotation.x = -Math.PI / 2;
          tile.position.y = TILE_TOP - 0.5;
          tile.castShadow = true;
          tile.receiveShadow = true;
          tile.raycast = noRaycast; // el clic lo resuelve la base de abajo
          this.cellsGroup.add(tile);
          continue;
        }

        const mesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(this.cellShape(cell), { depth: 0.9, bevelEnabled: false }),
          this.mat(COL_BOARD, 0.8),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.1;
        mesh.receiveShadow = true;
        mesh.userData.cell = cell;
        this.cellsGroup.add(mesh);
      }
    }
  }

  /** Textura con la letra de una casilla de origen, orientada hacia afuera. */
  private letterTexture(letter: string, bg: number, fg: string, angle: number): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#' + bg.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, 128, 128);
    ctx.translate(64, 64);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = fg;
    ctx.font = `bold ${letter.length > 1 ? 52 : 68}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 0, 4);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return tex;
  }

  /** Las 126 casillas como discos de colores, con letras en las de origen. */
  private buildDiscs(): void {
    if (this.style !== 'lamina') return;
    for (let ring = 0; ring < NUM_RINGS; ring++) {
      for (let idx = 0; idx < RING_SIZES[ring]; idx++) {
        const cell = { ring, idx };
        const r = discRadius(cell);
        const color = discColor(cell);
        const pos = cellCenter3d(cell);
        const letter = homeLetter(cell);
        const geo = new THREE.CylinderGeometry(r, r, DISC_H, 28);
        let mesh: THREE.Mesh;
        if (letter) {
          const fg = color === COL_SALMON ? '#3a2a18' : '#f2ead8';
          const tex = this.letterTexture(letter, color, fg, cellAngle(cell));
          const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
          mesh = new THREE.Mesh(geo, [this.mat(color, 0.65), top, this.mat(color, 0.65)]);
        } else {
          mesh = new THREE.Mesh(geo, this.mat(color, 0.65));
        }
        mesh.position.set(pos.x, DISC_TOP - DISC_H / 2, pos.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.raycast = noRaycast; // el clic lo resuelven los sectores de abajo
        this.scene.add(mesh);
      }
    }
  }

  /** Estrella de 4 puntas finas (media rosa de los vientos). */
  private thinStar(outerR: number, innerR: number, color: number, rot: number, y: number): THREE.Mesh {
    const shape = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rot;
      const rr = i % 2 === 0 ? outerR : innerR;
      const x = rr * Math.cos(a);
      const yy = rr * Math.sin(a);
      if (i === 0) shape.moveTo(x, yy);
      else shape.lineTo(x, yy);
    }
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), this.mat(color, 0.55, 0.15));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.raycast = noRaycast;
    return mesh;
  }

  /**
   * La Divinidad, inmóvil en el centro y ajena a los dos bandos.
   *
   * La comparten los tres estilos —cada uno la apoya a la altura de su propio
   * remate central— y por eso vive acá y no repetida en cada constructora: el
   * estilo 'moderno' se había quedado sin ella justamente porque cada una
   * armaba la suya por separado y esa se olvidó.
   */
  private addDivinidad(y: number): void {
    const divinidad = buildPieceMesh('DI', 'neutral', this.piecePalette);
    divinidad.position.set(0, y, 0);
    divinidad.scale.setScalar(1.15);
    divinidad.traverse((o) => {
      o.raycast = noRaycast;
    });
    this.scene.add(divinidad);
  }

  /**
   * Ornamentos del estilo 'madera': filetes de latón embutidos entre anillos,
   * Meridiana embutida y roseta central.
   *
   * Los filetes entre anillos son más gruesos que las juntas entre casillas,
   * igual que en una marquetería real: primero se arma el anillo y después se
   * embuten los aros que lo separan del vecino. Eso hace que los siete anillos
   * se lean como siete, y no como una masa de casillas.
   */
  private buildOrnamentsMadera(): void {
    const y = TILE_TOP - 0.02;

    // filete entre anillo y anillo, en los bordes internos y externos
    const radios = new Set<number>();
    for (const [r0, r1] of RING_BOUNDS) {
      radios.add(r0);
      radios.add(r1);
    }
    for (const r of radios) {
      const aro = new THREE.Mesh(
        new THREE.RingGeometry(r * BOARD_R - 0.42, r * BOARD_R + 0.42, 160),
        this.mat(COL_LATON_PLANO, 0.32, 0.45),
      );
      aro.rotation.x = -Math.PI / 2;
      aro.position.y = y + 0.34;
      aro.raycast = noRaycast;
      this.scene.add(aro);
    }

    // Meridiana: pletina de latón que cruza el tablero de lado a lado
    const largo = (BORDER_R - CENTER_R) * BOARD_R;
    const medio = ((BORDER_R + CENTER_R) / 2) * BOARD_R;
    for (const s of [-1, 1]) {
      const barra = new THREE.Mesh(new THREE.BoxGeometry(largo, 0.5, 1.5), this.mat(COL_LATON_PLANO, 0.3, 0.5));
      barra.position.set(s * medio, y + 0.5, 0);
      barra.castShadow = true;
      barra.raycast = noRaycast;
      this.scene.add(barra);
    }

    // roseta central de latón, donde se apoya la Divinidad
    const roseta = new THREE.Mesh(
      new THREE.CylinderGeometry(CENTER_R * BOARD_R, CENTER_R * BOARD_R * 1.05, 1.6, 64),
      this.mat(COL_LATON_PLANO, 0.34, 0.5),
    );
    roseta.position.y = y + 0.3;
    roseta.castShadow = true;
    roseta.receiveShadow = true;
    roseta.raycast = noRaycast;
    this.scene.add(roseta);
    this.scene.add(
      this.thinStar(CENTER_R * BOARD_R * 0.66, CENTER_R * BOARD_R * 0.24, COL_NOGAL, -Math.PI / 2, y + 1.1),
    );

    this.addDivinidad(y + 1.1);
  }

  private buildOrnaments(): void {
    if (this.style === 'madera') {
      this.buildOrnamentsMadera();
      return;
    }
    if (this.style === 'moderno') {
      this.buildOrnamentsModerno();
      return;
    }
    // Meridiana: línea roja fina que cruza el tablero por debajo de los discos
    const len = (BORDER_R - 0.02) * BOARD_R * 2;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.9), this.mat(COL_MERIDIANA, 0.6));
    bar.position.set(0, BOARD_TOP + 0.06, 0);
    bar.raycast = noRaycast;
    this.scene.add(bar);

    // Estrella central: rosa de los vientos roja y azul
    this.scene.add(this.thinStar(26, 2.2, COL_MERIDIANA, 0, BOARD_TOP + 0.08));
    this.scene.add(this.thinStar(19, 1.8, 0x51677f, Math.PI / 8, BOARD_TOP + 0.1));

    // círculo estrellado del centro (cielo con estrellitas, como la lámina)
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2c3550';
    ctx.beginPath();
    ctx.arc(64, 64, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e2cc';
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 52;
      const x = 64 + rr * Math.cos(a);
      const y = 64 + rr * Math.sin(a);
      const s = 1.5 + rnd() * 2.2;
      ctx.beginPath();
      for (let j = 0; j < 10; j++) {
        const aa = (j / 10) * Math.PI * 2 - Math.PI / 2;
        const sr = j % 2 === 0 ? s : s * 0.45;
        if (j === 0) ctx.moveTo(x + sr * Math.cos(aa), y + sr * Math.sin(aa));
        else ctx.lineTo(x + sr * Math.cos(aa), y + sr * Math.sin(aa));
      }
      ctx.closePath();
      ctx.fill();
    }
    const skyTex = new THREE.CanvasTexture(c);
    const skyTop = new THREE.MeshStandardMaterial({ map: skyTex, roughness: 0.6 });
    const sky = new THREE.Mesh(
      new THREE.CylinderGeometry(CENTER_R * BOARD_R * 0.72, CENTER_R * BOARD_R * 0.72, 0.9, 40),
      [this.mat(0x2c3550, 0.6), skyTop, this.mat(0x2c3550, 0.6)],
    );
    sky.position.y = BOARD_TOP + 0.5;
    sky.castShadow = true;
    sky.raycast = noRaycast;
    this.scene.add(sky);

    this.addDivinidad(BOARD_TOP + 0.9);
  }

  /** Ornamentos del estilo 'moderno': medallón dorado, marcas y meridiana gruesa. */
  private buildOrnamentsModerno(): void {
    const top = TILE_TOP + 0.03;
    // medallón central de la Divinidad
    const medallion = new THREE.Mesh(
      new THREE.CylinderGeometry(CENTER_R * BOARD_R, CENTER_R * BOARD_R * 1.04, 2.4, 48),
      this.mat(0xd9b673, 0.35, 0.7),
    );
    medallion.position.y = top - 1.0 + 1.2;
    medallion.castShadow = true;
    medallion.receiveShadow = true;
    medallion.raycast = noRaycast;
    this.scene.add(medallion);
    const star = this.thinStar(CENTER_R * BOARD_R * 0.62, CENTER_R * BOARD_R * 0.26, 0x8a6a3c, -Math.PI / 2, top + 1.45);
    this.scene.add(star);
    this.addDivinidad(top + 1.45);

    // Meridiana roja
    const len = (BORDER_R - CENTER_R - 0.02) * BOARD_R;
    const mid = ((BORDER_R + CENTER_R) / 2) * BOARD_R;
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, 1.1), this.mat(0x8f2c2c, 0.5));
      bar.position.set(s * mid, top + 0.2, 0);
      bar.raycast = noRaycast;
      this.scene.add(bar);
    }

    // marcas de origen: rombos (Ídolos) y tachuelas (Ejército)
    for (const idx of [2, 6, 10, 14, 18, 22]) {
      const p = cellCenter3d({ ring: IDOLOS_RING, idx });
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), this.mat(0xb6862f, 0.35, 0.8));
      d.position.set(p.x, top + 0.5, p.z);
      d.scale.y = 0.55;
      d.raycast = noRaycast;
      this.scene.add(d);
    }
    for (let idx = 0; idx < 24; idx++) {
      if (idx === 0 || idx === 12) continue;
      const p = cellCenter3d({ ring: EJERCITO_RING, idx });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), this.mat(0xd9b673, 0.35, 0.8));
      dot.position.set(p.x, top + 0.2, p.z);
      dot.raycast = noRaycast;
      this.scene.add(dot);
    }
  }

  /* ---------- piezas ---------- */

  syncPieces(state: GameState): void {
    const alive = new Set<number>();
    for (const p of state.pieces) {
      if (!p.alive || p.type === 'DI') continue;
      alive.add(p.id);
      let group = this.pieceMeshes.get(p.id);
      if (!group) {
        group = buildPieceMesh(p.type, p.owner, this.piecePalette);
        group.userData.pieceId = p.id;
        this.pieceMeshes.set(p.id, group);
        this.piecesGroup.add(group);
      }
      const pos = cellCenter3d({ ring: p.ring, idx: p.idx });
      group.position.copy(pos);
      group.scale.setScalar(1);
      group.userData.cell = { ring: p.ring, idx: p.idx };
    }
    for (const [id, group] of [...this.pieceMeshes]) {
      if (!alive.has(id)) {
        this.piecesGroup.remove(group);
        this.pieceMeshes.delete(id);
      }
    }
  }

  private tween(dur: number, update: (k: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const tw: Tween = { t0: performance.now(), dur, update, done: resolve };
      this.tweens.push(tw);
      // red de seguridad: si el rAF está pausado (pestaña oculta), la
      // animación se completa igual y el juego no queda bloqueado
      window.setTimeout(() => this.finishTween(tw), dur + 120);
    });
  }

  private finishTween(tw: Tween): void {
    const i = this.tweens.indexOf(tw);
    if (i === -1) return;
    this.tweens.splice(i, 1);
    tw.update(1);
    tw.done?.();
  }

  private runTweens(now: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const k = Math.min(1, (now - tw.t0) / tw.dur);
      tw.update(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        tw.done?.();
      }
    }
  }

  get animating(): boolean {
    return this.tweens.length > 0;
  }

  /** Salto de la pieza; la capturada se hunde y desaparece. */
  animateMove(pieceId: number, to: Cell, capturedId: number | null): Promise<void> {
    const group = this.pieceMeshes.get(pieceId);
    if (!group) return Promise.resolve();
    const from = group.position.clone();
    const dest = cellCenter3d(to);
    const dist = from.distanceTo(dest);
    const hop = Math.min(Math.max(dist * 0.3, 5), 20);
    group.userData.cell = { ...to };

    const victim = capturedId !== null ? this.pieceMeshes.get(capturedId) : undefined;
    if (victim) {
      const vp = victim.position.clone();
      void this.tween(460, (k) => {
        if (k < 0.5) return;
        const j = ease((k - 0.5) / 0.5);
        victim.scale.setScalar(1 - j * 0.95);
        victim.position.y = vp.y - j * 2.5;
      }).then(() => {
        this.piecesGroup.remove(victim);
        if (capturedId !== null) this.pieceMeshes.delete(capturedId);
      });
    }
    return this.tween(460, (k) => {
      const e = ease(k);
      group.position.lerpVectors(from, dest, e);
      group.position.y = TILE_TOP + Math.sin(Math.PI * e) * hop;
    }).then(() => {
      group.position.copy(dest);
    });
  }

  /** Canje: los sacrificios se hunden y el Diablo emerge en su casilla. */
  animateCanje(dbId: number, dbCell: Cell, sacrificeIds: number[]): Promise<void> {
    for (const id of sacrificeIds) {
      const g = this.pieceMeshes.get(id);
      if (!g) continue;
      const gp = g.position.clone();
      void this.tween(600, (k) => {
        const e = ease(k);
        g.scale.setScalar(1 - e * 0.95);
        g.position.y = gp.y - e * 3;
        g.rotation.y = e * 2.5;
      }).then(() => {
        this.piecesGroup.remove(g);
        this.pieceMeshes.delete(id);
      });
    }
    // el Diablo aún no existe como mesh (estaba muerto): se crea al sincronizar
    return this.tween(750, () => {}).then(() => {
      void dbId;
      void dbCell;
    });
  }

  /* ---------- marcadores ---------- */

  updateMarkers(selected: Piece | null, dests: MoveDest[], lastMove: Cell[] | null): void {
    this.markersGroup.clear();
    const flat = (geo: THREE.BufferGeometry, color: number, opacity: number, pos: THREE.Vector3, y: number): void => {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(pos.x, y, pos.z);
      m.raycast = noRaycast;
      this.markersGroup.add(m);
    };
    if (lastMove) {
      for (const cell of lastMove) {
        const s = markerSize(cell);
        flat(new THREE.RingGeometry(s * 0.95, s * 1.2, 32), 0xd9b673, 0.6, cellCenter3d(cell), DISC_TOP + 0.1);
      }
    }
    if (selected) {
      const cell = { ring: selected.ring, idx: selected.idx };
      const s = markerSize(cell);
      flat(new THREE.RingGeometry(s * 0.95, s * 1.32, 32), 0xffd873, 0.95, cellCenter3d(cell), DISC_TOP + 0.12);
    }
    for (const d of dests) {
      const s = markerSize(d);
      const pos = cellCenter3d(d);
      if (d.capture) {
        flat(new THREE.RingGeometry(s * 0.95, s * 1.35, 32), 0xc23a3a, 0.9, pos, DISC_TOP + 0.12);
      } else {
        flat(new THREE.CircleGeometry(s * 0.42, 24), 0x2e5e38, 0.55, pos, DISC_TOP + 0.12);
      }
    }
  }

  /* ---------- picking / tamaño ---------- */

  /** Con `tilesOnly` el rayo ignora las piezas: sirve para destinos tapados
   *  visualmente por una pieza alta. */
  pick(clientX: number, clientY: number, tilesOnly = false): Cell | null {
    this.camera.updateMatrixWorld();
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = tilesOnly ? [this.cellsGroup] : [this.piecesGroup, this.cellsGroup];
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const h of hits) {
      let obj: THREE.Object3D | null = h.object;
      while (obj) {
        if (obj.userData.cell) return obj.userData.cell as Cell;
        obj = obj.parent;
      }
    }
    return null;
  }

  resize(size: number): void {
    this.renderer.setSize(size, size);
    this.camera.aspect = 1;
    this.camera.updateProjectionMatrix();
  }
}
