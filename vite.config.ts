import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 4200),
    // Keep the browser's Host header so the API's Origin check matches, like nginx in production.
    proxy: {
      '/api/': { target: `http://127.0.0.1:${process.env.PORT ?? 3210}`, changeOrigin: false },
      '/posters/': { target: `http://127.0.0.1:${process.env.PORT ?? 3210}`, changeOrigin: false },
    },
  },
});
