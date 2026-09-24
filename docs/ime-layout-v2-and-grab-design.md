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

Card's Number field gets special treatment other fields don't: alongside
the ordinary "Fill all" button (identical to every other field's plain
Fill), a second "Split N/4" button commits the card number one 4-digit
group at a time via `performChunkFill`, tracked by a `cardChunkProgress`
counter (0–4) that relabels the button ("Split 1/4", "Split 2/4", …) and
swaps to a disabled "✓ Filled" state once all four groups are committed —
whether by tapping through every chunk or by "Fill all". That state is
transient, not terminal: `FILLED_REVERT_MS` (1.5s, the same flash every
other Fill button gets from `markFilled`) after it first renders,
`scheduleCardFilledRevert` resets the counter to 0 and re-renders, so
"Fill all"/"Split 0/4" come back clickable (it used to stay disabled until
another entry was opened). `markFilled` alone couldn't cover this row: it
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
single-button treatment, aside from expiry's own separate format-toggle
chip (`performExpiryFill`, unrelated to chunking).

## "Add Entry" — moved, then moved back

The "+"/"Add Entry" key's position went through two changes:

1. **Originally** on `spaceRow` itself, alongside "space" — `spaceRow`'s
   optional right-key slot (the same rounded-rectangle `specialKey` shape
   `buildBottomActionRow` already supports) rendering "Add Entry" there,
   visible only on the search screen.
2. **This pass moved it beside the search field instead.**
3. **A later, direct request moved it back** to its original spot on
   `spaceRow`, where it remains today — confirmed live in
   `VaultKeyboardView.kt`'s `buildResultsHeaderRow`-adjacent comment, which
   notes explicitly that this doc "first moved it beside the search field"
   before the revert. The intermediate beside-search placement
   (`buildResultsHeaderRow`) no longer exists in the current file.
