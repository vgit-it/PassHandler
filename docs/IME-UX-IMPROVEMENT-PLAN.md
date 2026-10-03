# Android IME — UX improvement plan

**Status: all three phases built** (compile; not yet device-verified —
see `VERIFICATION.md` §6). 3.6's evaluation recommends *not* adopting the
Autofill Framework for now. Implements every finding in
[IME-UX-REVIEW.md](./IME-UX-REVIEW.md), in three phases:

1. **Safety and correctness** — small changes that remove data-loss and
   privacy risks.
2. **The fill flow** — rows, suggestions, search controls, heights, feedback
   and polish.
3. **Structural** — keypad, top-bar context, keyboard switching, the signup
   flow and an Autofill Framework evaluation.

Each phase ships on its own and leaves the keyboard in a consistent state.
Finding IDs (P4, L1, …) refer to the review.

All code is in tracked `src-tauri/android-ime/` (never `gen/android`), plus
`src/app/store.tsx` for bridge changes. `VaultImePreviewActivity`'s
`FakePreviewEntrySource` gets every new `EntrySource` method, so the preview
keeps working.

---

## Decisions needed before implementing

Each has a recommendation. Anything left unanswered goes ahead with the
recommendation.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | P4: what happens when a draft is cancelled after it has written to the page? | (a) confirm before discarding; (b) never discard — save it flagged for review, like a lock does | **(a)**, shown only when the draft has any non-empty field. Empty drafts cancel silently. |
| D2 | P10: the centred wordmark was placed by direct request. Replace it with "Filling into Netflix"? | (a) replace, wordmark as fallback; (b) keep the wordmark, put the app name elsewhere | **(a)**. Show the app's name when one is known; show the wordmark when it isn't. |
| D3 | L2/C1: how should the keyboard get shorter? | (a) compact the always-visible keypad; (b) hide the keypad until the search box is tapped (list-first) | **(a)**. The keyboard stays predictable and keeps Phase 2's three-row results area, but the total height ends up about where it was before Phase 2 (~488dp plus inset; see 3.1). (b) is the only option that really shortens it (~330dp until typing), at the cost of hiding the keys. Pick (b) if covering the form bothers you more. |
| D4 | P7(c): add a mode that types into the page? `ACCOUNT-CREATION-DESIGN.md` rejected this as option (b). | keep rejected / build it | **Keep rejected.** Do P7(a) (switch key) and P7(b) (grab on return) instead. |
| D5 | C6: undo for Clear keeps the cleared text in memory. It might be a password. | allow a 5s undo / no undo, long-press to clear instead | **5s undo**, memory only, dropped on timeout or `stop()`. |
| D6 | C7: how should the Lock button read? | (a) open padlock; (b) padlock plus a "Lock" text label, neutral tint | **(b)**. It mirrors "Clear" on the right. The green "unlocked" tint goes away. |
| D7 | L5: what shape should entry icons be? | circle (now) / rounded square | **Rounded square**, matching the app's Android peg (50dp box, 10px radius, scaled to 32dp with a 7dp radius). |
| D8 | A1: muted text changes from 50% to 60% opacity (`#99D6E4EF`) | the IME only / the app too | **The IME only** in this plan. The app's own `/50` text probably has the same problem; flag it separately. |
| D9 | C5: where does "Add entry" go? | (a) a neutral "+" key in the space row, plus a contextual button in "No matches"; (b) the contextual button only | **(a)**. It keeps a way to add a *second* account for a site that already has matches. |

---

## Phase 1 — Safety and correctness ✅ built

Built with every recommended decision (D1, D8). Two things beyond the plan:

- **A3 was pulled forward.** The create panel's pills and toggles went from
  36dp to 40dp (radius 20dp) here rather than in 2.7, because the new
  discard bar pairs a pill with a 40dp button.
- **An existing bug was fixed alongside 1.3.** `finishDraft` (✓) never reset
  `screen`, and neither did a lock that finalized the draft, so the next
  show found no draft but stayed on an empty create panel. `start()` now
  leaves `Screen.CREATE` when `getDraft` is empty, and `finishDraft` resets
  `screen` itself.
- `CREATE_CHEVRON` was deleted with the chevron, its only user.

### 1.1 Cancelling a draft can't orphan a generated password (P4, D1)
- `buildCreatePanel` header:
  - **Remove the "‹" chevron.** One cancel control remains: the "✕"
    (content description "Cancel").
- `cancelDraftFlow`:
  - If `currentDraft` has any field with a non-empty value, don't discard.
    Swap the header for an inline confirm bar: "Discard this entry? Anything
    already typed into the page won't be saved." with **[Keep editing]** and
    **[Discard]** (40dp, Discard in the destructive outline style).
  - Only [Discard] calls `entrySource.cancelDraft()`.
  - A draft with all fields empty still cancels immediately.
- The confirm state is view-only (`confirmingDraftDiscard: Boolean`), reset
  by `closeDraftPanels`.
- **Done when:** after Generate, ✕ asks before discarding; an untouched
  draft cancels at once; no chevron remains.

### 1.2 Draft actions only write into the right kind of field (P5, T3)
- **Track the focused field's kind.**
  - `VaultKeyboardView` gains `focusedFieldIsPassword: Boolean`.
  - It's updated by `onEditorInfoChanged(info)`, which `VaultIme.onStartInput`
    already calls on every focus change.
  - That also covers a show's first field: `onStartInput` runs before
    `onStartInputView`, so no extra plumbing was needed.
  - `isPasswordInputType` is reused as-is.
- **Generate, Regenerate and generator setting changes**
  (`generateDraftPasswordField`, `applyPasswordOptions`):
  - When the focused field is a password field: clear it and type, as now.
  - Otherwise: update the draft only (the JS side already stores the
    generated value). Show an inline note: "Password generated — tap the
    page's password field, then Fill."
  - The draft row's existing "Fill" chip then writes it on an explicit tap.
- **Pick a saved email** (`pickKnownEmail`): write into the page only when
  the focused field is *not* a password field; otherwise update the draft
  only, with the same kind of note.
- **The draft row's "Fill" chip:** unchanged. It's an explicit tap, and the
  confirm-password case is a password field anyway.
- **Done when:** with the username focused, Generate leaves it untouched and
  the draft holds the password; with the password focused, Generate fills
  it.

### 1.3 A different app starts a clean search (P3, T2)
- `VaultKeyboardView` gains `lastSessionPackage: String`.
- In `start()`: if `callingPackage != lastSessionPackage`, reset the
  search session (`resetSearchSession`): `query`, `selectedEntryId`,
  `cardChunkProgress`, `expiryFormatSwapped` and `savedScrollY`, and
  `screen` from DETAIL back to SEARCH. `Screen.CREATE` is left for
  `getDraft`'s answer to decide. Then record `lastSessionPackage`.
- **A draft is deliberately untouched.** `ACCOUNT-CREATION-DESIGN.md`'s
  "Session lifetime" requires it to survive app switches (for example,
  reading an OTP in Messages).
- The same app keeps today's resume behaviour, per
  `QUICK-FILL-RANKING-DESIGN.md`'s "Session persistence".
- **Done when:** after opening entry X in app A, opening the keyboard in app
  B shows an empty search; returning to A resumes X.

### 1.4 The keyboard blocks screen capture (T1)
- `VaultIme`: add `FLAG_SECURE` to the IME window (`window.window`) in
  `onCreate`, and re-assert it in `onStartInputView` in case the window is
  rebuilt.
- **Done when (on device):** a screenshot or screen recording shows the
  keyboard area blacked out.
- Document it in `SECURITY.md`, next to the main app's `FLAG_SECURE`.

### 1.5 Readable entry type names (content bug)
- `store.tsx` `listEntries` adds `typeLabel: getEntryType(entry.type).label`.
- `FillEntry` gains `typeLabel`, parsed in `WebViewBridge.parseEntries`,
  falling back to the id when it's missing.
- The detail header shows `typeLabel` instead of
  `type.replaceFirstChar { uppercase }`.
- The preview's sample entries get labels too.
- An unknown type id is sent as-is rather than through `getEntryType`,
  whose fallback would label it "Login". Covered by typecheck (the bridge's
  list shaping is inline in `store.tsx`, not a separately testable
  function).

### 1.6 Muted text passes AA (A1, D8)
- `MUTED_FOREGROUND` and `PLACEHOLDER` change from `#80D6E4EF` to
  `#99D6E4EF`: 5.25:1 on `CARD` and 4.91:1 on `BACKGROUND` (was 4.11 and
  3.90).
- "Add Entry"'s 4.14:1 label is fixed in Phase 2 by C5, which makes that key
  neutral.
- Correct `UI-UX-REVIEW.md`'s "all pass AA" statement.

---

## Phase 2 — The fill flow ✅ built

Built with every recommended decision (D5, D6, D7, D9). Where it differs
from the steps below:

- **Heights.** The search screen's results region is 196dp, not 180: a
  section label (~25dp) plus three 52dp rows with 2dp margins needs 193.
  Every screen shares one body height, `BODY_HEIGHT_DP` = 518dp, with the
  results region taking what's left (layout weight 1) rather than a
  per-screen `setResultsHeight`.
- **The keyboard is taller than before, on every screen.** 518dp plus the
  bottom clearance (at least 48dp, so ≥566dp) versus 491dp (search),
  459dp (detail) and 449dp (create) before, all including the old fixed
  48dp inset. That's the direct cost of L1 (three visible rows) plus L4 (one
  height everywhere, so detail and create take the search screen's height).
  Phase 3's keypad and search-box compaction takes about 31dp back; only
  D3(b) makes it meaningfully shorter.
- **Subtitles skip date fields** — the bridge sends them as bare fill
  digits ("1128"), which read as noise.
- **"Filled!" has a check glyph** instead of a "✓" character, and the
  card's terminal state reads "Filled".
- **Clear's undo needed a new constructor callback**, `onReadField` (the
  field's whole text, ignoring any selection — `onGrabFromField` prefers a
  selection, which would make Undo restore only part of the field).
- **Save's confirmation has a third message.** `commitDraft` returns
  `false` both for an empty draft and when the vault had auto-locked (the
  lock saved the draft itself); a draft that held values can only come back
  `false` through the lock, so that case reads "Vault locked — the entry was
  saved for review."
- **Loading.** A same-app reopen keeps showing the previous view until the
  entries arrive; a first show *or a show in a different app* gets the
  full-height loading view (the old view would briefly show the other
  app's session).

### 2.1 Compact rows with subtitles; a taller results area (P1, L1, L5, D7)
- **`buildResultRow`:**
  - About 56dp tall: 10dp vertical and 12dp horizontal padding.
  - A 32dp icon.
  - Title at 15sp, with a 12sp muted subtitle underneath.
- **Subtitle rule:** a port of `EntryList.tsx`'s `rowSubtitle`.
  - Login: username, else email.
  - Other types: the first non-sensitive, non-multiline, non-empty value.
  - Omitted when there's nothing to show.
- **Icon shape:** `buildAvatar`'s plate and favicon both become a rounded
  square (32dp, 7dp radius), so they match each other and the app.
  `filledOval` is deleted.
- **Height:** `SEARCH_HEIGHT_DP` goes from 120 to 180, which fits the section
  label plus three rows. The comment is fixed to say what it really shows.
  Every search state keeps the same height, as the class doc requires.

### 2.2 Suggestions and empty states (P2, content)
- **App label for suggestions.** `setDetectedContext` gains `appLabel`: the
  *unfiltered* app name, so browsers get "Chrome". The title guess stays
  browser-filtered for drafts.
- **`QuickFillRanking.suggestions(appLabel, packageName, entries)`** returns
  entries whose title or URL host contains a normalised form of the app
  label, or a meaningful package segment (`com.netflix.mediaclient` →
  "netflix"). It skips browsers, where it can't know the site.
- **What an empty query shows:**
  - Recents first, then suggestions not already listed.
  - Label "Recent", "Suggested for Netflix", or both.
  - In a browser: "Recent in Chrome".
  - If both are empty: a muted one-line hint, "Type to search your vault".
- **No matches:**
  - The message becomes "No matches for 'xyz'".
  - It's followed by a **"Save new login for 'xyz'"** button, which starts a
    draft with the query as the title guess (D9).

### 2.3 Search box controls (C2, C3)
- **A ✕ inside the search box** whenever the query isn't empty; it clears the
  query.
- **Backspace repeats while held:** 400ms initial delay, then every 60ms,
  via a touch listener on `uiHandler`.
- **Detail view:**
  - "New search" becomes **"‹ Back to results"**, which is what it does (the
    query is kept).
  - The header stops being a second back control: the chevron is removed and
    the header isn't tappable.
  - The header shows the entry's icon, title and type label (1.5).

### 2.4 Fill feedback and one-tap login (P9)
- **Show the automatic password fill.** When `onEditorInfoChanged` fills the
  password, and the same entry's detail view is showing, that row's Fill chip
  flashes "✓ Filled!". This uses an `autoFilledFieldKey` state read during
  render, cleared after `FILLED_REVERT_MS`.
- **When not to send Tab:**
  - after filling a field while the focused field is a password field (1.2's
    tracking);
  - after the last fillable field in the entry's display order;
  - otherwise, unchanged.
- **One-tap "Fill" on Login result rows** that have a username or email *and*
  a password:
  - If the focused field is a password field, fill the password.
  - Otherwise fill the username (or email), which then chains into the
    existing Tab-then-password step.
  - It records frecency like any fill.
  - It's a 40dp gradient chip at the row's right edge; tapping elsewhere on
    the row still opens the detail view.

### 2.5 Real inset, one height, a proper locked view (L3, L4, P6)
- **Bottom inset:** `bottomInsetSpacer` is replaced by an
  `OnApplyWindowInsetsListener` on each root view.
  - API 30 and up: bottom padding comes from
    `WindowInsets.Type.navigationBars()`.
  - API 26–29: `systemWindowInsetBottom`.
  - Either way it's floored at `BOTTOM_CLEARANCE_DP` (48dp). With gesture
    navigation the reported inset (~16–24dp) is smaller than the 48dp strip
    where Android draws its hide-keyboard and switch-keyboard buttons, so
    the inset alone let them overlap the keypad.
  - Needs checking on device in both navigation modes.
- **One height for every screen:**
  - A single `UNLOCKED_BODY_HEIGHT_DP` for the whole keyboard above the
    inset.
  - `setResultsHeight` works out each screen's results height as that total
    minus the screen's own chrome. Search, detail and create are then the
    same height, and the host app never reflows on screen changes.
  - `DETAIL_HEIGHT_DP` and `CREATE_HEIGHT_DP` become derived values.
- **Locked view at the same total height:**
  - One line: "Vault is locked. Unlock it to fill passwords."
  - A primary **Unlock Vault** button.
  - A secondary **"Use other keyboard"**, which calls
    `onSwitchToPreviousKeyboard`.
  - `buildLockedHeader`'s lone muted "Vault" label is replaced by the same
    top-bar layout as the unlocked view, with the wordmark only.
- **Loading:** `start()` no longer swaps to the loading view when a
  locked or unlocked view already exists. It refreshes in place, and the
  bridge answer usually arrives within one frame. The very first show uses
  a full-height placeholder.

### 2.6 Save confirmation (P8)
- After ✓, `finishDraft` waits for `commitDraft`'s callback. The panel then
  shows **"Saved to Vault — review it in the app"** (or "Nothing to save"
  when the callback reports `false`) for about 1s, and then switches
  keyboards.

### 2.7 Controls polish (C5–C10, A2, A3, content)
- **C5 / D9: "Add entry".** The coral half-width "Add Entry" key becomes a
  key-sized "+" icon key (content description "Add entry"), since given a
  faint coral tint (`IME-CONTROLS-REFINEMENT-PLAN.md` "The + key"). It
  stays in the space row, and "No matches" gets the contextual button (2.2).
  This removes the only accent colour on the search screen and the 4.14:1
  label.
- **C6 / D5: undo for Clear.**
  - Before clearing, read the field's text (the same `getExtractedText` path
    Grab uses).
  - The "Clear" pill becomes **"Undo"** for 5s; tapping it types the text
    back.
  - The text is held only in memory, and dropped on timeout, on `stop()`, or
    on focus change.
  - Nothing is kept when the field was empty.
- **C7 / D6: Lock button.** It becomes an icon plus a "Lock" label, with the
  icon tinted `SECONDARY_FOREGROUND` rather than green. `SUCCESS` stays in
  use for fill feedback.
- **C8: clearer labels.** The card number's "Split N/4" and the expiry's
  MM/YY toggle are now two-way mode switches under Fill ("Whole · 4
  parts", "MM/YY · YY/MM"), see `IME-CONTROLS-REFINEMENT-PLAN.md` item 2.
- **C9: disabled buttons.** A disabled `smallActionButton` gets a flat `CARD`
  fill, no elevation, and muted text.
- **C10: real icons.** New vector drawables, transcribed from `icons.tsx`
  where one exists: `ic_back.xml` (BackIcon), `ic_check.xml` (CheckIcon),
  `ic_close.xml` (the X from the same 24×24, 1.8-stroke grid) and
  `ic_backspace.xml` (new, drawn on the same grid). They replace ‹ ✓ ✕ ⌫
  everywhere, and each is added to `sync-android-ime.js`.
- **A2: spoken labels and key size.**
  - Content descriptions for backspace ("Delete"), the search-box ✕ ("Clear
    search"), the "+" key, and the icon-only keys.
  - Key labels go from 14sp to 16sp.
- ~~**A3: 40dp minimum.**~~ Done in Phase 1.
- **Copy:**
  - Sentence case throughout ("Add entry", "Back to results"). "Vault" stays
    capitalised as the product name ("Unlock Vault", "Pick from Vault").
  - The ✓ save button becomes a labelled **"Save"** pill, and the subtitle
    reads "…then Save."
- **Field order in the detail view:**
  - The primary fields come first: for a Login, username, email and
    password. For other types, the registry's own order.
  - URL, Notes and any multiline fields go under a collapsed **"More
    fields"** row.
  - The expanded state is view-only and resets when the selection changes.

---

## Phase 3 — Structural ✅ built

Built with every recommended decision (D2a, D3a, D4). Where it differs from
the steps below:

- **The search box is 40dp in a 52dp row, not 36dp in 48dp.** The steps'
  6dp + 10dp padding would have squeezed the field to 36dp, under the 40dp
  floor its ✕ needs. Body height is **492dp** (not 488), plus the bottom
  clearance (the navigation-bar inset, at least 48dp): ≥540dp in all.
- **"Other keyboard" and the locked view's "Use other keyboard" go back to
  the *previous* keyboard** (the one the user came from), rather than
  `switchToNextInputMethod`. Only the globe key cycles to the next one, as
  globe keys conventionally do.
- **Grab on return reads the field's whole text** (`onReadField`, added in
  Phase 2 for Clear's undo), not `onGrabFromField`, which prefers a
  selection.
- **The 123 layer is now three rows** (digits, symbols, toggle/backspace),
  so it's the same height as the letters layer — previously it was two,
  and the fixed body let the results region grow while typing digits.

### 3.1 A shorter keypad with symbols (L2, C1, D3a)
- Key rows go from 42dp to 40dp (the IME floor), and the row gap from 8dp to
  6dp.
- The search box goes from 65dp to 48dp: 6dp outer and 10dp inner vertical
  padding.
- The 123 layer gains a symbol row: `@ . - _ / & '`.
- **Target body height:** 44 (top bar) + 1 (border) + 196 (results) + 48
  (search) + 5 (divider) + 194 (keypad) = **488dp** (from Phase 2's 518),
  plus the bottom clearance: the navigation-bar inset, at least 48dp.
- **Be clear about what this buys.** About 30dp back from Phase 2 — the
  same total as before Phase 2 (~491dp on search), but with a results area
  that shows three rows instead of one and a height that never changes
  between screens. It does **not** meaningfully shorten the keyboard. Only
  D3(b), hiding the keypad until the search box is tapped, does that: about
  330dp until you start typing. If covering the form is the bigger concern,
  choose D3(b) instead.

### 3.2 "Filling into …" in the top bar (P10, D2)
- The centre of the top bar shows the app label from 2.2 ("Filling into
  Netflix", or "Filling into Chrome"), ellipsised between Lock and Clear.
- When no label is known (no `EditorInfo`, or the preview), it falls back to
  `ic_home_logo`.
- Update the logo text in `ime-ux-redesign-proposal.md` and
  `ime-visual-parity-plan.md` item 10, and remove the stale descriptions.

### 3.3 Switch-keyboard key (C4, P7a)
- A globe key goes at the left of the space row: [🌐][space][+].
- Tap calls `switchToNextInputMethod(false)`, falling back to the existing
  `switchToPreviousKeyboard` chain. Long-press opens the system picker.
- It's shown only when `shouldOfferSwitchingToNextInputMethod()` is true.
- **Create screen:** its keypad is hidden, so the panel's subtitle row gains
  a small "⌨ Other keyboard" chip. That's the step the P7 flow needs most.
- The locked view's "Use other keyboard" (2.5) uses the same callback.

### 3.4 Grab on return (P7b)
- When the keyboard is shown (`start()`) with an active draft, read the
  focused field's text, using `onGrabFromField`'s path.
- If that text is non-blank and isn't already a draft value, show a prompt
  row at the top of the create panel: **"Use “jane@x.com” for:"** with one
  chip per matching draft field, plus [Dismiss].
- **Which fields are offered:**
  - In a password field: only password-type fields, and the prompt shows
    `••••` rather than the text.
  - Otherwise: the non-sensitive text fields, with an email-shaped value
    listing the email field first.
- **Security:** the prompt holds the text in memory only while it's showing,
  like 2.7's Clear undo. Add this to `SECURITY.md`.
- This keeps option (a) of `ACCOUNT-CREATION-DESIGN.md`. Nothing is typed
  on the user's behalf; it only saves what they already typed.

### 3.5 Type into the page (P7c, D4)
- Not built, unless D4 is overturned. `ACCOUNT-CREATION-DESIGN.md`'s
  rejected option (b) stays the reference if it's ever reopened.

### 3.6 Autofill Framework evaluation (P11)
- Deliverable: `docs/AUTOFILL-FRAMEWORK-EVALUATION.md`. **No code.**
- It covers:
  - What an `AutofillService` with inline suggestions (API 30+, shown inside
    Gboard's strip) would need, given the vault lives only in the webview:
    the same `WebViewBridge` constraint, and what happens when the app
    process isn't running.
  - Security implications compared with `SECURITY.md`.
  - The UX gain per flow (fill, signup).
  - Effort.
  - Whether the IME becomes the fallback.
- It ends with a recommendation.

---

## Documentation per phase

Written in the same change as each phase's code. Superseded descriptions are
deleted, not annotated.

| Phase | Docs |
|---|---|
| 1 | `MANUAL-FILL-DESIGN.md` (cross-app reset, focused-field rules, type labels on the bridge); `ACCOUNT-CREATION-DESIGN.md` (discard confirmation, focused-field write rule); `QUICK-FILL-RANKING-DESIGN.md` ("Session persistence" is now per app); `SECURITY.md` (IME `FLAG_SECURE`); `UI-UX-REVIEW.md` (A1 correction); `VERIFICATION.md` (device checks) |
| 2 | `MANUAL-FILL-DESIGN.md` (rows, heights, inset, locked view, Tab rules, one-tap Fill, More fields); `QUICK-FILL-RANKING-DESIGN.md` (suggestions, empty states); `ACCOUNT-CREATION-DESIGN.md` (save confirmation, Save label, No-matches entry point); `ime-visual-parity-plan.md` (shapes, disabled style, icons, Add entry colour); `SECURITY.md` (Clear undo); `sync-android-ime.js` comment |
| 3 | `ime-ux-redesign-proposal.md` (keypad, key-row exception, top-bar centre, switch key); `ACCOUNT-CREATION-DESIGN.md` (grab on return; option (b) still rejected); `SECURITY.md` (grab-on-return memory); new `AUTOFILL-FRAMEWORK-EVALUATION.md`; `CLAUDE.md` if a convention changes |

After each phase, mark the findings it closed as ✅ in `IME-UX-REVIEW.md`.

## Verification per phase

- **Automated, every phase:**
  - `npm run typecheck`, `npm run lint`, `npm test`;
  - `npm run android:sync-ime`, then
    `./gradlew :app:compileArm64DebugKotlin -x rustBuildArm64Debug` in
    `src-tauri/gen/android`.
- **On a device** (none available to this agent), added to
  `VERIFICATION.md` §6:
  - **Phase 1:** screenshot blocked; Generate with username vs password
    focused; cancel confirmation; cross-app reset; type labels.
  - **Phase 2:** three rows visible; suggestions in a native app; one-tap
    Login fill end to end; no height jump between screens; the system's
    bottom buttons clear the keypad in gesture and 3-button navigation; Clear undo.
  - **Phase 3:** switch key; keypad fits; "Filling into"; grab on return.
