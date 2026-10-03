# IME layout v2 and Grab — design

Seven comments across `VaultIme.kt` and `VaultKeyboardView.kt` cite this doc
by name as the source for two unrelated changes bundled into the same pass:
a "roomier" layout revision to the on-screen keyboard, and a new "Grab" chip
that pulls content out of whatever field in the host app currently has
focus. This is that design, written up against what's actually shipped.

## Grab: pulling the host app's own field content into a draft

The streamlined account-creation panel's "Grab" chip
(`grabIntoDraftField`/`onGrabFromField`, wired to every draft field —
`VaultKeyboardView.kt`'s per-field actions row) reads from the *host app's*
currently focused field, not from anything Vault itself holds.
`VaultIme`'s own picker views never take real input focus (they're not
`EditText`s), so `currentInputConnection` keeps pointing at whatever field
the keyboard was summoned for, the same fact `onCommitText`/
`sendTabKeyEvent` already depend on to write *into* that field. Reading
works the same way, with no special permission needed.

`grabTextFromTargetField()` (`VaultIme.kt`) tries two `InputConnection`
reads, in order:

1. **`getSelectedText(0)`** — a text selection is the more specific,
   deliberate signal ("grab *this*"). Used if it comes back non-blank.
2. **`getExtractedText(ExtractedTextRequest(), 0)`** — the field's whole
   current content, used only when nothing's selected ("grab whatever's
   already there").

Both are ordinary read-only `InputConnection` methods, present since API
3/11 respectively — well under this app's `minSdkVersion = 26`, so unlike
`switchToPreviousInputMethod` (API 28) elsewhere in this file, neither
needed its own SDK-version guard.

Every draft field offers Grab, **including Password** — a site can display
its own freshly-generated password as plain visible text (a "your new
password is:" confirmation screen, for instance), which is a legitimate
thing to grab rather than requiring it be retyped by hand.

**Not device-verified**, and this discloses a real, narrow risk rather than
solving it: some apps' own text-selection UI (the floating cut/copy/paste
toolbar) can briefly disrupt input-connection state right after a genuine
selection was made, which could make `getSelectedText` come back empty even
though the user just selected something. There's no way to rule that out
from a sandbox with no real device.

## Layout v2: the "roomier" pass

A revision to the on-screen keyboard's own key sizing, after several earlier
adjustment passes left it feeling cramped:

- **`KEY_ROW_HEIGHT_DP`**: 42dp, up from 38dp (itself the end of an earlier
  34 → 36 → 38dp sequence) — 4dp more per this pass.
- **Padding**: bumped from an asymmetric `14/13/14/13` to a uniform
  `16/16/16/16`.

No new mechanism, just revised constants — the surrounding measurement and
layout logic is unchanged.

## Card Number's chunked-fill treatment

Card's Number field gets special treatment other fields don't: a two-way
mode switch under its Fill, **Whole · 4 parts** (`IME-CONTROLS-REFINEMENT-PLAN.md` item
2). In Whole, Fill types all 16 digits like any other field. In 4 parts,
Fill commits one 4-digit group per tap via `performChunkFill`, tracked by a
`cardChunkProgress` counter (0–4), and its label shows the next part
("Fill 1/4", "Fill 2/4", …). Switching modes resets the count. Once all
four groups are committed, Fill shows a disabled "Filled". That state is
transient, not terminal: `FILLED_REVERT_MS` (1.5s, the same flash every
other Fill button gets from `markFilled`) after it first renders,
`scheduleCardFilledRevert` resets the counter to 0 and re-renders, so
Fill comes back clickable as "Fill 1/4" (it used to stay disabled
until another entry was opened). `markFilled` alone couldn't cover this row: it
reverts one `Button` instance, but by this point the row has been rebuilt
around a different, permanently disabled one.
This exists for sites whose card-number input is itself split into four
separate 4-digit boxes, where a single paste-everything Fill lands the
whole number in the first box.

This was implemented against `quick-fill-search-improvements.md`'s
"chunked fields" spec — a document that lives only in the connected
Claude.ai Project, not in this repo's `docs/` (see
`docs/QUICK-FILL-RANKING-DESIGN.md`'s own opening line, which discloses the
same external source for a different, earlier batch of changes it partially
implements). Every other field, expiry included, keeps the plain
single-button treatment, aside from expiry's own **MM/YY · YY/MM** switch
(`performExpiryFill`, unrelated to chunking).

## Where "add entry" lives

The keypad's last row: "space" plus a key-sized **+** key with a faint coral tint (the key gradient warmed toward coral, a light-coral glyph — see `IME-CONTROLS-REFINEMENT-PLAN.md`, "The + key")
(`spaceRow`, search screen only), and — when a search finds nothing — a
**Save new login for 'xyz'** button under "No matches". It was once a
half-width coral "Add Entry" key in that row, and briefly a button beside
the search field; neither is coming back — see `ACCOUNT-CREATION-DESIGN.md`'s
"Revision: Save says what happened, and where to start a new entry".
