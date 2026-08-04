import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  base: './',
  // El build produce un único dist/index.html autocontenido (CSS, JS y
  // worker de la IA incrustados) que funciona con doble clic desde file://.
  plugins: [viteSingleFile()],
});
