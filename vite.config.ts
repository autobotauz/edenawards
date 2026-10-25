import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiPort = process.env.API_PORT ?? '8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false, xfwd: true },
    },
  },
});
