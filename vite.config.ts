import { defineConfig } from 'vite';

export default defineConfig({
  root: 'main',
  base: '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
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
