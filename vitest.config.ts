import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// The vault and sync layers are deliberately free of platform code, so they run
// unmodified under Node. Node 22 provides `crypto.subtle` and
// `crypto.getRandomValues` as globals, which is everything `kdbxweb` needs.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Argon2 key derivation is intentionally slow. The fixtures use low
    // parameters, but a cold WASM compile on a loaded machine still needs room.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
