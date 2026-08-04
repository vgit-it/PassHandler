# Pass Handler

A personal password manager for **Windows and Android**, using the KeePass
`.kdbx` format and syncing the encrypted vault through Google Drive.

Built for one person, and later for two or three others who each run a fully
independent vault. No shared accounts, no user management, no server of ours.

---

## What it is

- **KeePass-compatible.** The vault is a `.kdbx` file that opens in KeePassXC,
  and a vault created in KeePassXC opens here. All cryptography and file-format
  handling is [`kdbxweb`](https://github.com/keeweb/kdbxweb) — none of it is
  ours.
- **Encrypted-blob sync.** Google Drive stores the `.kdbx` and nothing else, in
  a hidden folder only this app can see. Google never receives a key, a
  password, or any plaintext.
- **Offline first.** Reading and editing never require a network. Sync is an
  enhancement, not a prerequisite.
- **Nothing else on the network.** No telemetry, no analytics, no remote fonts
  or assets, no update check. The webview's Content Security Policy has no
  remote origins in it at all.

Optimised ruthlessly for the thing it actually does dozens of times a day:
**search → copy → paste**.

## What it is not

No browser extension or autofill. No Android Autofill Framework. No macOS or
iOS. No attachments, TOTP codes, folders, tags, custom fields, key files, or
hardware keys. No import from other managers. No breach checking. No sync
provider other than Google Drive.

---

## Getting started

```bash
npm install
npm run tauri dev              # Windows
npm run tauri android dev      # Android
```

Sync is optional. With no OAuth client IDs configured the app runs local-only
and says so — see [docs/google-oauth-setup.md](docs/google-oauth-setup.md) to
enable it.

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Documentation

| | |
|---|---|
| [google-oauth-setup.md](docs/google-oauth-setup.md) | Google Cloud project, the two OAuth clients, the Android intent-filter |
| [VERIFICATION.md](docs/VERIFICATION.md) | What is tested automatically, and the manual acceptance checks |
| [SECURITY.md](docs/SECURITY.md) | Design decisions, including the ones weaker than they look |
| [DISTRIBUTION.md](docs/DISTRIBUTION.md) | Building, signing, and handing the app to someone |

---

## Architecture

```
React UI          src/ui, src/app
      ↓
Vault service     src/vault      pure TS over kdbxweb — unlock, CRUD, merge
Sync engine       src/sync       pure TS state machine
      ↓
Platform ports    src/platform   interfaces, plus the one Tauri implementation
      ↓
Rust / Kotlin     src-tauri      file I/O, OAuth, Drive, secure storage, biometrics
```

`src/vault`, `src/crypto` and `src/sync` import nothing platform-specific. An
ESLint rule enforces it rather than leaving it to good intentions. That is what
lets the same vault and sync code run in the Windows webview, the Android
webview, and under Node in the test suite — which in turn is how the two-device
sync scenarios get tested without two devices.

### Why Tauri rather than React Native

`kdbxweb` needs WebCrypto. Tauri renders in the system webview on both
platforms, so WebCrypto is natively available and the vault logic is genuinely
shared. React Native has no native WebCrypto and would need polyfilled crypto —
not acceptable in a password manager.

### Sync, briefly

Google Drive has **no conditional write**: you cannot say "replace this file only
if its revision is still X" and have the server reject a stale write atomically.
So rather than pretending otherwise, losing the race is made harmless:

1. Read `headRevisionId` before uploading.
2. If it moved, pull and merge first.
3. Upload.
4. Read the revision again and confirm the file is the one we just created.

If step 4 disagrees, another device wrote concurrently — nothing is overwritten,
the vault is marked dirty, and the next cycle merges. KeePass carries per-entry
UUIDs and modification timestamps, so a conflict resolved one cycle late still
loses nothing.

A conflict is never resolved by silently picking a winner, and the local vault
is never deleted because the remote is missing.

---

## Status

Every milestone in the specification is implemented. The TypeScript layers and
the Rust for both Linux and Windows targets are verified here; the Android
Kotlin, Windows Hello prompting, and real Drive traffic have not been compiled
or run in the build environment and need your hardware.
[VERIFICATION.md](docs/VERIFICATION.md) is precise about which is which.
