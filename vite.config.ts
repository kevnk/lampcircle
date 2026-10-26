import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  // LRCLIB asks clients to name themselves with a version.
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  // Keeps the Rust build's output visible under npm run tauri dev.
  clearScreen: false,
  server: {
    port: Number(process.env.PORT || 43123),
    host: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.HELPER_PORT || 3001}` },
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
