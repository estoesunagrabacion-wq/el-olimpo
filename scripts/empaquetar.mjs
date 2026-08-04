/**
 * Post-build: deja el bundle autocontenido con un nombre que identifique
 * qué se está compartiendo (el juego y su versión), en vez del index.html
 * genérico que produce Vite.
 *
 * La versión sale de package.json, así que alcanza con subirla ahí para que
 * el archivo compartible cambie de nombre solo.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const { name, version } = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

// El build principal deja index.html y el liviano deja liviano.html; cada uno
// se copia a su nombre publicable.
const salidas = [
  { archivo: 'index.html', sufijo: '', que: 'tablero 3D' },
  { archivo: 'liviano.html', sufijo: '-liviano', que: 'tablero 2D, sin WebGL' },
];

console.log('');
for (const { archivo, sufijo, que } of salidas) {
  const origen = join(raiz, 'dist', archivo);
  if (!existsSync(origen)) {
    console.error(`No existe dist/${archivo}: ¿corriste "vite build" antes?`);
    process.exit(1);
  }
  const nombre = `${name}-v${version}${sufijo}.html`;
  copyFileSync(origen, join(raiz, 'dist', nombre));
  const kb = (readFileSync(origen).length / 1024).toFixed(0);
  console.log(`Para compartir: dist/${nombre} — ${kb} kB, autocontenido (${que})`);
}
