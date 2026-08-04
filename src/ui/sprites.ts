/**
 * Sprites de las piezas como medallones: disco en el color del bando con el
 * emblema distintivo de cada tipo (tomado de los remates del rediseño) bien
 * legible a escala de casilla. Se generan como data-URI y se cachean como
 * HTMLImageElement para dibujar en canvas; también se usan en la leyenda y
 * en la lista de piezas capturadas.
 */

import type { Owner, PieceType } from '../engine/types';

export type TokenOwner = Owner | 'neutral';

interface TeamColors {
  rim: string;
  disc: string;
}

const TEAM: Record<TokenOwner, TeamColors> = {
  rojo: { rim: '#4a1414', disc: '#8f2c2c' },
  dorado: { rim: '#6b4e10', disc: '#b6862f' },
  neutral: { rim: '#8a6a3c', disc: '#d9b673' },
};

const INK = '#3a2a18';
const CREAM = '#f2e9d3';

/** Emblema centrado en un campo de radio ~30 (viewBox del token: ±50). */
function emblem(type: PieceType): string {
  switch (type) {
    case 'DI': // estrella-sol de la Divinidad
      return `
  <circle r="12" fill="#b6862f" stroke="${INK}" stroke-width="2.2"/>
  <g stroke="${INK}" stroke-width="2.4" stroke-linecap="round">
    <line x1="0" y1="-18" x2="0" y2="-27"/><line x1="0" y1="18" x2="0" y2="27"/>
    <line x1="-18" y1="0" x2="-27" y2="0"/><line x1="18" y1="0" x2="27" y2="0"/>
    <line x1="-13" y1="-13" x2="-19" y2="-19"/><line x1="13" y1="13" x2="19" y2="19"/>
    <line x1="-13" y1="13" x2="-19" y2="19"/><line x1="13" y1="-13" x2="19" y2="-19"/>
  </g>`;
    case 'VI': // figura con manto y cabeza
      return `
  <path d="M -20,20 C -20,-6 20,-6 20,20 Z" fill="#b6862f" stroke="${INK}" stroke-width="2.6"/>
  <circle cx="0" cy="-15" r="10" fill="#b6862f" stroke="${INK}" stroke-width="2.6"/>`;
    case 'ID': // pebetero con brotes
      return `
  <ellipse cx="0" cy="14" rx="14" ry="7" fill="#c9a15a" stroke="${INK}" stroke-width="2.4"/>
  <line x1="0" y1="9" x2="0" y2="-6" stroke="${INK}" stroke-width="2.6"/>
  <g stroke="${INK}" stroke-width="2.2">
    <line x1="0" y1="-6" x2="-13" y2="-19"/>
    <line x1="0" y1="-6" x2="0" y2="-24"/>
    <line x1="0" y1="-6" x2="13" y2="-19"/>
  </g>
  <circle cx="-13" cy="-19" r="4.5" fill="#c9a15a" stroke="${INK}" stroke-width="1.8"/>
  <circle cx="0" cy="-24" r="4.5" fill="#c9a15a" stroke="${INK}" stroke-width="1.8"/>
  <circle cx="13" cy="-19" r="4.5" fill="#c9a15a" stroke="${INK}" stroke-width="1.8"/>`;
    case 'PO': // báculo doble (mitra estilizada)
      return `
  <path d="M -6,24 L -6,-6 C -6,-20 -24,-24 -26,-12 C -27,-2 -16,0 -9,-6" fill="none" stroke="${INK}" stroke-width="4.6" stroke-linecap="round"/>
  <path d="M 6,24 L 6,-6 C 6,-20 24,-24 26,-12 C 27,-2 16,0 9,-6" fill="none" stroke="${INK}" stroke-width="4.6" stroke-linecap="round"/>
  <line x1="-8" y1="6" x2="8" y2="6" stroke="#8a6a3c" stroke-width="5" stroke-linecap="round"/>`;
    case 'PU': // gorro frigio
      return `
  <path d="M -19,16 C -19,24 19,24 19,16 L 14,-8 C 23,-12 23,-23 14,-25 C 3,-29 -9,-28 -17,-21 C -23,-16 -21,-9 -12,-8 Z" fill="#dcb2a8" stroke="${INK}" stroke-width="2.6"/>
  <line x1="0" y1="16" x2="0" y2="8" stroke="${INK}" stroke-width="2.2"/>`;
    case 'CU': // estrella de ocho puntas del Sacerdote
      return `
  <polygon points="0,-24 4.4,-10.6 17,-17 10.6,-4.4 24,0 10.6,4.4 17,17 4.4,10.6 0,24 -4.4,10.6 -17,17 -10.6,4.4 -24,0 -10.6,-4.4 -17,-17 -4.4,-10.6"
    fill="#c9c2ab" stroke="${INK}" stroke-width="2"/>`;
    case 'DB': // el cuerno del Diablo
      return `
  <path d="M -15,-19 C -28,1 -13,23 11,19 C -7,11 -9,-9 6,-24 C -3,-27 -11,-25 -15,-19 Z" fill="#8f2c2c" stroke="${INK}" stroke-width="2.6"/>
  <circle cx="10" cy="-14" r="4" fill="#8f2c2c" stroke="${INK}" stroke-width="1.6"/>`;
  }
}

export function tokenSvg(type: PieceType, owner: TokenOwner): string {
  const t = TEAM[owner];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="128" height="128">
  <defs>
    <radialGradient id="sheen" cx="36%" cy="30%" r="85%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.18"/>
    </radialGradient>
  </defs>
  <circle r="46" fill="${t.disc}"/>
  <circle r="46" fill="url(#sheen)"/>
  <circle r="46" fill="none" stroke="${t.rim}" stroke-width="5"/>
  <circle r="33.5" fill="${CREAM}" stroke="${t.rim}" stroke-width="1.8"/>
  ${emblem(type)}
  <circle r="47.5" fill="none" stroke="#241a10" stroke-width="1.8"/>
</svg>`;
}

export function tokenDataUri(type: PieceType, owner: TokenOwner): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tokenSvg(type, owner));
}

export type SpriteMap = Map<string, HTMLImageElement>;

export function loadSprites(): Promise<SpriteMap> {
  const types: PieceType[] = ['VI', 'ID', 'PO', 'PU', 'CU', 'DB'];
  const owners: TokenOwner[] = ['rojo', 'dorado'];
  const map: SpriteMap = new Map();
  const jobs: Promise<void>[] = [];
  for (const t of types) {
    for (const o of owners) {
      const img = new Image();
      jobs.push(
        new Promise((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('sprite ' + t + '-' + o));
          img.src = tokenDataUri(t, o);
        }),
      );
      map.set(t + '-' + o, img);
    }
  }
  return Promise.all(jobs).then(() => map);
}
