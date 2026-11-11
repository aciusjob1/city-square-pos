import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only proxy: /api/* → http://localhost:3000/api/*
// Production builds are separate so a future installer can package each client
// independently while they continue to share the same backend.
export default defineConfig(({ mode }) => ({
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
  build: {
    outDir: mode === 'waiter' ? 'dist-waiter' : mode === 'staff' ? 'dist-staff' : 'dist',
    emptyOutDir: true,
  },
}));
