import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      'electron/main': 'electron/main.ts',
      'electron/preload': 'electron/preload.ts',
    },
    format: ['cjs'],
    target: 'node22',
    platform: 'node',
    outDir: 'dist',
    sourcemap: false,
    clean: true,
    external: ['electron', 'electron-store', 'electron-updater', 'electron-log'],
  },
]);
