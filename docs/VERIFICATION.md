# Verification

What has been verified, how, and — just as importantly — what has not.

## Automated

```bash
npm run typecheck
npm run lint
npm run test
npm run build

cd src-tauri && cargo check
cargo check --target x86_64-pc-windows-gnu
```

### `npm run test`

Runs under Node, which provides `crypto.subtle` and `crypto.getRandomValues`
natively — everything `kdbxweb` needs. The vault and sync layers have no
platform dependencies, so this is the real code, not a re-implementation.

**Vault format interoperability** — a vault is built with `kdbxweb` in each
format KeePassXC writes, opened through the app's vault service, mutated, saved,
and re-opened with plain `kdbxweb` standing in for another client:

- KDBX4 / Argon2d (KeePassXC's default)
- KDBX4 / Argon2id
- KDBX3 / AES-KDF

**All six sync scenarios the PRD asks to be verified with two devices**, run as
two in-process instances against a Drive stand-in that reproduces the property
that makes this hard — no conditional write, so `update` always succeeds and
always bumps the revision:

| Scenario | Assertion |
|---|---|
| Edit on A only | B receives it |
| Different entries edited offline on both | both survive |
| Same entry edited offline on both | resolves by timestamp, nothing lost |
| Delete on A while editing on B | deletion wins, both devices agree |
| App killed mid-upload | remote untouched and openable, local complete, work not lost |
| Master password changed on A | B reports it specifically, keeps its own changes |

Plus: post-upload revision verification detects a concurrent writer and marks
the vault dirty instead of overwriting; a missing remote never deletes the local
vault; "Synced" is never shown while changes are pending.

**Generator and RNG** — length bounds, one character from every enabled class
over 200 samples, guaranteed characters not parked in fixed positions, uniform
distribution over 100,000 samples (a modulo implementation would show a visible
low-end skew), and a scan of `src/` for `Math.random` that backs up the ESLint
rule.

### `cargo check`

Both targets pass clean. The `x86_64-pc-windows-gnu` cross-check is a fast local
proxy for the Windows code paths; CI compiles the same code against MSVC, which
is the toolchain that actually ships.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request, and covers the
two platforms a Linux checkout cannot build. All three jobs must pass.

| Job | What it proves |
|---|---|
| **Checks** (Linux) | The commands above: typecheck, lint, the 43 tests, the frontend build, `cargo check --all-targets`, `cargo test --lib` |
| **Build (Windows)** | `cargo check` against **MSVC**, then a full `tauri build`. Uploads the NSIS installer and the MSI |
| **Build (Android)** | `tauri android init`, then `tauri android build --debug --apk` — compiles the Kotlin plugin and links the Rust for all four Android ABIs. Uploads the APK |

The Windows job is the only thing that compiles the Credential Manager and
Windows Hello paths, including the `IUserConsentVerifierInterop` call a Win32
process needs. The Android job is the only thing that compiles
`PassHandlerPlugin.kt` at all.

Neither job runs the app. They prove the code compiles, links and packages —
not that Hello prompts, that a fingerprint is accepted, or that Drive answers.

No secrets are configured. `.env` is absent in CI, so every run also confirms
the app builds and packages in its local-only, sync-not-configured state.

### Browser engine check

The vault path was additionally run in headless Chromium under the exact
production Content Security Policy, exercising create → save → unlock → merge →
fail-closed-on-wrong-password. This confirmed two things the Node tests cannot:

- `kdbxweb` needs no Node `crypto` shim in a browser; Vite externalises the
  import and the WebCrypto branch is taken.
- `hash-wasm`'s Argon2 instantiates under `script-src 'self' 'wasm-unsafe-eval'`
  with no other relaxation.

This was a one-off de-risking run, not a committed test — it would add Playwright
as a dependency for a single smoke check.

---

## Not verified here — needs your hardware

Everything below **compiles and packages** in CI. None of it has been *run*, and
no compiler can tell you whether it behaves correctly against a real sensor, a
real credential store, or Google's servers:

- **Android platform behaviour at runtime.** The Kotlin compiles, but nothing has
  yet exercised Keystore-backed `EncryptedSharedPreferences` against a real
  Keystore, shown a `BiometricPrompt`, confirmed `FLAG_SECURE` blanks the task
  switcher, or checked that the sensitive-clipboard flag keeps a password out of
  clipboard history. The OAuth redirect intent handler has never received an
  intent.
- **Windows Hello prompting**, and Credential Manager reads and writes. The
  `IUserConsentVerifierInterop` call compiles against MSVC; whether it puts a
  prompt on screen is a different question.
- **Any real Google Drive traffic.** The Drive client is exercised only against
  the fake.
- **Installing and launching the artifacts.** CI produces an NSIS installer, an
  MSI and a debug APK. Nobody has installed or opened any of them.

A debug APK is not a release APK: the release path needs your own keystore, and
the release key's SHA-1 needs its own Android OAuth client. See
[DISTRIBUTION.md](./DISTRIBUTION.md).

## Manual acceptance

Work through these on real devices. They are the acceptance criteria the
automated suite cannot reach.

### 1. KeePassXC interoperability — the headline criterion

Only real KeePassXC can prove this; it is not installable in CI.

1. In KeePassXC, create a vault with a couple of entries, including one with
   punctuation and one with a multi-line note. Save it as KDBX4.
2. Copy it over Pass Handler's vault at
   `%APPDATA%\com.passhandler.app\vault.kdbx` and unlock it in the app.
3. Confirm every entry, username, password and note reads back exactly.
4. Add and edit entries in Pass Handler, then open the same file in KeePassXC.
   Confirm the changes are there and KeePassXC reports no format problems.

### 2. Android toolchain

This used to be the main risk to the project. CI now runs `android init` and
builds an APK on every push, so the Gradle wiring, the Kotlin and the four Rust
ABI targets are known-good — what is left is your local SDK and NDK install, and
a real device.

```bash
npm run tauri android init
npm run tauri android dev      # emulator
npm run tauri android dev --open   # physical device
```

If your local build fails where CI succeeds, the difference is your toolchain,
not the code. Compare against the versions the Android job installs in
`.github/workflows/ci.yml`.

Then get the SHA-1 and register the OAuth clients — see
[google-oauth-setup.md](./google-oauth-setup.md).

### 3. Offline operation

Turn networking off entirely. Confirm the vault unlocks, entries read, edits
save, and the header says *Offline* rather than *Synced*. Turn networking back
on and confirm the queued changes push.

### 4. Two-device sync

With the app on Windows and Android against the same Drive account, walk the six
scenarios above by hand. The automated versions prove the logic; this proves the
transport.

### 5. Crash safety

- Kill the app mid-session (Task Manager / force-stop). The vault file must
  still open in KeePassXC.
- Kill it during a sync upload. Both the local file and the Drive copy must
  still open.

### 6. Platform behaviours

- **Android**: with the vault unlocked, open the task switcher — the preview
  must be blank. A screenshot attempt must be refused. Copy a password and
  check it does not appear in the clipboard preview or history.
- **Windows**: search takes focus on unlock; arrow keys move the selection;
  Enter copies the highlighted password; `Ctrl+L` locks; `Ctrl+F` focuses
  search. Closing the window locks the vault.
- **Both**: copy a password, watch the countdown, and confirm the clipboard is
  cleared at zero. Copy a password, then copy something else yourself, and
  confirm your text survives the timer.

### 7. No plaintext on disk

With the vault unlocked and entries open, search the app data directory and any
logs for a known entry password. It must not appear anywhere. The only file that
should contain it is `vault.kdbx`, encrypted.

```powershell
Select-String -Path "$env:APPDATA\com.passhandler.app\*" -Pattern "your-test-password" -ErrorAction SilentlyContinue
```
