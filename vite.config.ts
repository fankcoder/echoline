import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${env.VITE_API_PORT || 4173}` },
    },
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks: { media: ['hls.js'], router: ['react-router-dom'] },
        },
      },
    },
  };
});
