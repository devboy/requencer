import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  base: '/requencer/',
  build: {
    outDir: 'dist',
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['requencer-web'],
  },
})
