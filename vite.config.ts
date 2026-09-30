import { defineConfig } from 'vite';

export default defineConfig({
  base: '/newgame2/',
  build: {
    target: 'es2022',
    sourcemap: true
  }
});
