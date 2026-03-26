import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/onchain-intel/' : '/',
  plugins: [glsl()],
  build: {
    target: 'esnext',
    minify: 'esbuild',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
