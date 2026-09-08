import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Native modules and Node built-ins must not be bundled; better-sqlite3 in
    // particular is a compiled binary that cannot be inlined.
    plugins: [externalizeDepsPlugin({ exclude: ['@vaultp/core'] })],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/main/main.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/preload.ts'),
        // CommonJS: a sandboxed preload cannot be an ES module.
        output: { format: 'cjs', entryFileNames: 'preload.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
