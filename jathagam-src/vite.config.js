import { defineConfig } from 'vite';

// Built into ../jathagam so GitHub Pages (served from the repo root of the
// default branch) publishes it at /jathagam/. Relative base keeps it portable.
export default defineConfig({
  base: './',
  build: { outDir: '../jathagam', emptyOutDir: true, sourcemap: false },
  test: { include: ['test/**/*.test.js'] },
});
