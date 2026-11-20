import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'main',
  base: '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'main/index.html'),
        control: resolve(__dirname, 'main/control.html'),
      },
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
