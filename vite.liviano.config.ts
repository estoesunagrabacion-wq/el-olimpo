import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build liviano: el mismo juego, con el tablero en canvas 2D en vez de la
 * escena three.js.
 *
 * Se hace como build aparte y no como una opción dentro del build principal
 * porque el artefacto es un HTML autocontenido: `viteSingleFile` incrusta todo
 * el JS en el archivo, así que un `import()` diferido de three.js igual
 * quedaría adentro. La única forma de que no pese es que no se importe nunca,
 * y eso se logra sustituyendo el módulo `boardimpl` por su versión liviana.
 */
const aqui = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      // solo main.ts importa './boardimpl', así que el alias no toca nada más
      { find: './boardimpl', replacement: aqui('./src/boardimpl.liviano.ts') },
    ],
  },
  build: {
    // convive con el build principal en dist/, que corre antes
    emptyOutDir: false,
    rollupOptions: { input: aqui('./liviano.html') },
  },
  plugins: [viteSingleFile()],
});
