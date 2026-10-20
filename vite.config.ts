import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT || 43123),
    host: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.HELPER_PORT || 3001}` },
  },
});
