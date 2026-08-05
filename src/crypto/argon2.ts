import { argon2d, argon2id } from 'hash-wasm';
import * as kdbxweb from 'kdbxweb';

/**
 * Supply `kdbxweb` with an Argon2 implementation.
 *
 * `kdbxweb` ships AES-KDF but deliberately not Argon2 — there is no single fast
 * implementation that suits every host, so it leaves the choice to the caller.
 * Without this wiring every KDBX4 file fails to open, and KDBX4 with Argon2 is
 * what KeePassXC writes by default.
 *
 * `hash-wasm` is used because it embeds its WebAssembly as a base64 string
 * inside the JavaScript module. Nothing is fetched at runtime, which keeps the
 * app's "bundle every asset, load nothing over the network" rule intact and
 * lets the Content Security Policy stay at `default-src 'self'`.
 *
 * This is not us writing cryptography. It is us handing `kdbxweb` a well-known
 * Argon2 implementation and letting it drive.
 */

let installed = false;

export function installArgon2(): void {
  if (installed) return;
  installed = true;

  kdbxweb.CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      // `kdbxweb` has already converted memory from the file's byte count into
      // kibibytes, which is what hash-wasm's `memorySize` expects.
      if (version !== 0x13) {
        // 0x10 is Argon2 v1.0, superseded in 2015 and not implemented by
        // hash-wasm. Refusing is correct: a silent downgrade to a different
        // version would produce a wrong key and look like a wrong password.
        throw new Error('unsupported-argon2-version');
      }

      const options = {
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        iterations,
        parallelism,
        memorySize: memory,
        hashLength: length,
        outputType: 'binary' as const,
      };

      const hash =
        type === kdbxweb.CryptoEngine.Argon2TypeArgon2id
          ? await argon2id(options)
          : await argon2d(options);

      // Copy out of hash-wasm's buffer: it reuses its WASM memory between
      // calls, so the returned view would otherwise be invalidated by the next
      // derivation.
      return hash.slice().buffer;
    },
  );
}
