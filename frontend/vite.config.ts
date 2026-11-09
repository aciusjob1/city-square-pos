import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only proxy: /api/* → http://localhost:3000/api/*
// This avoids CORS entirely during development, and matches what a
// reverse proxy (nginx) will do in production.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
});
