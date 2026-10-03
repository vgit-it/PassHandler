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

**First-run tips** (`tests/tips.test.ts`) — no sequence over 3 tips and no
tip over 12 words, for every platform/Drive combination; the back-to-back
rule; `fill` waiting for a seen `home` and at least one entry; a seen
sequence never returning. See [ONBOARDING-TIPS-DESIGN.md](./ONBOARDING-TIPS-DESIGN.md).

### `cargo check`

Both targets pass clean. The `x86_64-pc-windows-gnu` cross-check is a fast local
proxy for the Windows code paths; CI compiles the same code against MSVC, which
is the toolchain that actually ships.

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request, and covers the
two platforms a Linux checkout cannot build. All three jobs must pass.

| Job | What it proves |
|---|---|
| **Checks** (Linux) | The commands above: typecheck, lint, the 180 tests, the frontend build, `cargo check --all-targets`, `cargo test --lib` |
| **Build (Windows)** | `cargo check` against **MSVC**, then a full `tauri build`. Uploads the NSIS installer and the MSI |
| **Build (Android)** | `tauri android init`, `android:sync-ime`, then `tauri android build --debug --apk --split-per-abi --target aarch64 armv7 i686 x86_64` — compiles the Kotlin plugin, the IME, and links the Rust for all four Android ABIs, but uploads only the `arm64-v8a` debug APK |

The Windows job is the only thing that compiles the Credential Manager and
Windows Hello paths, including the `IUserConsentVerifierInterop` call a Win32
process needs. The Android job is the only thing that compiles
`VaultPlugin.kt` at all.

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
2. Copy it over Vault's vault at
   `%APPDATA%\com.passhandler.app\vault.kdbx` and unlock it in the app.
3. Confirm every entry, username, password and note reads back exactly.
4. Add and edit entries in Vault, then open the same file in KeePassXC.
   Confirm the changes are there and KeePassXC reports no format problems.

### 2. Android toolchain

This used to be the main risk to the project. CI now runs `android init`,
syncs in the hand-authored IME source (`npm run android:sync-ime` — see
CLAUDE.md's Commands section and `scripts/sync-android-ime.js`; before this
existed, CI's build silently excluded the entire IME, so "the Kotlin is
known-good" was not actually true of that code), and builds an APK on every
push, so the Gradle wiring and the four Rust ABI targets are known-good —
what is left is your local SDK and NDK install, and a real device.

```bash
npm run tauri android init
npm run android:sync-ime
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
- **Android IME**: with site icons on, unlock, switch to another app and open
  the manual-fill keyboard — Login rows show the same favicons as the app's
  entry list, other types their type glyph. Add a Login from the IME's
  create flow and confirm its favicon also appears (this is the on-demand
  path, requested while the app is backgrounded — see
  [MANUAL-FILL-DESIGN.md](./MANUAL-FILL-DESIGN.md)'s "Result-row icons").
  The top bar's Lock/Clear are rounded rectangles (not pills), visibly
  shorter than the bar (about 6dp of bar above and below) and still easy
  to hit. The keypad's "+" has a faint coral tint — noticeable, but
  quieter than any coral button in the create panel.
- **Android IME, safety** (`IME-UX-IMPROVEMENT-PLAN.md` Phase 1):
  - With the keyboard up, take a screenshot and start a screen recording —
    the keyboard area must be black in both.
  - Open an entry's detail in app A, then open the keyboard in app B: it
    must show an empty search. Back in app A, the entry is still open.
  - Start a new entry from the keyboard with the *username* field focused
    and tap Generate: the username must stay untouched, the panel says the
    password was saved to the entry, and the password row's Fill types it
    once you focus the password field. With the password field focused,
    Generate types it directly.
  - After generating, tap ✕: a "Discard this entry?" bar appears; Keep
    editing returns to the panel. An untouched new entry cancels at once.
  - Save a new entry (✓), reopen the keyboard: it shows search, not an
    empty new-entry panel.
  - Open a Secure Note or Wi-Fi entry: the header reads "Secure Note" /
    "WiFi", not "SecureNote" / "Wifi".
- **Android IME, fill flow** (`IME-UX-IMPROVEMENT-PLAN.md` Phase 2):
  - The keyboard is the same height on search, an entry's detail, a new
    entry, the locked view and while loading — the page behind it doesn't
    jump when moving between them. Check the gap under the keypad with both
    gesture and 3-button navigation: it should just clear the system bar.
  - The search screen shows a section label and three rows; each Login row
    shows its username under the title and a Fill chip.
  - In a native app never filled from before (e.g. Netflix, with a
    "Netflix" entry), the empty search shows "Suggested for Netflix". In
    Chrome, the list is labelled "Recent in Chrome"; with nothing to show,
    "Type to search your vault".
  - On a sign-in form with the username focused, tap a Login row's Fill:
    the username fills, focus moves to the password, and the password fills.
    Open the entry's detail and repeat from its Username Fill: the Password
    chip flashes "Filled!" when the password lands. No Tab after the
    password.
  - Type a query with no matches: "Save new login for '…'" starts a new
    entry titled after it.
  - The ✕ in the search box clears the query; holding backspace deletes
    repeatedly.
  - Detail view: URL and Notes sit under "More fields (2)"; "Back to
    results" keeps the query.
  - Tap Clear on a filled field: it empties, the pill reads "Undo" for ~5s,
    and Undo restores the text. Tapping into another field ends the undo.
  - Save a new entry: "Saved to Vault — review it in the app." shows for
    about a second before the keyboard steps away.
  - Lock the vault from the keyboard: the locked view explains itself and
    "Use other keyboard" switches away.
- **Android IME, bottom clearance** (`MANUAL-FILL-DESIGN.md`, "One height
  for every screen"): with gesture navigation and with 3-button
  navigation, the system's buttons under the keyboard (hide keyboard,
  switch keyboard, or back/home/recents) sit in clear space below the
  keypad's bottom row and the new-entry card, never over them.
- **Android IME, structural** (`IME-UX-IMPROVEMENT-PLAN.md` Phase 3):
  - The top bar reads "Filling into <app>" in a native app and "Filling
    into Chrome" in Chrome; the wordmark shows when there's no name.
  - Keys are visibly a little shorter; the search box's ✕ still fits.
  - "123" shows digits, then `@ . - _ / & '`: search for an email address.
  - The globe key switches to your other keyboard; holding it opens the
    system picker. If the navigation bar already shows a keyboard-switch
    button, the globe key may be absent — expected.
  - Start a new entry, tap "Switch keyboard", type an email into the page's
    email field, switch back to Vault: "Use “…” for:" offers Email first;
    tapping it fills the entry's Email row. From a password field the text
    shows as "••••" and only Password is offered.
- **Android app, entry creation colors** (`ENTRY-CREATION-PALETTE-DESIGN.md`):
  - The Home "+" is soft coral, matching the keyboard's Save button.
  - Type Picker and editor: warm grey wall and fields, off-white text, a
    coral Save, and coral focus rings, toggles and links. Nothing is navy
    or blue.
  - A validation error is readable. Editing an existing entry looks the
    same.
  - Everything else (Home, entry detail, Settings, Unlock) is unchanged.
- **Settings colors, both platforms** (`SETTINGS-VISUAL-PASS.md`):
  - The dropdowns, buttons and password fields match the grey cards on
    Android and the dark shelves on Windows. Nothing is navy, and
    "Change password" is steel blue.
  - "Show site icons", when off, shows a visible grey track, not just a dot.
    Tapping just above or below a toggle flips it.
  - Section titles and the grey hints under each setting are easy to read.
  - Android: the header matches Entry Detail's (larger back arrow and
    title), and the list ends without a large empty gap below Recovery.
  - Recovery's buttons read "Export", "Undo session" and "Replace…". With
    Drive disconnected, "Replace…" shows "Connect Google Drive first."
    under its two choices.
  - An off toggle in the entry editor is slightly brighter than before,
    and nothing else changed there.
- **Android IME, field screens** (`IME-DETAIL-CREATE-VISUAL-PASS.md`):
  - Entry detail: the fields sit in one rounded card; a Login's username,
    email and password fit without scrolling; every Fill lines up in one
    column; the eye shows a password with "· hides in Ns" on its label.
    A card's number row has a "Whole · 4 parts" switch under its Fill; in
    4 parts, Fill reads "Fill 1/4" and advances with each tap, and a
    site with four separate boxes gets one group each. An expiry row's
    "MM/YY · YY/MM" switch changes the order Fill types. Neither switch
    looks like Fill.
  - New entry: the panel reads as warm grey, not brown, and its coral is
    soft — close in tone to the top bar above it (`IME-CREATE-PALETTE-MUTE-PLAN.md`).
    "Weak" under a password is readable.
  - New entry: ✕ on the left, Save on the right; a Login's five fields fit
    without scrolling; empty fields read "Not set"; only Save and Generate
    are filled coral. Tap the type under the title: the type list replaces
    the fields; picking Wi-Fi switches the fields. Generate: the password
    shows in plain text in its row straight away; the eye hides it until
    the next regeneration. The character-class toggles are outlines
    (accent outline and a check when on), never filled. Email's Pick list starts with "Use what's
    in the field".
- **Windows**: search takes focus on unlock; arrow keys move the selection;
  Enter copies the highlighted password; `Ctrl+L` locks; `Ctrl+F` focuses
  search. Closing the window locks the vault.
- **Both**: copy a password, watch the countdown, and confirm the clipboard is
  cleared at zero. Copy a password, then copy something else yourself, and
  confirm your text survives the timer.
- **Both, first-run tips**: Settings → About → Reset, then lock and unlock.
  The Home tips appear after the unlock animation (top of the vault on
  Android, bottom on Windows), never over the search band or "+". Skip ends
  the sequence; locking mid-sequence brings it back from tip 1. Settings
  shows its own tips; after finishing Home's, the fill tips wait for the
  next unlock. About's text expands and collapses, and shows the version.
- **Android, Vault keyboard row** (Settings → Security; its Kotlin half has
  never been compiled here): with Vault's keyboard off, the row says so
  and **Turn on** opens the system keyboard list. Turn it on, come back:
  the row reads "On" without leaving Settings, and the vault is still
  unlocked. Not shown on Windows.

### 7. No plaintext on disk

With the vault unlocked and entries open, search the app data directory and any
logs for a known entry password. It must not appear anywhere. The only file that
should contain it is `vault.kdbx`, encrypted.

```powershell
Select-String -Path "$env:APPDATA\com.passhandler.app\*" -Pattern "your-test-password" -ErrorAction SilentlyContinue
```
