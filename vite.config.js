import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: './index.html',
        // add other html entry points if needed
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
