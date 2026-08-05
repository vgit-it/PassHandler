import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Everything ships in the bundle. Nothing is fetched at runtime — no CDN, no
  // remote fonts, no remote wasm. `hash-wasm` inlines its WebAssembly as a
  // base64 string, so the Argon2 implementation is part of the JS bundle too.
  build: {
    target: ['es2022', 'chrome105', 'safari15'],
    assetsInlineLimit: 0,
    sourcemap: false,
    minify: 'esbuild',
  },

  // Tauri expects a fixed port and must not silently fall back to another one.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
