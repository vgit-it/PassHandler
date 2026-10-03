# First-run tips & the About section — design

**Status: built.** `npm run typecheck`, `npm run lint`, `npm run test`
(`tests/tips.test.ts`) and `npm run build` pass, and the Rust side
type-checks. Not yet looked at on a real device, and the Kotlin half of
the Vault keyboard row has never been compiled here — see
`VERIFICATION.md` §6.

## The ask

1. Guide a first-time user through the app with **tips shown at the
   beginning**, inside the normal app screens — not a separate tutorial.
2. Tips are **very short, simple sentences.** The audience is a handful of
   people the owner knows, not the general public.
3. A sequence of tips is **never more than 3** at a time.
4. Settings gets an **About** section: what the app is for and how it's
   meant to be used.
5. Android: a **Turn on** button for Vault's keyboard, in Settings.

## What already exists (and stays)

- `Onboarding.tsx` — create a vault, or connect to one on Drive. It already
  explains the master password (no recovery, acknowledgement checkbox) and
  the Drive privacy model. **Unchanged.** Tips start *after* it, on the
  first unlocked screen.
- `justOnboarded` (`store.tsx`) → `EntryList.tsx`'s `EmptyState` shows a
  one-time "Vault created." and the biometric offer. **Unchanged.** Tips
  wait while the biometric offer is on screen, so the two never stack. The
  plain "Vault created." line alone doesn't hold them back: without a
  biometric offer there's nothing to close, and that line only goes away
  once an entry exists — too late for "Tap + to add a password."

## Rules for every tip

- **One sentence. Aim for ≤ 8 words, hard cap 12.** Plain words. No
  "KDBX", "OAuth", "IME", "sync engine".
- **Max 3 tips per sequence.** Shown one at a time, with "1 of 3" dots.
- **Never two sequences back to back.** When a sequence ends (or is
  skipped), the next one can only appear on a *different screen* or in a
  *later unlock session*.
- **Each sequence is shown once per device**, then never again (unless the
  user taps "Show tips again" in About).
- **Never during motion.** On Home/Upcoming a sequence appears only once
  `UNLOCK_SEQUENCE_MS` has passed since the vault screen mounted, and never
  while the unlock reveal is running or Windows pick mode is open.
- **Never modal, never blocking.** The app stays fully usable under a tip.
- **Locking mid-sequence** doesn't mark it seen — it restarts from tip 1 on
  that screen next time. Only *Done* or *Skip* marks it seen.
- **Tips never contain vault data** (no entry names, no counts).

## The tip sequences

Four sequences, each tied to one screen. Text varies by platform where the
interaction differs. `{hotkey}` is the live combo from
`settings.manualFillHotkey`, formatted by `describeHotkey` exactly as
Settings' hotkey row shows it.

### 1. `home` — first time on the home screen

When: first home visit while the biometric offer isn't on screen. Applies
to both the created-vault and adopted-vault (second device) routes.

| # | Android | Windows |
|---|---------|---------|
| 1 | Tap + to add a password. | Click + to add a password. |
| 2 | Tap the copy button to copy a password. | Type to search. Enter copies the password. |
| 3 | The vault locks itself when you're away. | The vault locks itself when you're away. |

### 2. `fill` — filling other apps

When: `home` already seen and the vault has ≥ 1 entry (filling is
pointless before that). Being on the same screen as `home`, the
back-to-back rule already holds it to a later unlock session than the one
`home` finished in.

| # | Android | Windows |
|---|---------|---------|
| 1 | Vault has its own keyboard for filling apps. | Press {hotkey} in any app to fill. |
| 2 | Turn it on in Settings. | Pick an entry, then a field. |
| 3 | Switch to it with the globe key. | Change the keys in Settings. |

Android tip 2 points at Settings' **Vault keyboard** row (below) rather
than carrying a button of its own — the card stays one sentence plus
Next/Skip everywhere.

### 3. `settings` — first time in Settings

| # | Text |
|---|------|
| 1 | Set how fast the vault locks here. |
| 2 | *Drive configured, not connected:* Connect Google Drive to sync your devices. <br> *Connected:* Drive only stores the locked file. <br> *Not configured in this build:* dropped (the sequence is 2 long). |
| 3 | Export a backup copy now and then. |

### 4. `upcoming` — first time on the Upcoming tab

| # | Text |
|---|------|
| 1 | Dates you choose to track show up here. |
| 2 | Turn on tracking on a date field when editing. |

## The tip card

One component, `TipCard`, used by all four sequences.

- **Where:** a flex sibling that takes its own space — never an overlay, so
  it can't cover rows, the search band or **+**.
  - Home/Upcoming, **Android**: the top of `VaultFrame`'s interior. The
    search band and tab bar under the list are drawn as one continuous
    control panel (`BottomTabBar.tsx`), so the card must not sit between
    them; the list is bottom-anchored there anyway, so the top is its
    least-used space.
  - Home/Upcoming, **Windows**: the bottom of the frame interior, near the
    floating **+** the first tip names.
  - Settings: pinned under the scroll area, both platforms.
  - Home's card stays mounted under an open detail box, for the same reason
    the tab bar does — removing it would change the content height
    mid-animation.
- **Not a pointer/coach-mark.** No arrows anchored to controls — the frame,
  doors and detail-box transforms move those around, and an anchored
  tooltip would be fragile against all of them. The sentence names the
  control instead ("Tap +").
- **Anatomy:** the sentence; a row with progress dots (hidden for a
  1-tip sequence), a **Skip** text button (hidden on the last tip, where it
  would do the same as Done), and **Next** / **Done**. Both buttons have a
  44px tap area (spec §7).
- **Look:** lavender, so a tip stands apart from every other card. It's
  the one colour in the app that only ever means "tip": the vault accent
  is reserved (spec §3.7 — never on text, borders or status), amber means
  warning, green success, and coral entry creation. A lavender tint fill
  and 1px border, lavender-white text, a small lightbulb before the
  sentence, and Next on a stronger lavender tint. Same on both platforms
  and both screens. All values are the `--tip-*` tokens in `index.css`
  (Tailwind `tip-*`), so the shade changes in one place.
- **Motion:** fade + 8px rise in (`.tip-card-in`, `index.css`), 150ms fade
  out on Done/Skip; each new tip's sentence fades in (`.tip-text-in`).
  Reduced motion → no animation (CSS media query; the fade-out is skipped
  via `usePrefersReducedMotion`).
- **A11y:** `role="region"` `aria-label="Tip"`, and a stable
  `aria-live="polite"` wrapper around the sentence so screen readers
  announce each new tip.
- **Android back button:** unchanged — it never dismisses a tip, so back
  can't accidentally burn a sequence.

## State & persistence

- Device-local setting `tipsSeen: string[]` on `Settings` (`ports.ts`,
  default `[]`), and `#[serde(default)] pub tips_seen: Vec<String>` in
  `prefs.rs`. **The `#[serde(default)]` is load-bearing:** `prefs.rs`
  falls back to `Settings::default()` for the *whole file* on a parse
  failure, so without it every existing `settings.json` would also reset
  `onboardingComplete` and send a set-up install back to first run.
- Not in the vault and not synced — tips are platform-specific (an Android
  user's second device on Windows should still see the Windows `fill`
  tips).
- Ids carry a version (`home.v1`, `fill.v1`, …). Rewriting a sequence's
  meaning bumps its id so it shows once more; a wording tweak doesn't.
- Existing installs (no `tipsSeen` yet) see the tips once, like a new
  user. No migration logic — Skip is one tap.
- `store.tsx` has `markTipsSeen(id, screen)` and `resetTips()`, plus
  `tipsFinishedThisSession` — in-memory state, cleared on lock — recording
  which screens already had a sequence end this session. That is what
  enforces the back-to-back rule.

### Code layout

- `src/ui/tips/tipSets.ts` — the registry: ids, per-platform text, and a
  **pure** `nextTipSequence(screen, context)`. Unit-tested under vitest
  (`tests/tips.test.ts`): the max-3 cap and the ≤ 12-word guard over every
  tip for every platform/Drive combination, the back-to-back rule, `fill`
  waiting for a seen `home` and ≥ 1 entry, the Drive-dependent `settings`
  tip, and seen sequences never returning.
- `src/ui/hooks/useTipSequence.ts` — wraps the above for one screen. Picks
  the sequence the first time the screen is ready, then freezes it until
  Done/Skip, so a mid-sequence change (an entry added, Drive connected)
  never rewrites the tip being read.
- `src/ui/components/TipCard.tsx` — the card.
- `src/ui/hotkeyLabel.ts` — `describeHotkey`, shared by Settings' hotkey
  row, the tips and About.

## About (Settings)

The last section in Settings, **About**, after Recovery. Same
`Section`/`Row` structure as the rest of the screen.

Rows:

1. **Vault** — hint: "Version x.y.z" (from `package.json`, injected as
   `__APP_VERSION__` by `vite.config.ts`'s `define`, so no runtime call).
   Button **About** expands the text below in place (the same
   expand-in-place pattern as `RestoreBackupRow`); **Close** collapses it.
2. **Show tips again** — hint: "See the first-run tips once more." Button
   **Reset** → `resetTips()`; afterwards the hint reads "Tips reset."
   Settings' own tips start again straight away; other screens show theirs
   on the next visit.

Expanded About text — same rule as tips: short, plain sentences.

> **What it's for**
> Vault keeps your passwords and private details.
> It's all locked with one master password.
> Nobody can reset that password. Not us, not Google.
> It works without internet.
> It uses KeePass files, so other KeePass apps can open it.
>
> **How to use it**
> Add an entry for each account, card or ID.
> Copy or fill it when you need it.
> *Android:* Use the Vault keyboard to fill other apps.
> *Windows:* Press {hotkey} in any app to fill.
> Let it lock itself.
> *Android:* Turn on biometric unlock to open it faster.
> *Windows:* Turn on Windows Hello to open it faster.
> Turn on Google Drive to use it on more than one device.
> Export a backup copy now and then.
>
> **What it isn't**
> Each person has their own vault. Nothing is shared.
> No accounts, no servers, no tracking.

The biometric line is left out when the device has no biometric unlock,
and the Drive line in a build where Drive isn't configured.

## Vault keyboard row (Settings, Android)

Android's counterpart of Windows' **Manual fill hotkey** row, in the same
place (Security). Android gives an app no way to turn a keyboard on
itself, so the button opens the system keyboard list and the person flips
it on there.

- **Off:** hint "Fill other apps from Vault's own keyboard.", primary
  button **Turn on**.
- **On:** hint "On. Switch to it with the globe key.", secondary button
  **Manage** (same system screen).
- The status is re-read every time the app comes back to the foreground,
  so the row flips to "On" as soon as the person returns. Leaving for the
  system screen doesn't lock the vault — only the idle timer does.
- The row is hidden if the status can't be read at all.

Plumbing (`tauri-plugin-vault`, tracked — not `gen/`):

- `VaultPlugin.kt`: `keyboardStatus` — enabled if any entry in
  `InputMethodManager.enabledInputMethodList` is from the app's own
  package (matched by package, not class name, so it can't drift from
  `VaultIme`'s actual class); `openKeyboardSettings` —
  `Settings.ACTION_INPUT_METHOD_SETTINGS`.
- `mobile.rs` / `desktop.rs` / `commands.rs`: `keyboard_status`,
  `open_keyboard_settings`. Windows reports `available: false` and the
  open call fails as unavailable.
- `ports.ts`: `platform.keyboardStatus()` / `openKeyboardSettings()`.

## Out of scope

- Tips inside the Android IME itself (native Kotlin view; separate design
  if wanted).
- Rewriting `Onboarding.tsx`'s existing copy.
- Tips on Entry Detail / the editor — the `home` sequence plus the
  editor's own type picker cover first use; revisit only if testers get
  stuck there.
