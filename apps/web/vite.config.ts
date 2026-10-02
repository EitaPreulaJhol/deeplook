import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Carbon referencia as fontes IBM Plex com o prefixo webpack `~`.
    // Este alias permite que o Vite resolva e empacote os arquivos.
    alias: [{ find: /^~/, replacement: '' }],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // O console do sandbox usa WebSocket (noVNC).
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // O noVNC (decoder H264) usa top-level await, indisponivel no alvo padrao.
    target: 'es2022',
  },
});
