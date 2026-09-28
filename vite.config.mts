import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5183, strictPort: true },
});
