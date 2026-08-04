# Security notes

The decisions worth writing down, including the ones that are weaker than they
first appear.

## Cryptography

**We write none of it.** Every encryption, decryption and key-derivation call
goes through [`kdbxweb`](https://github.com/keeweb/kdbxweb), which implements the
KeePass `.kdbx` format. There is no bespoke crypto in this codebase, and the
vault stays byte-compatible with KeePassXC in both directions.

### Argon2

`kdbxweb` deliberately ships no Argon2 implementation — it exposes
`CryptoEngine.setArgon2Impl()` and leaves the choice to the caller. Without it
every KDBX4 file fails to open, and KDBX4 with Argon2 is what KeePassXC writes
by default.

We supply [`hash-wasm`](https://github.com/Daninet/hash-wasm), which embeds its
WebAssembly as base64 inside the JavaScript module. Nothing is fetched at
runtime, so the "bundle every asset" rule holds and the CSP needs no exception
beyond `'wasm-unsafe-eval'`.

Argon2 v1.0 (`0x10`) is rejected rather than silently downgraded. It would
produce a wrong key that looks exactly like a wrong password.

### Work factors

Vaults created by this app use **64 MiB memory, 6 iterations, parallelism 2**,
tracking KeePassXC's defaults.

`kdbxweb`'s own defaults are 1 MiB and 2 iterations. At 1 MiB a memory-hard KDF
is not meaningfully memory-hard, and an attacker with the file gets a far
cheaper search than the format intends. These are plain header parameters, so
raising them costs nothing in interoperability — any KeePass client reads them
out of the file. Vaults created elsewhere keep whatever settings they arrived
with.

## Secrets in memory

- The master password is passed straight into `kdbxweb` as a `ProtectedValue`
  and is never held in React state. Password inputs are uncontrolled, read once
  from the DOM at submit time, and blanked before key derivation starts.
- Entry passwords are read one at a time, on demand, from the in-memory
  database. They never enter the entry list model, so they cannot appear in a
  render trace or a React DevTools snapshot.
- Locking drops the database reference and zeroes the retained password hash.

JavaScript offers no way to force a heap wipe, so this is hygiene rather than a
guarantee. The app compensates by locking aggressively: idle timeout, window
close, Android backgrounding, and manual lock.

## Biometric unlock — read this one carefully

After a successful password unlock, the app can store **the SHA-256 of the
master password** — what `kdbxweb` calls the composite key's `passwordHash` — in
OS secure storage. The master password itself is never persisted.

That stored value is **password-equivalent**: no KDF is applied to it, so
anything that can read it can open the vault. Its only protection is the
platform store plus the biometric gate. Concretely:

**Android** — `EncryptedSharedPreferences` with a master key generated inside
the Android Keystore (StrongBox where available, TEE otherwise). The key material
never leaves the Keystore; only ciphertext reaches disk. A `BiometricPrompt`
check gates the read.

That check is enforced at the app layer, not by binding the Keystore key with
`setUserAuthenticationRequired`. A key bound that way would make the guarantee
hardware-enforced rather than app-enforced, and is the obvious hardening step if
this ever matters more.

**Windows** — Credential Manager, via the `keyring` crate. Credential Manager has
**no per-entry biometric gate**: an entry is readable by any process running as
the logged-in user. The Windows Hello check happens in our process, before the
read. It stops a person at the keyboard; it does not stop code already running as
you.

This is weaker than the Android path, and weaker than it looks. It is recorded
here rather than papered over. Biometric unlock is off by default, and the
master password is still required on the first launch after a restart and after
any failed attempt.

## Network

The **only** network traffic in the entire app is Google Drive sync. No
telemetry, no analytics, no remote fonts, no remote assets, no update check.

All of it runs in Rust. The refresh token goes from the token endpoint straight
into OS secure storage and never crosses the IPC boundary; the access token never
leaves the process either. Consent opens in the system browser, never in our
webview.

A consequence worth stating: the webview's Content Security Policy contains **no
remote origins at all**.

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost;
object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
```

`'wasm-unsafe-eval'` is required by Argon2. `'unsafe-inline'` for styles is
Tailwind's runtime style injection; it grants no script execution.

### Certificate pinning — deliberately not implemented

The PRD asks for pinning on Drive API calls "if Tauri v2 makes it practical; if
not, document the decision and move on". This is that documentation.

Pinning Google's certificates would mean shipping a pin that expires on Google's
rotation schedule rather than ours. A rotation between releases would break sync
for everyone with an installed build and no way to fix it short of a new binary
— for three users on a hand-distributed app, that is a self-inflicted outage far
more likely than the attack it defends against. The threat model is a personal
password manager talking to Google over TLS with `rustls` and the webpki root
set, syncing a blob that is already encrypted with a key Google never sees. A
successful TLS interception would yield ciphertext.

Not implemented, on purpose.

## Tauri surface

The renderer cannot read a file, spawn a process, or make a network request. The
filesystem, shell, process and HTTP plugins are not permitted — they are not
dependencies at all. Every host operation goes through a named command in this
crate.

Errors crossing IPC are coarse by construction (`io`, `network`, `unauthorized`,
`conflict`, …). Nothing derived from vault contents can reach a console or a
crash report, including from inside error handlers.

Devtools are opened only in debug builds.

## Fail closed

Every unlock failure — wrong password, truncated file, unknown cipher — collapses
into one indistinguishable error. Distinguishing them would tell an attacker
holding the file whether a guess was structurally close. The caught value is
never inspected, propagated or logged.

## File safety

Writes are atomic: a temp file in the same directory, `fsync`, then rename over
the original. The original is never truncated, so an interrupted write leaves
the previous vault intact. One rolling backup is kept per session, taken before
the first write.

The local vault is never deleted because the remote is missing.

## Known transitive advisory

`kdbxweb@2.1.1` depends on `@xmldom/xmldom@^0.7.4`, which npm flags as having
known issues. It is used to parse the XML **inside an already-decrypted vault**,
so reaching it requires an attacker who can both supply a malicious `.kdbx` and
get you to open it with its master password. Overriding to `@xmldom/xmldom` 0.8+
changes parse-error behaviour that `kdbxweb` depends on, so it is not a drop-in
bump. Recorded here rather than silently overridden; revisit if `kdbxweb`
publishes a release that moves.

## Out of scope, on purpose

No browser extension, autofill or DOM injection. No Android Autofill Framework.
No key files or hardware keys. No breach checking. Each of these would widen the
attack surface or add a network dependency for a benefit this app does not need.
