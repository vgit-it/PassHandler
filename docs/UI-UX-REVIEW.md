# Android UI/UX review — app + IME

Requested via `/ui-ux-pro-max`. Scope: the Android React/TS app screens, and the native Kotlin IME (`VaultKeyboardView.kt`/`VaultIme.kt`). Windows-only surfaces are out of scope except where a shared component (e.g. `PickEntryDetail`) is also used on Android.

**A note on method.** This sandbox has the `ui-ux-pro-max` skill's `SKILL.md` but not its `scripts/search.py` or `references/` database — only the SKILL.md itself synced here, not its data files. Per the skill's own fallback rule ("never present a 0-result search as data"), findings below are grounded instead in: the skill's own Priority 1–10 table (reproduced in SKILL.md), WCAG 2.1 AA thresholds (computed, not guessed), Android/Material's 48dp / iOS's 44pt touch-target convention, and — most usefully — this project's *own* written commitments in `docs/vault-visual-language-spec.md` and `docs/ime-ux-redesign-proposal.md`, checked against what's actually shipped. Say the word and I'll re-run this once the real skill database is available in this sandbox.

No code was changed. This is findings only.

## Top 5, ranked

1. **FIXED.** ~~The app's own documented 44px touch-target floor is missed almost everywhere except the screens that were sized deliberately.~~ `docs/vault-visual-language-spec.md` §7 states it flatly: "Every interactive element has a ≥44px touch target." `.btn`/`.field` (`index.css`) computed to ~38–40px. **`py-2` → `py-3` on both shared classes** now puts every control built on them at ~46px (22px line-height + 24px padding), clearing the floor. Unlock's buttons, the entry shelf row, and `BottomTabBar`'s "+" already met it and are untouched.
2. **FIXED.** ~~The IME's top bar misses its own touch-target floor.~~ The IME's floor is **40dp** — an IME-only exception to the app's 44px rule, by direct request; see `docs/ime-ux-redesign-proposal.md`'s "Touch targets". The top bar's Lock/Clear-field used to be 32dp clickable (a 40dp bar minus 4dp top/bottom margins). Now `TOP_BAR_HEIGHT_DP` is 44 and `buildTopBarLockButton`/`buildTopBarClearFieldButton` (`VaultKeyboardView.kt`) have 40dp tap areas (`MIN_TOUCH_TARGET_DP`), each drawn as a 32dp rounded rectangle with 6dp of bar showing above and below. Clear-field has an explicit 40dp `minWidth`, since a `WRAP_CONTENT` text label has no fixed box.
3. **FIXED.** ~~`smallActionButton` (every Fill/Show/Hide/Split chip in the IME's detail view) is 28dp tall~~ (`VaultKeyboardView.kt`, `dip(28)` → `dip(44)` layout height) — the single most-used interactive control in the whole keyboard, and the smallest, now meets the floor. `minWidth`/`minHeight` stay zeroed deliberately (unrelated to the floor — see the function's own updated doc comment).
4. **Form errors in `EntryEditor.tsx` render once, at the very bottom of a long form, disconnected from the invalid field.** A missing-Title error shows below Notes while Title is the first field on the page — the skill's Priority-8 anti-pattern by name. *Not yet fixed — flagged, not implemented.*
5. **`PasswordField.tsx`'s 1.5s scramble animation ignores `prefers-reduced-motion`**, in a codebase that implements the hook correctly elsewhere (`VaultDoors.tsx`) — makes this a real, fixable gap rather than a missing feature. *Not yet fixed — flagged, not implemented.*

---

## App (React/TS)

### 1–2. Accessibility & touch targets — CRITICAL

The systemic issue: `.btn`/`.field` (`index.css` L210–214) use `py-2` (8px) with 16px `text-sm`, landing at ~38–40px computed height. That's under the 44px floor `vault-visual-language-spec.md` §7 itself commits to, app-wide. Concretely under-target: Settings' row actions and toggles-adjacent buttons (`Settings.tsx`), the reveal/copy/fill trio in `FieldRow.tsx` (`.field-row-action`, sized off `.btn-ghost`), `EntryEditor.tsx`'s Cancel/Save footer, `TypePicker.tsx`'s list rows, `PickEntryDetail.tsx`'s Show/Fill buttons. Deliberately correct instead: `Unlock.tsx`'s two `h-12` (48px) action buttons, `EntryList.tsx`'s full-row shelf (~53px), `BottomTabBar.tsx`'s 44×44 "+". The contrast between the two groups shows the app knows the number — it just isn't applied uniformly.

`Unlock.tsx`'s password-reveal toggle is a specific, smaller instance: `h-5 w-5` (20×20px), the smallest tap target found anywhere in the app.

Positives: real `<label htmlFor>`/`id` pairs throughout `EntryEditor.tsx` and most forms (only `Unlock.tsx`'s necessarily-minimal `sr-only` label departs, justified by single-field simplicity). `aria-hidden`/`pointer-events-none` used correctly and consistently on every decorative element (`VaultDoors`, `VaultFrame`'s bolts, `EntrySiteIcon`'s fallback). `Toggle.tsx` has full `role="switch"`/`aria-checked`/`aria-label`. `EmailSuggestInput.tsx` implements a real combobox pattern (`role="combobox"`, `aria-expanded`, `aria-controls`, arrow-key navigation, `mousedown`-vs-`blur` race handled correctly).

### 6. Typography & color — MEDIUM, one verified gap

Computed WCAG contrast (not estimated):

| Pair | Ratio | AA normal text (4.5:1) |
|---|---|---|
| `slate-500` on `ink-900`/`ink-800` (muted labels/timestamps) | 3.44–3.75:1 | **Fails** at body size |
| `slate-400` on `ink-900` (`.label` class) | 6.97:1 | Passes |
| `accent`/`warn`/`bad` on `ink-900` | 4.68–8.32:1 | Passes |
| `--vault-muted`/`--vault-fg` on `--vault-shelf` | 5.02 / 12.30:1 | Passes |
| `--vault-dim` on `--vault-wall` (counts only, by design) | 3.44:1 | Large-text only — matches the spec's own §7 note that this token is never used for body text a user must read |

`slate-500` is the one real finding: wherever it's used at the app's `text-xs`/`text-sm` (14–16px) sizes rather than for genuinely decorative large text, it sits under AA. Worth an audit of its actual call sites (this pass didn't exhaustively enumerate every one) before deciding whether to bump it to `slate-400` globally.

The app's own `tailwind.config.js` bumps every `fontSize` step +2px over Tailwind's defaults (`xs` 14/18, `sm` 16/22, `base` 18/26) — already a deliberate, positive accessibility choice worth keeping in mind before "fixing" anything that looks small by generic Tailwind defaults; it isn't, by this app's own scale.

### 7. Animation — MEDIUM

`usePrefersReducedMotion()` exists and is correctly wired in `VaultDoors.tsx` (drops the door-slide to a 120ms opacity fade, per `vault-visual-language-spec.md` §7's own explicit instruction). `PasswordField.tsx`'s scramble animation has no equivalent check — same codebase, same hook available, not applied. `ShelfOriginPanel.tsx` drops to a 150ms cross-fade under reduced motion, per the spec's §7.

### 8. Forms & feedback — MEDIUM

`EntryEditor.tsx`'s validation surfaces as one `role="alert"` block at the bottom of a long scrolling form (top finding #4 above) — the field itself gets no inline indicator. Elsewhere the pattern is stronger: inline expand-in-place confirmation (never a native modal) for delete/restore/change-password flows, `ClipboardBar`'s visible countdown instead of a silent timeout, `UnverifiedAppNotice` pre-explaining Google's OAuth warning screen before the user hits it.

### 9. Navigation — HIGH, no findings

`App.tsx`'s `Screen` phase switch fails closed to the locked screen on any unrecognized state. Android hardware back is handled explicitly in `VaultScreen.tsx`'s view-state machine. A top-level `ErrorBoundary` wraps `<App/>` (`main.tsx`). No issues found here.

### Consistency — the vault/ink split

Per `CLAUDE.md` and `vault-visual-overhaul-plan.md`, this is deliberate and tracked, not a bug: `EntryList`/`BottomTabBar`/`VaultScreen`/`VaultDoors`/`VaultFrame` are on the newer `--vault-*` "physical vault" system; `EntryDetail`, `Settings`, `EntryEditor`, `TypePicker`, `Onboarding` are still on the older `ink-*` card system. Flagging only because it's the single largest visible inconsistency in the app if you don't already know it's a tracked partial migration — Phase 9 (Settings' 3D turn) is permanently skipped, so `Settings` stays on `ink-*` for good, not "for now."

---

## IME (Kotlin)

### 2–3. Touch targets — CRITICAL, the IME's biggest gap

Same finding as the app, sharper: the IME's *own* design doc states a touch-target floor explicitly (`ime-ux-redesign-proposal.md`'s "Touch targets" — 40dp, the IME's own exception to the app's 44px) and the shipped top bar (`buildTopBarLockButton`, `buildTopBarClearFieldButton`) still lands at 32dp — a 40dp bar minus 4dp top/bottom margins, with `minimumWidth`/`minimumHeight` explicitly zeroed rather than left at Android's own default touch-target padding. `smallActionButton` (`L1730`) — every Fill/Show/Hide/Split-N/4/Generate/Grab/Pick-from-Vault chip in both the detail view and the coral create panel — is `dip(28)` tall, same zeroed minimums. This is the control the person taps most often in the entire keyboard.

Keys on the actual letter/number keypad are sized correctly by comparison — the doc comments show a deliberate history of bumping key height from 42dp down to 34dp and back up to 38dp "per the layout-v2 roomier pass," landing close to the floor. The keypad itself isn't the problem; the chrome around it is.

### 6. Color/contrast

Current IME palette (recomputed after the visual-parity pass moved the IME
to the Android app's colors — see `docs/IME-UX-REVIEW.md` A1):

| Pair | Ratio |
|---|---|
| `MUTED_FOREGROUND` (60% alpha) on `BACKGROUND` / `CARD` | 4.91 / 5.25:1 |
| `SECONDARY_FOREGROUND` on the key/button gradient's top stop | 7.50:1 |
| `CREATE_LABEL` on `CREATE_BG` / `CREATE_CARD` (field labels) | 6.27 / 5.42:1 |
| `CREATE_ACCENT_TEXT` on the Save/Generate gradient's darker stop | 5.25:1 |
| "Add Entry" key text on its gradient's bottom stop | 4.14:1 — **fails AA**; fixed by `IME-UX-IMPROVEMENT-PLAN.md` Phase 2 (C5, the key becomes neutral) |

Muted text is 60% alpha, not the app's `/50`: at 50% the 11–12sp labels
measured 4.11:1 / 3.90:1, under AA.

**Not current any more, as of `docs/ime-visual-parity-plan.md`**: that
document migrates the blue-navy palette's hex values (to match the real
Android app) and adds gradient fills where these ratios assumed flat ones.
Re-run this same table against whatever values implementation actually
lands on — coral's own values are kept, so its three rows should still
hold, but don't assume that without re-checking once the gradient stops are
picked.

### 1. Accessibility labels — mixed

`contentDescription` is present on the icon-only Lock and Clear-field top-bar controls (`"Lock vault"`, `"Clear field"`) — correct. It's absent from the coral create panel's chevron/✕/✓ header controls added earlier this session (`buildCreatePanel`) — those are icon-only and currently unlabeled for a screen reader/TalkBack user, worth adding `contentDescription` to each (`"Back"`/`"Cancel"`, `"Cancel"`, `"Save"`) as a small follow-up.

### 8. Feedback

Fill actions get haptic feedback (`performHapticFeedback(VIRTUAL_KEY)`) consistently at tap sites checked. The "Filled"/chunked-progress labels on the Card-number chunked flow give the person an inline state readout instead of a toast that could be missed — a good pattern, matches the skill's Priority-8 "helper text over toast" guidance. The terminal "Filled" reverts to a clickable Fill and "Fill part 1 of 4" `FILLED_REVERT_MS` after it appears (see `docs/ime-layout-v2-and-grab-design.md`'s "Card Number's chunked-fill treatment"); the in-progress "Fill part N of 4" counter holds until the fourth chunk lands or another entry is opened.

### Design-doc discipline — a real strength

Both `VaultIme.kt` and `VaultKeyboardView.kt` document *why*, not just what, at a level rare in a codebase this size: `switchToPreviousKeyboard`'s API-28 gate and its `switchToAnyOtherEnabledKeyboard` fallback for when the system's switch-history is empty; `grabTextFromTargetField`'s selection-vs-whole-field fallback order with a disclosed, unverified edge case (a host app's own selection toolbar disrupting `InputConnection` state); `onStartInputView`'s `restarting` guard, which exists specifically to stop the picker flickering on every digit typed into a `type="number"` field. This isn't a UX finding so much as a note that the codebase's own comments are already doing half the audit's job — several of this review's own findings (the touch-target commitments in particular) were found *because* the docs stated them explicitly enough to check against.

---

## What this review did not cover

`MainActivity.kt`, `VaultImePreviewActivity.kt`, `QuickFillRanking.kt`/`QuickFillUsage.kt` were not read in this pass — none render UI directly. The smaller form components (`DateInput.tsx`, `MonthYearInput.tsx`, `DateFieldWithRenewal.tsx`) were read but produced no findings beyond what's already listed under Forms & Feedback above. `slate-500`'s actual call sites weren't exhaustively enumerated — flagged as a ratio failure, not yet as a confirmed list of every affected screen.

## Status: the touch-target gaps are fixed

Implemented and verified (brace/paren-balance check on the Kotlin file, no compiler available in this sandbox — real build verification still needs `npm run build` / `tauri android dev` on the actual machine):

- `src/index.css`: `.field`/`.btn` `py-2` → `py-3`.
- `VaultKeyboardView.kt`: `TOP_BAR_HEIGHT_DP` 40 → 44, Lock/Clear-field now 40dp tap areas (`MIN_TOUCH_TARGET_DP`, the IME's 40dp floor), drawn as 32dp gradient rounded rectangles inside the bar, Clear-field given an explicit 40dp `minWidth`, `smallActionButton`'s layout height `dip(28)` → `dip(44)` (above the floor; left as is). See `docs/ime-visual-parity-plan.md` item 10.

---

## Onboarding flow (first-time use) — critiqued and fixed

Separate pass, `/design-critique` on `Onboarding.tsx`'s create-vault step. Findings and status:

| Finding | Severity | Status |
|---|---|---|
| No reveal toggle on either master password field — the one password with no recovery path had no way to check what was typed | 🔴 Critical | **Fixed.** Both fields get a proper 44px-wide show/hide toggle (`EyeIcon`/`EyeOffIcon`), not the smaller icon-only pattern `Unlock.tsx` uses. |
| "No recovery" warning was just paragraph text, easy to skim past | 🟡 Moderate | **Fixed.** Added a checkbox ("I understand this password can't be recovered") that gates the Create button. |
| Helper copy told the user to go read a setup doc (`See docs/google-oauth-setup.md`) | 🟡 Moderate | **Fixed.** Replaced with plain language. |
| Drive-sync privacy explanation was styled weaker than the checkbox label above it, and used the AA-failing `slate-500` | 🟡 Moderate | **Fixed.** Bumped to `slate-400` — fixes both the contrast and the emphasis in one change. |
| No confirmation moment after vault creation — straight to the empty list | 🟢 Minor | **Fixed.** The empty vault now shows "Vault created" instead of the generic "This vault is empty," once, right after onboarding (`store.tsx`'s new `justOnboarded` flag). |
| Biometric unlock only discoverable later, in Settings | 🟢 Minor | **Fixed.** Same welcome moment now offers it inline (Enable/Skip) when the device supports it and it isn't already on. |

Verified: `npm run typecheck`, `npx eslint` on the three changed files, and the full `npm run test` suite (164 tests) — all clean. `AdoptExisting`'s single password field (the second-device flow) was left as-is; the critique only covered the create-vault step.

Findings #4 and #5 above (the disconnected form-error placement, and the reduced-motion gap in `PasswordField.tsx`) are now both fixed too — `EntryEditor.tsx` moved validation errors inline next to their fields, and `PasswordField.tsx` gates its scramble animation behind `usePrefersReducedMotion()`. Both changes cite this doc's findings by number in their own code comments.
