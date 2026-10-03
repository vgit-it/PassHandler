import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

// Settings → About shows this. Read at build time from package.json, so
// there's no runtime call (and nothing to keep in sync by hand).
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }
).version;

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

  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See src/platform/xmldomShim.ts: kdbxweb eagerly imports
      // @xmldom/xmldom, and that import alone crashes the app under
      // tauri.conf.json's security.freezePrototype. The real package is
      // never needed here — the Tauri webview always has a native
      // DOMParser/XMLSerializer, which is what kdbxweb prefers anyway.
      '@xmldom/xmldom': fileURLToPath(new URL('./src/platform/xmldomShim.ts', import.meta.url)),
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
