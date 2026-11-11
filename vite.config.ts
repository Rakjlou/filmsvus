import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': `http://127.0.0.1:${process.env.PORT ?? 3000}`,
      '/posters': `http://127.0.0.1:${process.env.PORT ?? 3000}`,
    },
  },
});
