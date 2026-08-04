/**
 * Piezas 3D modeladas a partir de la lámina "Tamaño natural" del libro de
 * 1891: cada tipo tiene su propio cuerpo torneado (LatheGeometry) y su remate
 * característico — parasol (Virtud), globo sobre columna (Divinidad), copa
 * gallonada (Pueblo), remate hendido (Pontífice), media luna (Diablo),
 * cápsula coronada (Ídolo) y coronita (Sacerdote). Las alturas relativas
 * también siguen la lámina.
 * Además genera, con un renderer temporal, los iconos 2D (data-URL) que usan
 * la leyenda y la lista de capturas.
 */

import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Owner, PieceType } from '../engine/types';

/**
 * Ángulo a partir del cual una arista del torneado se considera viva.
 *
 * LatheGeometry promedia las normales entre segmentos vecinos del perfil, así
 * que los filetes y las gargantas —que en madera torneada son aristas netas—
 * salían redondeados y las piezas parecían de cera. `toCreasedNormals` parte
 * la normal donde el quiebre supera este umbral: la curva sigue suave y el
 * filete vuelve a marcarse.
 */
const ARISTA_VIVA = THREE.MathUtils.degToRad(32);

/** 'neutral' es la Divinidad: marfil con el globo azul de la lámina en color. */
export type PieceOwner = Owner | 'neutral';

interface Mats {
  body: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
}

/**
 * Acabado de las piezas.
 *  - 'pintado': la lámina en color del libro, ocre contra caoba.
 *  - 'madera': madera sin pintar, boj claro contra palisandro, con los remates
 *    en latón. Es el que acompaña al tablero de marquetería.
 */
export type PiecePalette = 'pintado' | 'madera';

type BodyLook = { color: number; rough: number; metal: number };

const BODY_COLORS: Record<PiecePalette, Record<PieceOwner, BodyLook>> = {
  pintado: {
    rojo: { color: 0x74352a, rough: 0.35, metal: 0.1 },
    dorado: { color: 0xbf9434, rough: 0.42, metal: 0.3 },
    neutral: { color: 0xe9e2cd, rough: 0.5, metal: 0.05 },
  },
  madera: {
    // sin barniz: mucha rugosidad y nada de metal, para que se lea la talla
    rojo: { color: 0x5e3320, rough: 0.72, metal: 0.0 },
    dorado: { color: 0xd8bb84, rough: 0.68, metal: 0.0 },
    neutral: { color: 0xefe6d0, rough: 0.62, metal: 0.0 },
  },
};

const ACCENT: Record<PiecePalette, number> = { pintado: 0xd9b673, madera: 0xc9a227 };

const matsCache = new Map<string, Mats>();

function mats(owner: PieceOwner, palette: PiecePalette): Mats {
  const key = palette + ':' + owner;
  let m = matsCache.get(key);
  if (!m) {
    const body = BODY_COLORS[palette][owner];
    m = {
      body: new THREE.MeshStandardMaterial({ color: body.color, roughness: body.rough, metalness: body.metal }),
      gold: new THREE.MeshStandardMaterial({ color: ACCENT[palette], roughness: 0.3, metalness: 0.85 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x4a7f9e, roughness: 0.35, metalness: 0.2 }),
    };
    matsCache.set(key, m);
  }
  return m;
}

function lathe(points: [number, number][], mat: THREE.Material, segments = 36): THREE.Mesh {
  const pts = points.map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(toCreasedNormals(new THREE.LatheGeometry(pts, segments), ARISTA_VIVA), mat);
  mesh.castShadow = true;
  return mesh;
}

function add(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

/* ---------- una constructora por pieza, según la lámina ---------- */

function buildVirtud(g: THREE.Group, m: Mats): void {
  // cuerpo: zócalo, ánfora panzona, bola y cuello
  g.add(
    lathe(
      [
        [0, 0], [3.4, 0], [3.6, 0.5], [3.1, 1.2], [2.5, 1.6],
        [2.9, 2.4], [3.15, 3.8], [2.9, 5.2], [2.1, 6.3], [1.35, 6.9],
        [1.9, 7.3], [1.15, 7.8],
        [1.95, 8.5], [2.2, 9.3], [1.8, 10.1], [0.85, 10.5], [0.7, 11.0], [0, 11.0],
      ],
      m.body,
    ),
  );
  // parasol acanalado
  add(g, new THREE.ConeGeometry(4.4, 1.6, 28), m.body, [0, 11.8, 0]);
  add(g, new THREE.CylinderGeometry(1.0, 1.3, 0.5, 20), m.body, [0, 12.7, 0]);
  // capullo
  add(g, new THREE.SphereGeometry(0.95, 18, 14), m.body, [0, 13.5, 0], [0, 0, 0], [1, 1.25, 1]);
}

function buildDivinidad(g: THREE.Group, m: Mats): void {
  // plinto cuadrado
  add(g, new THREE.BoxGeometry(6.8, 1.2, 6.8), m.body, [0, 0.6, 0]);
  add(g, new THREE.BoxGeometry(5.6, 0.8, 5.6), m.body, [0, 1.6, 0]);
  // collar de perlas
  add(g, new THREE.TorusGeometry(2.15, 0.35, 10, 24), m.body, [0, 2.3, 0], [Math.PI / 2, 0, 0]);
  // fuste estriado (cilindro con anillos)
  add(g, new THREE.CylinderGeometry(1.9, 2.05, 8.2, 24), m.body, [0, 6.5, 0]);
  add(g, new THREE.TorusGeometry(2.0, 0.22, 8, 24), m.body, [0, 6.3, 0], [Math.PI / 2, 0, 0]);
  // capitel y ábaco
  add(g, new THREE.CylinderGeometry(2.7, 1.95, 1.4, 24), m.body, [0, 11.3, 0]);
  add(g, new THREE.BoxGeometry(5.6, 0.7, 5.6), m.body, [0, 12.3, 0]);
  // el globo terráqueo con meridianos dorados
  add(g, new THREE.SphereGeometry(3.1, 28, 20), m.blue, [0, 15.6, 0]);
  add(g, new THREE.TorusGeometry(3.12, 0.07, 8, 48), m.gold, [0, 15.6, 0], [0, 0, 0]);
  add(g, new THREE.TorusGeometry(3.12, 0.07, 8, 48), m.gold, [0, 15.6, 0], [0, Math.PI / 2, 0]);
  add(g, new THREE.TorusGeometry(3.12, 0.07, 8, 48), m.gold, [0, 15.6, 0], [Math.PI / 2, 0, 0]);
}

function buildPueblo(g: THREE.Group, m: Mats): void {
  // base de toros apilados
  g.add(
    lathe(
      [
        [0, 0], [3.3, 0], [3.4, 0.5], [2.9, 1.0], [3.2, 1.7], [2.5, 2.3],
        [2.8, 3.0], [1.9, 3.6], [1.05, 4.1], [0.95, 4.8],
      ],
      m.body,
    ),
  );
  // copa gallonada
  g.add(
    lathe(
      [
        [0.95, 4.8], [1.3, 5.2], [3.3, 6.1], [3.7, 7.0], [3.55, 7.5],
        [3.0, 7.2], [1.15, 6.6], [0.75, 6.9], [0, 6.9],
      ],
      m.body,
      32,
    ),
  );
  // hongo que asoma de la copa
  add(g, new THREE.CylinderGeometry(0.7, 0.8, 1.6, 16), m.body, [0, 7.6, 0]);
  add(g, new THREE.SphereGeometry(1.35, 20, 14), m.body, [0, 8.9, 0], [0, 0, 0], [1, 0.85, 1]);
}

function buildPontifice(g: THREE.Group, m: Mats): void {
  // cuerpo abarrilado
  g.add(
    lathe(
      [
        [0, 0], [2.8, 0], [2.9, 0.5], [2.4, 1.0],
        [2.65, 1.7], [2.85, 2.9], [2.6, 4.1], [1.9, 4.9],
        [2.2, 5.2], [1.3, 5.6],
        [1.75, 6.2], [1.8, 7.0], [1.0, 7.9], [0.45, 8.5], [0, 8.6],
      ],
      m.body,
    ),
  );
  // remate hendido: dos puntas que se abren
  const prong = new THREE.ConeGeometry(0.5, 1.9, 12);
  add(g, prong, m.body, [-0.55, 9.2, 0], [0, 0, 0.3]);
  add(g, prong, m.body, [0.55, 9.2, 0], [0, 0, -0.3]);
}

function buildDiablo(g: THREE.Group, m: Mats): void {
  // cuerpo anguloso de discos y biconos
  g.add(
    lathe(
      [
        [0, 0], [3.1, 0], [3.2, 0.5], [2.6, 1.0],
        [3.3, 1.6], [2.3, 2.1],
        [3.1, 3.1], [2.1, 4.0],
        [2.8, 4.5], [1.7, 5.0],
        [1.4, 5.7], [1.6, 6.3], [1.15, 6.9],
        [1.75, 7.4], [1.05, 7.9], [0, 8.0],
      ],
      m.body,
    ),
  );
  // la media luna, cuernos hacia arriba
  const arc = Math.PI * 1.35;
  const moon = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.6, 12, 48, arc), m.body);
  moon.position.set(0, 10.2, 0);
  moon.rotation.z = -Math.PI / 2 - arc / 2; // arco simétrico con el hueco arriba
  moon.castShadow = true;
  g.add(moon);
}

function buildIdolo(g: THREE.Group, m: Mats): void {
  // bulbo bajo y tallo anillado
  g.add(
    lathe(
      [
        [0, 0], [2.5, 0], [2.6, 0.5], [2.1, 0.9],
        [2.4, 1.7], [2.6, 2.7], [2.0, 3.7], [1.1, 4.4],
        [0.65, 5.0], [0.65, 7.6], [0, 7.6],
      ],
      m.body,
    ),
  );
  add(g, new THREE.TorusGeometry(0.85, 0.22, 8, 20), m.body, [0, 5.6, 0], [Math.PI / 2, 0, 0]);
  add(g, new THREE.TorusGeometry(0.85, 0.22, 8, 20), m.body, [0, 6.8, 0], [Math.PI / 2, 0, 0]);
  // cápsula de amapola
  add(g, new THREE.SphereGeometry(1.85, 22, 16), m.body, [0, 9.3, 0], [0, 0, 0], [1, 1.15, 1]);
  // coronita de puntas
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(
      g,
      new THREE.ConeGeometry(0.26, 0.8, 8),
      m.body,
      [Math.cos(a) * 0.95, 11.5, Math.sin(a) * 0.95],
      [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35],
    );
  }
}

function buildSacerdote(g: THREE.Group, m: Mats): void {
  // el peón: cuerpo pequeño torneado
  g.add(
    lathe(
      [
        [0, 0], [2.3, 0], [2.4, 0.45], [1.95, 0.85],
        [2.15, 1.4], [2.35, 2.4], [1.85, 3.2], [1.15, 3.8],
        [1.45, 4.1], [0.85, 4.5],
        [1.4, 5.1], [1.45, 5.8], [0.95, 6.4], [0, 6.5],
      ],
      m.body,
    ),
  );
  // coronita de cuatro puntas con botón central
  add(g, new THREE.CylinderGeometry(1.35, 1.1, 0.7, 16), m.body, [0, 6.8, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(
      g,
      new THREE.ConeGeometry(0.32, 1.0, 8),
      m.body,
      [Math.cos(a) * 1.05, 7.55, Math.sin(a) * 1.05],
      [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3],
    );
  }
  add(g, new THREE.SphereGeometry(0.55, 14, 10), m.body, [0, 7.5, 0]);
}

export function buildPieceMesh(type: PieceType, owner: PieceOwner, palette: PiecePalette = 'pintado'): THREE.Group {
  const m = mats(owner, palette);
  const group = new THREE.Group();
  switch (type) {
    case 'VI':
      buildVirtud(group, m);
      break;
    case 'DI':
      buildDivinidad(group, m);
      break;
    case 'PU':
      buildPueblo(group, m);
      break;
    case 'PO':
      buildPontifice(group, m);
      break;
    case 'DB':
      buildDiablo(group, m);
      break;
    case 'ID':
      buildIdolo(group, m);
      break;
    case 'CU':
      buildSacerdote(group, m);
      break;
  }
  return group;
}

export type IconMap = Map<string, string>;

/** Renderiza cada pieza a un data-URL para la leyenda y las capturas. */
export function makeIcons(): IconMap {
  const map: IconMap = new Map();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(96, 96);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xfff2dd, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 2.2);
  dir.position.set(20, 30, 25);
  scene.add(dir);
  const cam = new THREE.PerspectiveCamera(32, 1, 1, 200);
  cam.position.set(11, 13, 24);
  cam.lookAt(0, 6.2, 0);

  const types: PieceType[] = ['VI', 'ID', 'PO', 'PU', 'CU', 'DB'];
  const owners: Owner[] = ['rojo', 'dorado'];
  for (const t of types) {
    for (const o of owners) {
      const piece = buildPieceMesh(t, o);
      scene.add(piece);
      renderer.render(scene, cam);
      map.set(t + '-' + o, renderer.domElement.toDataURL());
      scene.remove(piece);
    }
  }
  renderer.dispose();
  return map;
}
