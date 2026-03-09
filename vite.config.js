import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/img-converter/',
  server: {
    // Required headers to enable SharedArrayBuffer (needed by ffmpeg.wasm multi-thread)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
  },
});
