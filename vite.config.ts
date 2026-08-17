import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const host = process.env.TAURI_DEV_HOST;

// Vite tags the built entry script and stylesheet `crossorigin` by default,
// which is meant for genuinely cross-origin CDN deployments. Nothing here
// ever is: Tauri serves index.html and its assets from the same custom-scheme
// origin, always. The attribute only adds a CORS check to a same-origin
// request, and Android's WebView is the platform most likely to handle that
// check differently for a non-http(s) scheme — an unforced failure mode with
// no upside, so it is stripped from the built HTML.
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '');
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stripCrossorigin()],

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
