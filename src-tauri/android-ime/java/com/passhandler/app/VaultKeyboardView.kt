package com.passhandler.app

import android.animation.LayoutTransition
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.text.SpannableString
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.util.Base64
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView

/**
 * Everything the manual-fill picker — and, since
 * `docs/ACCOUNT-CREATION-DESIGN.md`, the streamlined account-creation panel
 * built on top of it — actually looks like and does: every view-building
 * function, every bit of search/selection/reveal/fill/draft state, lives
 * here, independent of `InputMethodService`. `VaultIme` is a thin
 * adapter around this: it supplies a real `Context`, wires the callbacks
 * below to actual IME behaviour (commit text, switch keyboards, launch
 * Vault) plus this show's detected context (`setDetectedContext`), and
 * forwards its lifecycle callbacks to `start()`/`stop()`.
 * `VaultImePreviewActivity` is the other adapter — same class, sample
 * data, callbacks that just toast instead of touching a real input
 * connection — which is the whole point of this split: a layout or spacing
 * change made here shows up correctly in both without having to be made
 * twice.
 *
 * @param context Used only for view construction and `resources` — never
 *   cast back to an `InputMethodService`/`Activity`, so either adapter can
 *   hand in whatever `Context` it has.
 * @param entrySource Where entries and field values come from — the real
 *   `WebViewBridge` (via `WebViewBridgeEntrySource`) for the IME, a fixed
 *   in-memory list for the preview.
 * @param onViewChanged Called whenever the picker wants to swap its entire
 *   displayed view (loading → locked/full, or locked ↔ full) — the IME maps
 *   this straight to `setInputView`; the preview activity swaps a
 *   container's single child.
 * @param onCommitText The picker has a value ready to type into whatever
 *   field is focused — the IME forwards it to `currentInputConnection`,
 *   which doesn't exist outside a real IME session, hence the indirection.
 * @param onSwitchToPreviousKeyboard The picker is done and wants to hand
 *   control back to whatever keyboard was active before it — real
 *   API-version-gated logic in the IME, a no-op/toast in the preview.
 * @param onOpenVault The user tapped "Unlock Vault" from the locked
 *   state — the IME launches `MainActivity`; the preview just toasts, since
 *   there's no real vault to unlock here.
 * @param onClearField The "fix a mistake" key was tapped — wipe whatever's
 *   currently in the focused field so a wrong fill (or the user's own typo)
 *   can be retyped without switching away to delete it by hand. The IME
 *   deletes around the focused field's cursor in both directions via
 *   `InputConnection.deleteSurroundingText`, which works regardless of
 *   where the cursor sits — clearing by selecting-all first would depend on
 *   the target app actually supporting that; the preview just toasts.
 * @param onSendTab An ordinary fill just landed and this wants to move
 *   focus to the form's next field — see `armPostFillTabAndPasswordCheck`'s
 *   own doc and `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then Tab" section.
 *   The IME sends a real `KEYCODE_TAB` through `currentInputConnection`,
 *   same as a hardware keyboard would; the preview just toasts.
 * @param onGrabFromField The account-creation panel's "Grab" chip (see
 *   `buildDraftFieldRow`) — pull whatever's already in the *host app's*
 *   focused field (a text selection if one exists there, otherwise the
 *   field's whole current content) straight into a draft field, no typing
 *   required. The IME reads it via `currentInputConnection.getSelectedText`/
 *   `getExtractedText` — see `docs/ime-layout-v2-and-grab-design.md` — the
 *   preview just returns a canned sample string.
 * @param onReadField The focused field's *whole* current text, ignoring any
 *   selection (unlike `onGrabFromField`) — read by the top bar's Clear just
 *   before it wipes the field, so "Undo" can type it back. Also read once
 *   when the keyboard reopens mid-draft, for "grab on return" (see
 *   `offerGrabOnReturn`).
 * @param onSwitchToNextKeyboard The keypad's globe key — the next enabled
 *   keyboard, the way every keyboard's globe key behaves.
 * @param onShowKeyboardPicker The globe key held — the system's keyboard
 *   picker.
 * @param offersKeyboardSwitch Whether to show the globe key at all —
 *   `InputMethodService.shouldOfferSwitchingToNextInputMethod()`, which is
 *   false when the system already shows its own switch button.
 */
class VaultKeyboardView(
    private val context: Context,
    private val entrySource: EntrySource,
    private val onViewChanged: (View) -> Unit,
    private val onCommitText: (String) -> Unit,
    private val onSwitchToPreviousKeyboard: () -> Unit,
    private val onOpenVault: () -> Unit,
    private val onClearField: () -> Unit,
    private val onSendTab: () -> Unit,
    private val onGrabFromField: () -> String?,
    private val onReadField: () -> String?,
    private val onSwitchToNextKeyboard: () -> Unit,
    private val onShowKeyboardPicker: () -> Unit,
    private val offersKeyboardSwitch: () -> Boolean,
) {

    companion object {
        // IME popup windows don't reliably inherit the host app's theme —
        // every color used in this view tree has to be explicit, hence the
        // constants here instead of relying on any default/inherited value.
        //
        // Visual-parity pass (`docs/ime-visual-parity-plan.md`): this whole
        // block used to match a since-superseded blue-navy reference
        // project's `--background`/`--card`/`--border`/`--secondary`/
        // `--muted-foreground`/`--foreground` tokens. It now matches the
        // real Android app instead — re-verified directly against
        // `Unlock.tsx`/`VaultScreen.tsx`/`EntryList.tsx`/`EntryDetail.tsx`/
        // `Settings.tsx`'s own `isAndroid` branches, not the web app's
        // original `--vault-*` CSS tokens (which the Android app has itself
        // drifted from in a later Figma-parity pass — see that plan doc for
        // why the two aren't the same thing). Several constants below don't
        // change at all; each one says so explicitly, so it's clear that
        // was checked, not missed.
        private val BACKGROUND = Color.parseColor("#292c2f")
        private val CARD = Color.parseColor("#1f252d")
        // The general field/shelf/door border tone. A *second*, distinct
        // border tone exists for buttons specifically — see
        // `BUTTON_BORDER` below — the old single-`BORDER` model doesn't
        // survive contact with the real app, which genuinely uses two.
        private val BORDER = Color.parseColor("#4d5761")
        // `SECONDARY` is gone: it used to be "the neutral fill every key
        // uses," but every button-shaped key now gets the gradient-pill
        // treatment below instead of a flat fill — there's no flat
        // "secondary surface" left to name. Its two non-button call sites
        // (the search box pill, search-result rows) moved to `CARD`
        // instead, matching the real app's own flat, gradient-free search
        // field and entry shelves (`vault-visual-language-spec.md`'s own
        // "no border radius on shelves... no gradients" rule for exactly
        // this kind of row).
        private val SECONDARY_FOREGROUND = Color.parseColor("#D6E4EF")
        // `FOREGROUND` at 60% alpha — the same hue family as every "muted"
        // text on the real Android app, but deliberately NOT its `/50`: at
        // 50% the IME's 11–12sp labels measured 4.11:1 on `CARD` and 3.90:1
        // on `BACKGROUND`, under WCAG AA's 4.5:1. 60% measures 5.25:1 and
        // 4.91:1. Accessibility over pixel parity, by decision — see
        // `docs/IME-UX-IMPROVEMENT-PLAN.md` D8. Don't drop it back to `80`.
        private val MUTED_FOREGROUND = Color.parseColor("#99D6E4EF")
        private val FOREGROUND = Color.parseColor("#D6E4EF")
        // The search box's placeholder — same value and reasoning as
        // `MUTED_FOREGROUND`.
        private val PLACEHOLDER = Color.parseColor("#99D6E4EF")
        // Same value as the web app's `ok` Tailwind token (`#4ade80`,
        // `tailwind.config.js`), so the one "it worked" color matches
        // across the Windows/Android webview and this native keyboard —
        // still true after the palette migration, no change needed. Not
        // the same as the *newer*, more muted `--vault-ok` (`#6fbf8b`) that
        // exists alongside it in the web app's own token set — this
        // matches the brighter, older `ok` specifically, which is what the
        // IME's one prior author actually sourced it from.
        private val SUCCESS = Color.parseColor("#4ADE80") // no change — already correct
        // The "+" (Add entry) key: the neutral key gradient warmed toward
        // the create panel's coral, with a light-coral glyph — a hint that
        // it leads to creating, by direct request. Deliberately faint.
        // "Add entry" used to be a half-width, fully coral key beside space
        // — the most saturated control on a screen whose job is filling,
        // not creating, with a label that failed AA contrast (4.14:1)
        // (`docs/IME-UX-REVIEW.md` C5). Don't strengthen this back into
        // that. The glyph is the create panel's light coral
        // (`CREATE_GRADIENT_TOP`), so the key matches the panel it opens;
        // 6.1:1 on the key.
        private val ADD_KEY_TOP = Color.parseColor("#4a4240")
        private val ADD_KEY_BOTTOM = Color.parseColor("#3d3431")
        private val ADD_KEY_BORDER = Color.parseColor("#6b5047")
        private val ADD_KEY_GLYPH = Color.parseColor("#D6B0A0")

        // ── Gradient-pill chrome ─────────────────────────────────────────
        // Every real action button on the real Android app uses this exact
        // recipe — a two-stop vertical gradient, 1px border, soft shadow —
        // not a flat fill: `Unlock.tsx:241` (reused verbatim at `:465`,
        // `:494`), `VaultScreen.tsx:729`/`:765`. Confirmed with the
        // requester (visual-parity plan) that this pass rebuilds the IME's
        // own buttons to match this shape, not just swap their hex values.
        // `GradientDrawable` (already imported, already this file's own
        // shape-helper mechanism) needs no new dependency for the gradient
        // itself; the CSS shadow (`0 0 4.3px rgba(0,0,0,.25)`, a soft,
        // non-directional glow) has no exact Android View equivalent —
        // `elevation` (a real, standard API since 21, this app's own
        // `minSdk`=26 clears it easily) is the closest approximation
        // available without a custom blurred-layer drawable, applied
        // separately at each call site alongside this background, not
        // bundled into the drawable itself. A deliberate approximation,
        // not a bug — flagged here so it isn't mistaken for an oversight.
        private val GRADIENT_TOP = Color.parseColor("#3f454a")
        private val GRADIENT_BOTTOM = Color.parseColor("#32373d")
        private val BUTTON_BORDER = Color.parseColor("#565656")
        private const val BUTTON_ELEVATION_DP = 2

        // ── Account-creation panel's own palette ────────────────────────
        // Everything above is the app's one shared neutral palette — the
        // account-creation panel (`buildCreatePanel`/`buildDraftFieldRow`)
        // does NOT use it, by deliberate, twice-confirmed choice (first
        // when this panel was built, again in the visual-parity pass this
        // comment is part of — "yes I want the account creation also
        // brought to coral," i.e. kept, not dropped to the neutral palette
        // above). The hex values started as a pixel-sampled choice (see
        // `docs/ime-ux-redesign-proposal.md`); they're now a muted version
        // of it, by direct request — same coral hue and light/dark
        // structure, roughly half the saturation, so the panel reads as
        // warm grey rather than brown (`docs/IME-CREATE-PALETTE-MUTE-PLAN.md`).
        // Don't bring the stronger values back. The buttons use the same
        // gradient-pill recipe as everywhere else, recolored in this
        // family: `CREATE_GRADIENT_TOP`/`CREATE_GRADIENT_BOTTOM` below
        // stand in for the neutral recipe's `#3f454a`/`#32373d`.
        // Scoped deliberately narrow, unchanged: only
        // `buildCreatePanel`/`buildDraftFieldRow` use these constants;
        // `buildDetailView`/`smallActionButton` (the DETAIL screen's own
        // field rows) are unaffected, still on the shared palette above —
        // "the IME new entry flow" is what this was scoped to, not the
        // whole IME.
        // Was `#241A16` (24% saturation), `#4A352D` and `#E0A087` (59%).
        private val CREATE_BG = Color.parseColor("#2A2725")
        private val CREATE_BORDER = Color.parseColor("#4D4541")
        private val CREATE_ACCENT = Color.parseColor("#D1A594")
        // Dark text/glyph color drawn on top of an `CREATE_ACCENT` fill
        // (the pill buttons, the checkmark glyph on its filled button) —
        // happens to equal `CREATE_BG`'s value, same coincidence
        // `ACCENT_FOREGROUND`/`BACKGROUND` used to share above, same
        // reasoning for keeping it a separate named constant.
        private val CREATE_ACCENT_TEXT = Color.parseColor("#2A2725")
        // Titles and values: a warm off-white rather than pure white, which
        // looked harsh on the warm surface. 11:1 on the card.
        private val CREATE_FG = Color.parseColor("#F2EDEA")

        // ── Field cards (docs/IME-DETAIL-CREATE-VISUAL-PASS.md) ─────────
        // Both field screens group their fields in one rounded card, like
        // the main app's entry detail. Detail: the app's own
        // `rgba(77,87,97,.4)` card over `CARD`, with dividers at 8%
        // foreground. New entry: a step lighter than `CREATE_BG`.
        private val DETAIL_CARD = Color.parseColor("#313942")
        private val DETAIL_DIVIDER = Color.parseColor("#14D6E4EF")
        private val CREATE_CARD = Color.parseColor("#36312E")
        // Field labels on those cards. Lighter than `MUTED_FOREGROUND`,
        // which measures 4.38:1 on the detail card — just under AA; these
        // are 4.82:1 and 5.42:1.
        private val DETAIL_LABEL = Color.parseColor("#A6D6E4EF")
        // The chosen half of a mode switch (`buildModeSwitch`): a light,
        // flat fill — never the Fill button's raised gradient.
        // `FOREGROUND` on it is 7.1:1.
        private val MODE_SELECTED_FILL = Color.parseColor("#3F4A55")
        private val CREATE_LABEL = Color.parseColor("#B3A69F")
        // The one destructive color ("Discard", and the "Weak" strength
        // label): 5.28:1 on `CREATE_BG`, 4.57:1 on `CREATE_CARD`.
        private val DANGER = Color.parseColor("#EC7777")
        // A callout's tint (grab-on-return offer, notices): `CREATE_ACCENT`
        // at 10%. Labels on it are 5.16:1.
        private val CREATE_CALLOUT = Color.parseColor("#1AD1A594")

        // Roboto Medium (500) — titles, values, labels and button text on
        // the field screens; system Roboto, not the web app's bundled fonts
        // (see `docs/ime-visual-parity-plan.md` item 7).
        private val MEDIUM: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        // The coral gradient's two stops (Save, Generate), standing in for
        // the neutral recipe's `#3f454a`/`#32373d` — lightened/darkened
        // from `CREATE_ACCENT` by the same rough proportion the neutral
        // pair's own stops sit apart. Was `#e8b49c`/`#cf8a6c` (62%/51%
        // saturation), now 40%/32%. `CREATE_ACCENT_TEXT` on the darker
        // stop is 5.25:1.
        private val CREATE_GRADIENT_TOP = Color.parseColor("#D6B0A0")
        private val CREATE_GRADIENT_BOTTOM = Color.parseColor("#BC907E")

        // The generator panel's strength bar tones — `tailwind.config.js`'s
        // `bad`/`warn` (and `ok`, which is `SUCCESS` already), exactly as the
        // web `StrengthBar` picks them by score (0-1 bad, 2 warn, 3-4 ok).
        private val STRENGTH_BAD = Color.parseColor("#e05252")
        private val STRENGTH_WARN = Color.parseColor("#f59e0b")

        // `crypto/generator.ts`'s `MIN_LENGTH`/`MAX_LENGTH` — the length
        // slider's range only; the JS side (`clampLength`) is what enforces it.
        private const val PASSWORD_MIN_LENGTH = 8
        private const val PASSWORD_MAX_LENGTH = 64

        // The saved-emails list shows about this many rows, then scrolls
        // inside itself.
        private const val EMAIL_ROW_HEIGHT_DP = 44
        private const val EMAIL_LIST_MAX_VISIBLE_ROWS = 4

        // How long the "Filled!" acknowledgement stays up before the value
        // actually commits and the keyboard hands control back — long enough
        // to register as feedback, short enough that it never feels like a
        // delay was added for its own sake.
        private const val FILL_FEEDBACK_DELAY_MS = 260L

        // How long a tapped button's "Filled!" acknowledgement stays up
        // before it reverts to its own original label — per request; matches
        // the web app's own "Copied!" flash duration (`FieldRow.tsx`,
        // `setTimeout(... , 1500)`) for a consistent feel across both. See
        // `markFilled`'s own doc for why this needed a timer of its own
        // rather than continuing to rely solely on whatever re-render
        // happens to follow a fill.
        private const val FILLED_REVERT_MS = 1500L

        // How long a revealed sensitive value stays visible before it
        // re-masks itself — same idea as the web app's `useReveal` timeout,
        // so a shoulder-surfed value doesn't stay exposed indefinitely just
        // because the user forgot to hide it again.
        private const val REVEAL_SECONDS = 10L

        // The gap between each character `commitCharByChar` sends — see its
        // own doc. Long enough that a target field's own per-keystroke
        // formatter reliably treats each one as its own edit rather than
        // folding them together; short enough that even the longest field
        // this still applies to (see `CHAR_BY_CHAR_MAX_LENGTH`) lands in
        // a bit over a second.
        private const val CHAR_BY_CHAR_COMMIT_INTERVAL_MS = 40L

        // `finishFill` only commits one character at a time up to this
        // length — past it, a long password, a Note, or an SSH key would
        // take tens of seconds to land, which reads as hung, not fast.
        // Comfortably covers virtually every real password/username/CVV/
        // expiry/date value; deliberately *below* the web app's own
        // generator's `MAX_LENGTH` (64) — a generated password at the top
        // of that range is exactly the case this cap exists to fall back
        // for.
        private const val CHAR_BY_CHAR_MAX_LENGTH = 32

        // Same convention `vault.ts` already uses to identify Login's
        // password field (`key === 'password'` there too) — see
        // `armPostFillTabAndPasswordCheck`'s own doc.
        private const val PASSWORD_FIELD_KEY = "password"

        // `openDraftPanelKey`'s value while the new-entry panel shows its
        // type list instead of its fields (`buildTypeListPanel`) — not a
        // field key, so it can't collide with one.
        private const val TYPE_PANEL_KEY = "\u0000type"

        // Primary "Fill" pills in the detail card are one fixed width, so
        // they line up in a column; wide enough for "Filled!" with its
        // check glyph.
        private const val DETAIL_FILL_WIDTH_DP = 84

        // "Looks like an email" for grab-on-return's field ordering — a
        // loose shape check, not validation.
        private val EMAIL_SHAPE = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")

        // How long Clear offers "Undo" (`onClearTapped`).
        private const val CLEAR_UNDO_MS = 5_000L

        // How long the "Saved to Vault" confirmation shows before the
        // keyboard steps away (`finishDraft`).
        private const val SAVE_CONFIRM_MS = 1_200L

        // A Login's primary detail fields, in sign-in-form order — see
        // `splitDetailFields`.
        private val LOGIN_PRIMARY_ORDER = listOf("username", "email", PASSWORD_FIELD_KEY)

        // `draftNotice` when a generated password was kept in the draft
        // instead of typed into a non-password field — see
        // `generateDraftPasswordField`.
        private const val PASSWORD_HELD_NOTICE =
            "Password generated and saved to this entry. Tap the page's password field, then Fill to type it there."

        // How long `armPostFillTabAndPasswordCheck` waits for
        // `onEditorInfoChanged` to report the field Tab landed on before
        // giving up. Generous relative to how quickly a focus change
        // actually round-trips through the target app and back to this
        // IME, so it isn't the thing that misses a real one; short enough
        // that a target that never reports back (or wasn't listening for
        // Tab at all) doesn't leave this armed against some unrelated,
        // much later focus change.
        private const val POST_FILL_TAB_TIMEOUT_MS = 1_500L

        // The IME's touch-target floor: every tappable control here has a
        // tap area at least this tall. 40dp, not the main app's 44px — an
        // IME-only exception, by direct request, so the top bar's Lock/Clear
        // pills can keep visible clearance above and below inside a compact
        // bar (see `docs/ime-ux-redesign-proposal.md`'s "Touch targets").
        // The floor is the tap area, not the drawn shape: a control may be
        // drawn smaller inside it (`insetPill`). Don't raise the bar, or
        // shrink a tap area to its drawn size, to "fix" this.
        private const val MIN_TOUCH_TARGET_DP = 40

        // Space between the top bar's edges and Lock/Clear's 40dp tap areas,
        // above and below each.
        private const val TOP_BAR_BUTTON_CLEARANCE_DP = 2

        // The top bar's fixed height: the 40dp Lock/Clear tap areas plus
        // their 2dp clearance top and bottom. Fixed rather than
        // `WRAP_CONTENT` so the pills and the centered logo (see
        // `buildTopBar`) have a known height to lay out against.
        private const val TOP_BAR_HEIGHT_DP = MIN_TOUCH_TARGET_DP + 2 * TOP_BAR_BUTTON_CLEARANCE_DP

        // How tall a compact control is *drawn* inside its 40dp tap area:
        // the top bar's Lock/Clear (6dp of bar showing above and below) and
        // the detail view's fill-format switch. See
        // `docs/IME-CONTROLS-REFINEMENT-PLAN.md` items 1 and 2.
        private const val COMPACT_PILL_HEIGHT_DP = 32

        // Lock and Clear's corner radius: a rounded rectangle, not a pill,
        // by direct request — the one exception to "every action button
        // outside the keypad is a pill" (`docs/IME-DETAIL-CREATE-VISUAL-PASS.md`
        // V1). Rounder than a key's 5dp, so they still don't read as keys.
        private const val TOP_BAR_BUTTON_RADIUS_DP = 8
        // The detail view's fill-format switch: as wide as the eye plus
        // Fill, so it lines up under them (`buildModeSwitch`).
        private const val MODE_SWITCH_WIDTH_DP = MIN_TOUCH_TARGET_DP + DETAIL_FILL_WIDTH_DP

        // The "Filling into …" label's margin from each side of the top
        // bar: Lock (~72dp wide) or Clear/Undo (~50dp) plus their 20dp
        // screen margin, with room to spare — equal both sides, so the label
        // stays centered.
        private const val TOP_BAR_CONTEXT_SIDE_DP = 100

        // 40dp — the IME's touch-target floor (`MIN_TOUCH_TARGET_DP`), down
        // from 42 to give height back to the results region
        // (`docs/IME-UX-IMPROVEMENT-PLAN.md` 3.1). Don't go below 40.
        private const val KEY_ROW_HEIGHT_DP = 40
        // 3dp margin on each side of a key = 6dp horizontal gap between
        // two adjacent keys. History: 2 → 3 → 5 → 4 → 3dp — each step
        // chased the same "text is legible again, the gap can afford to
        // give a little width back" tradeoff.
        private const val KEY_GAP_DP = 3
        // Vertical clearance between one keypad row and the next — the same
        // 6dp as the horizontal gap between two keys (2 × `KEY_GAP_DP`).
        private const val ROW_GAP_DP = 6
        // Horizontal clearance from the screen edges for the ASDFGHJKL
        // row only — it has one fewer key than the QWERTYUIOP row above
        // it, so without this it sits flush against both edges while the
        // row above and the toggle/backspace row below don't, reading as
        // misaligned rather than intentionally offset.
        private const val SECOND_ROW_INSET_DP = 18
        // The 123 layer's seven-key symbol row, inset so its keys come out
        // about as wide as the digits above them.
        private const val SYMBOL_ROW_INSET_DP = 56
        // Key labels — was 14sp, small next to a system keyboard's.
        private const val KEY_LABEL_SP = 16f
        // Backspace auto-repeat while held: first repeat after this long,
        // then one character per interval (`buildBackspaceKey`).
        private const val BACKSPACE_REPEAT_DELAY_MS = 400L
        private const val BACKSPACE_REPEAT_INTERVAL_MS = 60L

        // A result row's icon: a rounded square, both for the neutral
        // plate and for a favicon — the app's Android peg (50dp, 10px
        // radius) scaled down, so plate and favicon read as one component.
        private const val AVATAR_SIZE_DP = 32
        private const val AVATAR_RADIUS_DP = 7

        // ── One fixed height for every screen ─────────────────────────────
        // The keyboard's body (everything above the system's own bottom
        // inset) is the same height on every screen — search, detail,
        // create, locked, loading — so the host app never re-lays out its
        // page as the user moves between them (`docs/IME-UX-REVIEW.md` L4).
        // The results region takes whatever the body has left on each
        // screen (layout weight 1 in `buildRootView`), so it grows by
        // exactly what the keypad frees when it hides. The body is sized so
        // that on the search screen, where the region is smallest, it holds
        // a section label plus three `buildResultRow` rows (see
        // `SEARCH_RESULTS_HEIGHT_DP`).
        //
        // Keypad padding above and below its rows (`buildKeyboard`).
        private const val KEYPAD_PADDING_DP = 8
        // Three letter rows plus the space row, with a `ROW_GAP_DP` above
        // each row but the first.
        private const val KEYPAD_HEIGHT_DP = 2 * KEYPAD_PADDING_DP + 4 * KEY_ROW_HEIGHT_DP + 3 * ROW_GAP_DP
        // The search box row: 6dp above and below a 40dp field. 40dp, not
        // smaller: the field holds the ✕ that clears the query, whose touch
        // target is the IME's 40dp floor.
        private const val SEARCH_ROW_HEIGHT_DP = 52
        // The hairline under the search box plus its 4dp top margin.
        private const val SEARCH_DIVIDER_HEIGHT_DP = 5
        // The search screen's results region: a ~25dp section label plus
        // three 56dp-pitch result rows (52dp row + 2dp margin each side).
        private const val SEARCH_RESULTS_HEIGHT_DP = 196
        // `TOP_BAR_HEIGHT_DP` + its 1dp border, the search screen's results
        // region, search box, divider and keypad.
        private const val BODY_HEIGHT_DP =
            TOP_BAR_HEIGHT_DP + 1 + SEARCH_RESULTS_HEIGHT_DP + SEARCH_ROW_HEIGHT_DP + SEARCH_DIVIDER_HEIGHT_DP + KEYPAD_HEIGHT_DP
        // The least room kept under the body for the system's own
        // navigation controls (see `withBottomInset`). 48dp is the strip
        // Android draws its keyboard-hide and keyboard-switch buttons in.
        private const val BOTTOM_CLEARANCE_DP = 48

        // While the picker's visible, re-ask `listEntries` on this cadence
        // so an app-side timeout (vault re-locking itself) while the
        // keyboard's still open gets noticed quickly — see `startAutoRefresh`.
        private const val AUTO_REFRESH_INTERVAL_MS = 2000L

        // The search box has no real `EditText` caret (it's a plain
        // `TextView` — see `buildSearchBoxRow`), so the "field is active"
        // signal is faked: a character appended/removed from the displayed
        // string on this cadence, matching Android's own ~500ms cursor
        // blink rate. See `updateQueryDisplay`.
        private const val CURSOR_BLINK_INTERVAL_MS = 500L
        private const val CURSOR_CHAR = "▏"
    }

    private enum class KeyboardMode { LETTERS, NUMBERS }

    // LOADING is also the "not yet decided" sentinel — `render()` always
    // treats the first real answer (LOCKED or FULL) as a mode change, so the
    // very first view swap after a fresh `start()` always happens.
    private enum class ViewMode { LOADING, LOCKED, FULL }

    // Sub-state within `ViewMode.FULL` — what the results region (and,
    // along with it, which bottom keypad row) is currently showing. Unlike
    // LOCKED/FULL a change here never triggers a full view swap, just a
    // re-render of `resultsContainer` and a swap between `spaceRow`/
    // `detailActionsRow` (CREATE has no row of its own any more — see
    // `buildCreatePanel`).
    private enum class Screen { SEARCH, DETAIL, CREATE }

    private var allEntries: List<FillEntry> = emptyList()
    private val query = StringBuilder()
    private var keyboardMode = KeyboardMode.LETTERS
    private var viewMode = ViewMode.LOADING

    /** True from the moment `start()` runs until the matching `stop()` —
     * i.e. "is a real show currently up," as opposed to this object merely
     * existing. `VaultIme.onStartInputView` reads this to decide
     * whether a `restarting=true` call is a genuine first show (rare, but
     * not provably impossible, so still worth a real `start()`) or a
     * same-field restart of a show that's already up, which it isn't —
     * see that call site's doc for why the distinction matters. */
    var isActive = false
        private set

    private var screen = Screen.SEARCH
    private var selectedEntryId: String? = null
    // fieldKey -> plaintext, for sensitive fields the user has tapped
    // "Show" on. Cleared whenever the selected entry changes and self-heals
    // per field via the delayed removal `toggleReveal` schedules.
    private val revealedFields = mutableMapOf<String, String>()

    // How many of a card's Number field's 4-digit groups have been filled
    // in "4 parts" mode (see `performChunkFill`) — 0..4, where 4 means
    // fully filled (whether by Fill in "Whole" mode or by tapping through
    // every part). Reset alongside `revealedFields` whenever the selected
    // entry changes, same lifetime — and also back to 0 on its own,
    // `FILLED_REVERT_MS` after the disabled "Filled" row that 4 shows
    // first appears, so the row comes back clickable instead of staying
    // stuck (see `scheduleCardFilledRevert`).
    private var cardChunkProgress = 0

    // Whether `revertCardFilledRunnable` is currently queued on `uiHandler`
    // — the guard that keeps every re-render during the "Filled" window
    // (the 2s auto-refresh, an unrelated Show/Hide) from restarting its
    // clock. Cleared by the runnable itself, `cancelCardFilledRevert`, and
    // `stop()` (whose `removeCallbacksAndMessages` cancels the runnable
    // without touching this).
    private var cardFilledRevertScheduled = false
    private val revertCardFilledRunnable = Runnable {
        cardFilledRevertScheduled = false
        if (cardChunkProgress >= 4) {
            cardChunkProgress = 0
            if (screen == Screen.DETAIL) renderResultsArea()
        }
    }

    // Which digit order the Expiry field's "Fill" chip uses — `false` is
    // the natural `MM/YY` order the app itself stores/displays;
    // `true` swaps to `YY/MM`, for the (real, if less common) target site
    // that expects the year first. A per-visible-detail-view toggle, not
    // a persisted preference — see `performExpiryFill`. Same reset
    // lifetime as `cardChunkProgress`.
    private var expiryFormatSwapped = false

    // The card number's fill mode — `false` "Whole" (Fill types all 16
    // digits), `true` "4 parts" (each Fill types the next 4-digit group,
    // for sites with four separate boxes). Set by the mode switch under
    // Fill (`buildModeSwitch`); view state only, same reset lifetime as
    // `cardChunkProgress`.
    private var cardFillInParts = false

    // ── Streamlined account creation (docs/ACCOUNT-CREATION-DESIGN.md) ──

    // The most recently fetched draft, or `null` if none is active — kept
    // here (rather than re-fetched synchronously on every render, which
    // `EntrySource` can't do) purely so `renderResultsArea` has something
    // to draw for `Screen.CREATE` without every render needing its own
    // round trip. Refreshed by `refreshDraftAndRender` after every action
    // that can change it.
    private var currentDraft: DraftSnapshot? = null

    // Which draft field's inline panel is expanded, by `DraftFieldSnapshot.key`
    // — the password's generator panel or an email field's saved-emails
    // list — or `null` for none. One `String?`, not a flag per panel, so
    // only one can ever be open at a time (opening one replaces the other):
    // the create panel's results region is a fixed height, see
    // `BODY_HEIGHT_DP`. View state only — never persisted; cleared by
    // `closeDraftPanels` wherever a draft session ends or restarts.
    private var openDraftPanelKey: String? = null

    // The email list's contents, fetched from `entrySource.listKnownEmails`
    // each time the list is opened. `null` while that fetch is in flight
    // (the panel shows "Loading…" rather than a premature "No saved emails
    // yet").
    private var draftKnownEmails: List<String>? = null

    // The type list's contents (`entrySource.listEntryTypes`), fetched each
    // time it's opened; `null` while that's in flight.
    private var draftEntryTypes: List<EntryTypeOption>? = null

    // Keys of the draft's sensitive fields currently shown in plain text
    // (the eye on a new entry's Password row). A generated password is
    // added as it arrives, so the user sees what was made; nothing here
    // auto-hides (a draft is being edited, not viewed — see
    // `docs/IME-CONTROLS-REFINEMENT-PLAN.md` item 3). Cleared by
    // `closeDraftPanels`.
    private val revealedDraftFields = mutableSetOf<String>()

    // When each revealed sensitive value re-masks itself
    // (`SystemClock.uptimeMillis` based) — read by `buildDetailFieldRow`
    // for the "· hides in Ns" hint. Only consulted while `revealedFields`
    // holds the key, so it needs no clearing of its own.
    private val revealExpiresAt = mutableMapOf<String, Long>()

    // Set when a panel has just been opened, consumed by the next
    // `renderResultsArea` that builds it, which scrolls it into view — see
    // `revealDraftPanel`.
    private var scrollToDraftPanel = false
    private var draftPanelView: View? = null

    // True while the generator's length slider is being dragged. The 2s
    // auto-refresh rebuilds the whole results region, which would delete
    // the very `SeekBar` under the user's finger mid-drag (its
    // `onStopTrackingTouch`, the only thing that applies the change, would
    // never fire) — so the auto-refresh skips its re-render while this is set.
    private var draftSliderDragging = false

    // Read once per `onStartInputView` from `EditorInfo` via
    // `setDetectedContext` — see `VaultIme.resolveTitleGuess`'s doc —
    // and consumed the next time `startCreatingDraft` actually starts a
    // fresh draft. Not cleared between draft-less keyboard shows on the
    // same field, since the guess is still just as valid; cleared
    // implicitly by being handed to `entrySource.startDraft` and not read
    // again until the next `setDetectedContext` call.
    private var detectedTitleGuess: String = ""

    // Whether this show's focused field looked like a new-password field —
    // see `VaultIme.resolveLikelySignup`'s doc for why this is always
    // `false` in practice (no IME-visible signal for it exists). Pure
    // quiet-bias copy in `buildCreatePanel`'s subtitle; nothing here reacts
    // to it by changing behaviour or popping anything up unprompted, per
    // the design doc's "Detect, best-effort" step.
    private var likelySignupField = false

    // A brief inline note in `buildCreatePanel`: "nothing to grab" from
    // `grabIntoDraftField`, or "generated/picked, now tap Fill" when a draft
    // action held back from writing into the page (see
    // `focusedFieldIsPassword`). Cleared on the next draft action that
    // doesn't set its own, and whenever the draft flow (re)starts, so it
    // never survives into a later, unrelated draft session.
    private var draftNotice: String? = null

    // Whether the host app's currently focused field is a password field —
    // kept current by `onEditorInfoChanged` on every focus change. The
    // draft actions that write into the page on their own
    // (`generateDraftPasswordField`, `applyPasswordOptions`,
    // `pickKnownEmail`) check it first: a generated password only goes
    // into a password field, a picked email only into a non-password one.
    // Anything else would wipe the wrong field and, for a password, show it
    // in plain text — see `docs/IME-UX-REVIEW.md` P5/T3.
    private var focusedFieldIsPassword = false

    // True while `buildCreatePanel` shows its "Discard this entry?" bar in
    // place of the header — see `cancelDraftFlow`. View state only; reset
    // by `closeDraftPanels`.
    private var confirmingDraftDiscard = false

    // ── Quick-fill ranking (docs/QUICK-FILL-RANKING-DESIGN.md) ──────────

    // The focused field's calling app, read once per show from
    // `EditorInfo.packageName` — see `setDetectedContext`'s third
    // parameter and `VaultIme.onStartInputView`. Empty when no
    // `EditorInfo` was available (e.g. the preview activity, unless it
    // supplies one). `QuickFillUsage`/`QuickFillRanking` both treat an
    // empty package as "no frecency signal" rather than a real scope, so
    // this never needs its own null-check at each call site.
    private var callingPackage: String = ""

    // The calling app's display name ("Netflix", or "Chrome" in a browser)
    // and whether it's a browser — see `setDetectedContext`. Drive the
    // empty-query suggestions and their section labels
    // (`renderSearchResults`).
    private var callingAppLabel: String = ""
    private var callingAppIsBrowser = false

    // Whether the open entry's secondary fields (URL, notes, anything
    // multi-line — see `splitDetailFields`) are expanded under "More
    // fields". View state only; collapsed again whenever a different entry
    // is opened or the search session resets.
    private var moreFieldsExpanded = false

    // The field key whose Fill chip should show "Filled!" because the
    // keyboard filled it on its own — the password, after "Fill, then Tab"
    // landed on a password field (`onEditorInfoChanged`). Read by
    // `buildDetailFieldRow`; cleared `FILLED_REVERT_MS` later.
    private var autoFilledFieldKey: String? = null

    // Clear's undo: the text Clear just wiped from the host field, held for
    // `CLEAR_UNDO_MS` while the Clear pill reads "Undo" — see
    // `onClearTapped`. Memory only (it may be a password; accepted, see
    // `docs/IME-UX-IMPROVEMENT-PLAN.md` D5), dropped on timeout, on a focus
    // change, and on `stop()`.
    private var clearUndoText: String? = null
    private lateinit var clearFieldButton: TextView
    private val endClearUndoRunnable = Runnable { endClearUndo() }

    // "Grab on return": text found in the focused field when the keyboard
    // reopened mid-draft, offered for one of the draft's fields — see
    // `buildGrabOfferRow`. Memory only, and only while the offer shows (it
    // may be a password): cleared by a choice, Dismiss, the draft ending
    // (`closeDraftPanels`) and `stop()`.
    private var grabOfferText: String? = null
    private var grabOfferIsPassword = false

    // Shown in place of the create panel for a moment after Save — see
    // `finishDraft`. `null` otherwise; reset by `closeDraftPanels`.
    private var draftSavedMessage: String? = null

    // The calling app the current search session (query, selection,
    // scroll) belongs to — `null` before the first show. `start()` resets
    // that session whenever a show arrives from a different app, so one
    // app's open entry is never offered, Fill buttons live, inside another.
    private var lastSessionPackage: String? = null

    // Captured in `stop()`, restored once in `buildRootView()` — see that
    // function's own note — so reopening the keyboard on the same field
    // resumes scrolled to where the user left off, same as the search
    // text and selection do.
    private var savedScrollY: Int = 0

    // Decoded site icons for Login result rows, keyed by `siteIconKey`
    // (entry id + URL, so editing an entry's URL asks again). A `null` value
    // is a settled "no icon" — the plate shows and nothing is re-asked.
    // `siteIconRequests` holds keys with a `readIcon` call in flight, so
    // the two-second auto-refresh re-render doesn't stack duplicates. Both
    // outlive a dismiss/reopen, and both are cleared when the view goes
    // LOCKED — see `render()`.
    private val siteIcons = HashMap<String, Bitmap?>()
    private val siteIconRequests = HashSet<String>()

    private lateinit var resultsContainer: LinearLayout
    private lateinit var resultsScroll: ScrollView
    private lateinit var queryText: TextView
    private lateinit var clearQueryButton: ImageView
    // The search box row and the hairline divider just below it — hidden,
    // along with the letter keys, whenever `screen` isn't `Screen.SEARCH`;
    // see `updateBottomRowsForScreen`.
    private lateinit var searchBoxRow: View
    private lateinit var searchDivider: View
    private lateinit var keyboardContainer: LinearLayout
    private lateinit var keysArea: LinearLayout
    // The keypad's own last row (space and "+"), and the row that takes its
    // place for `Screen.DETAIL` ("Back to results") — see
    // `updateBottomRowsForScreen`; `Screen.CREATE` shows neither. Lock and
    // Clear are not on these rows: they're screen-independent, so they live
    // in `buildTopBar` (`docs/ime-ux-redesign-proposal.md`), and everything
    // left here writes into the search box or navigates this picker's own
    // screens, never into the host app's field.
    private lateinit var spaceRow: LinearLayout
    private lateinit var detailActionsRow: LinearLayout
    private lateinit var modeToggleButton: Button

    // Guards `returnToPreviousKeyboard` against firing twice for the same
    // show — once from whatever explicitly triggered it (a fill,
    // "Open Vault"), and again from the host's own teardown callback
    // when that same action causes the picker to be dismissed right after.
    private var switchedAway = false

    // Set by `armPostFillTabAndPasswordCheck` right before `onSendTab()`,
    // read and cleared by `onEditorInfoChanged` once the field Tab actually
    // landed on is known — see both functions' own docs. `null` whenever
    // nothing is currently waiting on a post-Tab check.
    private var pendingPostFillPasswordEntry: FillEntry? = null
    private val clearPendingPostFillPasswordRunnable = Runnable { pendingPostFillPasswordEntry = null }

    // Shared with `markFilled`'s post-tap delay and `toggleReveal`'s
    // auto-hide timer — a plain main-thread handler, not tied to the
    // auto-refresh loop below.
    private val uiHandler = Handler(Looper.getMainLooper())

    private val autoRefreshHandler = Handler(Looper.getMainLooper())

    // Backspace's hold-to-repeat (`buildBackspaceKey`); cleared in `stop()`
    // so a repeat can't outlive the keyboard being dismissed mid-hold.
    private val backspaceHandler = Handler(Looper.getMainLooper())
    private val autoRefreshRunnable = object : Runnable {
        override fun run() {
            entrySource.listEntries { entries ->
                allEntries = entries
                if (!draftSliderDragging) render()
            }
            autoRefreshHandler.postDelayed(this, AUTO_REFRESH_INTERVAL_MS)
        }
    }

    // Whether the faked search-box caret (see CURSOR_CHAR) is in its "on"
    // half of the blink right now. Only actually reflected in
    // `queryText` while the search field is the active one — i.e. not
    // while an entry's detail view is showing — see `updateQueryDisplay`.
    private var cursorVisible = true
    private val cursorHandler = Handler(Looper.getMainLooper())
    private val cursorBlinkRunnable = object : Runnable {
        override fun run() {
            cursorVisible = !cursorVisible
            if (::queryText.isInitialized) updateQueryDisplay()
            cursorHandler.postDelayed(this, CURSOR_BLINK_INTERVAL_MS)
        }
    }

    /** Call every time the picker is about to be shown, including the
     * first — refetched each time rather than cached, since the vault's
     * entries can have changed since this was last open, and a fresh
     * in-memory read is cheap.
     *
     * Search text, entry selection, and scroll position survive a
     * dismiss/reopen **within the same calling app** — see
     * `docs/QUICK-FILL-RANKING-DESIGN.md`'s "Session persistence": switching
     * away mid-fill (to check something, copy a value) and coming back
     * should resume exactly where the user left off. `screen` is left alone
     * too — if it was `Screen.DETAIL` on a still-valid entry, it stays there;
     * `renderResultsArea`'s own staleness guard falls back to search if that
     * entry disappeared while this was closed (relocked, deleted from
     * another device).
     *
     * A show from a **different** app (`callingPackage` changed since
     * `lastSessionPackage`) resets all of that to an empty search
     * (`resetSearchSession`) instead: resuming there would offer one app's
     * entry, Fill buttons live, inside another.
     *
     * `revealedFields` clears unconditionally — a shown sensitive value is a
     * shoulder-surf risk `REVEAL_SECONDS` already guards against within a
     * single show; there's no reason to extend that exposure across a
     * dismiss-and-reopen too.
     *
     * An in-progress account-creation draft survives either way, even
     * across apps — see `docs/ACCOUNT-CREATION-DESIGN.md`'s "Session
     * lifetime" (reading an OTP in Messages mid-signup must not end it).
     * This fetches whatever `entrySource.getDraft` currently says and forces
     * `Screen.CREATE` if it's non-null, rather than forcing the user to tap
     * "+" again — and leaves `Screen.CREATE` for search if it's null, since
     * the draft ended while this was closed (Done, or a lock finalizing it)
     * and there's nothing left to show there. */
    fun start() {
        isActive = true
        keyboardMode = KeyboardMode.LETTERS
        closeDraftPanels()
        revealedFields.clear()
        switchedAway = false
        val appChanged = lastSessionPackage != null && lastSessionPackage != callingPackage
        if (appChanged) resetSearchSession()
        lastSessionPackage = callingPackage
        // Rebuilt from scratch once the entries arrive (`viewMode` LOADING
        // forces `render()` to swap views). Until then, a same-app reopen
        // keeps showing the view it already has — the bridge answers within
        // a frame or two, and flashing a loading view in between is just
        // noise. A first show, or a show in a different app (whose old view
        // would briefly show the previous app's session), gets the loading
        // view instead. Both are `BODY_HEIGHT_DP` tall, so neither path
        // changes the keyboard's height.
        val hadView = viewMode != ViewMode.LOADING
        viewMode = ViewMode.LOADING
        if (!hadView || appChanged) onViewChanged(buildLoadingView())
        entrySource.listEntries { entries ->
            allEntries = entries
            entrySource.getDraft { draft ->
                currentDraft = draft
                if (draft != null) {
                    screen = Screen.CREATE
                    offerGrabOnReturn(draft)
                } else if (screen == Screen.CREATE) {
                    screen = Screen.SEARCH
                }
                render()
            }
        }
        startAutoRefresh()
        startCursorBlink()
    }

    /** Back to an empty search: no query, no selected entry, scrolled to the
     * top, per-entry fill state cleared — see `start()` for when. Leaves
     * `Screen.CREATE` alone; whether a draft is still active is `start()`'s
     * `getDraft` callback's call to make. */
    private fun resetSearchSession() {
        query.clear()
        selectedEntryId = null
        moreFieldsExpanded = false
        if (screen == Screen.DETAIL) screen = Screen.SEARCH
        savedScrollY = 0
        cardChunkProgress = 0
        cancelCardFilledRevert()
        cardFillInParts = false
        expiryFormatSwapped = false
    }

    /** Best-effort context for the next fresh draft `startCreatingDraft`
     * creates, plus this show's calling app for quick-fill ranking — see
     * `VaultIme.resolveTitleGuess`/`resolveLikelySignup` for where
     * `titleGuess`/`likelySignup` come from and
     * `docs/ACCOUNT-CREATION-DESIGN.md`'s "Detect, best-effort" step for
     * why neither is ever more than a quiet default. `packageName` is
     * `EditorInfo.packageName` verbatim — unlike the other two, it isn't
     * browser-filtered, since `QuickFillUsage` scopes frecency by calling
     * app regardless of what kind of app it is. Call before `start()` on
     * every `onStartInputView`, including while a draft from an earlier
     * show is already in progress — harmless then, since nothing reads
     * `detectedTitleGuess`/`likelySignupField` again until a *fresh* draft
     * starts, and `callingPackage` is read fresh on every render either
     * way. `appLabel` is the calling app's name *unfiltered* ("Chrome" in a
     * browser, unlike `titleGuess`), and `isBrowser` says whether it's one —
     * together they drive the empty-query suggestions and section labels
     * (`renderSearchResults`). */
    fun setDetectedContext(
        titleGuess: String,
        likelySignup: Boolean,
        packageName: String,
        appLabel: String,
        isBrowser: Boolean,
    ) {
        detectedTitleGuess = titleGuess
        likelySignupField = likelySignup
        callingPackage = packageName
        callingAppLabel = appLabel
        callingAppIsBrowser = isBrowser
    }

    /** Call whenever the picker stops being shown — the user dismissed the
     * keyboard, switched apps, moved to a field that doesn't want a
     * keyboard, the preview activity is being destroyed, or (via this
     * class's two remaining `returnToPreviousKeyboard()` call sites)
     * opened Vault to unlock, or tapped "Save" on the
     * account-creation panel. Filling a value, starting a draft, or
     * cancelling one no longer stops the picker on their own — see
     * `finishFill`/`startCreatingDraft`/`cancelDraftFlow`'s own docs — so
     * none of those are in this list.
     *
     * Captures the results region's current scroll position before
     * anything else, for `buildRootView` to restore on the next `start()`
     * — see `savedScrollY`'s own doc. Guarded on `resultsScroll` actually
     * having been built, since `stop()` can run before the first
     * `buildRootView()` call ever does (the keyboard was dismissed while
     * still on the loading view). */
    fun stop() {
        isActive = false
        if (::resultsScroll.isInitialized) savedScrollY = resultsScroll.scrollY
        stopAutoRefresh()
        stopCursorBlink()
        uiHandler.removeCallbacksAndMessages(null)
        backspaceHandler.removeCallbacksAndMessages(null)
        // `removeCallbacksAndMessages` above cancels the timeout Runnable if
        // it's still pending, but doesn't itself reset the field it guards
        // — same for the card "Filled" revert's own scheduled flag, so a
        // picker reopened while that state is still up re-arms it.
        pendingPostFillPasswordEntry = null
        cancelCardFilledRevert()
        endClearUndo()
        grabOfferText = null
        // A `readIcon` answer that never arrives (the webview went away
        // mid-call) would otherwise leave its key marked in flight forever.
        siteIconRequests.clear()
    }

    /** The app's own auto-lock timeout has no way to push a notice to
     * native code — see `WebViewBridge`'s doc — so while the picker's on
     * screen this just re-asks the same `listEntries` question on a timer.
     * If the vault relocks mid-session, this notices within one interval
     * and `render()` swaps the whole view over to the locked state, instead
     * of sitting there still offering to fill from a vault that's no longer
     * actually unlocked. */
    private fun startAutoRefresh() {
        autoRefreshHandler.removeCallbacks(autoRefreshRunnable)
        autoRefreshHandler.postDelayed(autoRefreshRunnable, AUTO_REFRESH_INTERVAL_MS)
    }

    private fun stopAutoRefresh() {
        autoRefreshHandler.removeCallbacks(autoRefreshRunnable)
    }

    private fun startCursorBlink() {
        cursorVisible = true
        cursorHandler.removeCallbacks(cursorBlinkRunnable)
        cursorHandler.postDelayed(cursorBlinkRunnable, CURSOR_BLINK_INTERVAL_MS)
    }

    private fun stopCursorBlink() {
        cursorHandler.removeCallbacks(cursorBlinkRunnable)
    }

    /** Shown while the first `listEntries` answer is in flight — the same
     * `BODY_HEIGHT_DP` as every other view, so the host app doesn't re-lay
     * out twice on every show (tiny loading strip, then the full keyboard). */
    fun buildLoadingView(): View {
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(BACKGROUND)
        }
        body.addView(TextView(context).apply {
            text = "Loading…"
            gravity = Gravity.CENTER
            setTextColor(MUTED_FOREGROUND)
            textSize = 14f
        })
        return withBottomInset(body)
    }

    /**
     * The single point that decides locked vs. full and swaps the whole
     * view only when that decision actually changes — search keystrokes and
     * entry selection re-render in place via `renderResultsArea` instead of
     * tearing down and rebuilding everything, but a locked-to-unlocked (or
     * the reverse) transition needs a real view swap, since the locked view
     * has no search box or keypad at all.
     */
    private fun render() {
        val next = if (allEntries.isEmpty()) ViewMode.LOCKED else ViewMode.FULL
        if (next != viewMode) {
            viewMode = next
            if (next == ViewMode.LOCKED) {
                siteIcons.clear()
                siteIconRequests.clear()
            }
            onViewChanged(if (next == ViewMode.LOCKED) buildLockedView() else buildRootView())
        } else if (next == ViewMode.FULL) {
            renderResultsArea()
        }
    }

    // ── Full (unlocked) view ───────────────────────────────────────────

    private fun buildRootView(): View {
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
        }
        // Animates the results region's height change and the keypad's
        // show/hide — the "slides"/"expands" feel from the spec, without
        // hand-rolled ValueAnimators. Inside a fixed-height body, so only
        // the region and the keypad trade space; the keyboard as a whole
        // never changes height.
        root.layoutTransition = LayoutTransition().apply {
            enableTransitionType(LayoutTransition.CHANGING)
        }

        root.addView(buildTopBar())

        // CARD here, not BACKGROUND — the results/detail region reads as a
        // panel floating above the dock's darker base, same as the
        // search-and-keypad chrome below it stays on the darker base color.
        // That layering (light panel on dark dock) is what makes the region
        // read as its own surface rather than a hole in the background.
        resultsContainer = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(CARD)
        }
        // Weight 1: the region takes whatever `BODY_HEIGHT_DP` leaves after
        // the top bar and whichever of the search box/keypad/bottom row is
        // showing for this screen — see `BODY_HEIGHT_DP`'s own doc.
        resultsScroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            setBackgroundColor(CARD)
        }
        resultsScroll.addView(resultsContainer)
        root.addView(resultsScroll)

        root.addView(buildSearchAndKeypadUnit())

        // `screen`/`selectedEntryId`/`currentDraft` are NOT reset here —
        // whoever triggered this view swap (`start()`, most often) already
        // decided what they should be, including reopening straight into
        // `Screen.CREATE` for a draft that survived an app switch. Resetting
        // them unconditionally on every LOCKED→FULL transition would throw
        // that decision away.
        renderResultsArea()
        updateBottomRowsForScreen()

        // Restores whatever `stop()` last captured into `savedScrollY` —
        // once per `buildRootView()` call, i.e. once per LOCKED→FULL
        // transition, not on every keystroke: `renderResultsArea` alone
        // (called on every keystroke/selection/action from here on) must
        // never fight the user's own active scrolling. Posted rather than
        // called directly — `resultsScroll` hasn't been laid out yet at
        // this point in `buildRootView`, so `scrollTo` would have no real
        // content extent to clamp against.
        resultsScroll.post { resultsScroll.scrollTo(0, savedScrollY) }

        return withBottomInset(root)
    }

    /**
     * The one piece of chrome shown regardless of `screen` — see
     * `render()`/`buildRootView()`, this is only ever rebuilt on a
     * LOCKED↔FULL transition, never on a search/detail/create switch. That
     * persistence is exactly why Lock and the "fix a mistake" clear-field
     * key both live here (`docs/ime-ux-redesign-proposal.md`), not on the
     * keypad's own bottom row where they used to sit: the host app's
     * focused field, and whether the vault is unlocked, don't depend on
     * which of the picker's own screens happens to be showing, so neither
     * control should disappear or move depending on it either.
     *
     * A fixed `TOP_BAR_HEIGHT_DP` (44dp), and a `FrameLayout` rather than
     * `buildTopBar`'s old `LinearLayout` — per direct request: Lock pinned
     * 20dp from the screen's left edge, Clear-field pinned to the top
     * right, and the vault logo dead center between them, none of them the
     * same width, so a weighted linear row can't center the logo exactly
     * without also constraining Lock/Clear's own widths to match. A
     * `FrameLayout` with `Gravity.START`/`CENTER`/`END` children centers
     * the logo regardless of what Lock/Clear end up sized like. The old
     * "Vault" label and the "Unlocked" text both dropped, per the
     * same request — the logo carries the app identity.
     */
    private fun buildTopBar(): View {
        val bar = FrameLayout(context).apply {
            // BACKGROUND, not CARD — this bar sits on the dock's own base
            // color, same as the search-and-keypad unit below the
            // results. Only the results/detail region above gets the
            // lighter CARD "panel" treatment.
            setBackgroundColor(BACKGROUND)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(TOP_BAR_HEIGHT_DP))
        }
        bar.addView(buildTopBarLockButton())
        bar.addView(if (callingAppLabel.isNotEmpty()) buildTopBarContext() else buildTopBarLogo())
        bar.addView(buildTopBarClearFieldButton())
        return withBottomBorder(bar)
    }

    /**
     * The control that locks the vault: a padlock glyph plus a "Lock" label
     * on the gradient pill — the same recipe as the main app's Android
     * home-header buttons (`VaultScreen.tsx`: `#3f454a` to `#32373d`, 1px
     * `#565656` border, 5px radius, soft shadow). The label says it's an
     * action; the glyph used to be icon-only and tinted `SUCCESS` as an
     * "unlocked" signal, which read as a green closed padlock — state and
     * action mixed up (`docs/IME-UX-REVIEW.md` C7). Neutral tint now; the
     * keyboard being open on the vault's entries is the "unlocked" signal.
     *
     * 20dp from the screen's left edge. A `MIN_TOUCH_TARGET_DP` (40dp) tap
     * area drawn as a `COMPACT_PILL_HEIGHT_DP` (32dp) rounded rectangle
     * (`TOP_BAR_BUTTON_RADIUS_DP`), so 6dp of bar shows above and below
     * it, mirroring Clear on the right.
     */
    private fun buildTopBarLockButton(): View {
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            contentDescription = "Lock vault"
            background = insetPill(gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, TOP_BAR_BUTTON_RADIUS_DP))
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            minimumWidth = dip(MIN_TOUCH_TARGET_DP)
            setPadding(dip(10), 0, dip(12), 0)
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP)).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                marginStart = dip(20)
                topMargin = dip(TOP_BAR_BUTTON_CLEARANCE_DP)
                bottomMargin = dip(TOP_BAR_BUTTON_CLEARANCE_DP)
            }
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_lock)
                setColorFilter(SECONDARY_FOREGROUND)
                scaleType = ImageView.ScaleType.FIT_CENTER
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                layoutParams = LinearLayout.LayoutParams(dip(18), dip(18)).apply {
                    marginEnd = dip(6)
                }
            })
            addView(TextView(context).apply {
                text = "Lock"
                textSize = 12f
                setTextColor(SECONDARY_FOREGROUND)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            })
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                lockVault()
            }
        }
    }

    /** "Filling into Netflix" — which app the keyboard is filling into, in
     * the middle of the top bar. It confirms the target before any fill (a
     * guard against a look-alike app), and says what "Recent"/"Suggested"
     * are relative to (`docs/IME-UX-REVIEW.md` P10). Replaces the wordmark
     * whenever the app's name is known (`setDetectedContext`'s `appLabel`);
     * the wordmark is the fallback. Kept clear of Lock (left) and Clear/Undo
     * (right) by equal side margins, so it stays centered, and ellipsised
     * if the name is long. The top bar is rebuilt on every show
     * (`start()` → `buildRootView`), so the name is always this show's. */
    private fun buildTopBarContext(): View {
        val label = "Filling into $callingAppLabel"
        return TextView(context).apply {
            text = SpannableString(label).apply {
                setSpan(ForegroundColorSpan(MUTED_FOREGROUND), 0, "Filling into ".length, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
                setSpan(ForegroundColorSpan(FOREGROUND), "Filling into ".length, label.length, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            textSize = 13f
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                gravity = Gravity.CENTER
                marginStart = dip(TOP_BAR_CONTEXT_SIDE_DP)
                marginEnd = dip(TOP_BAR_CONTEXT_SIDE_DP)
            }
        }
    }

    /**
     * The Home screen wordmark (keyhole plus "Vault" lettering), centered in
     * the top bar when the calling app's name isn't known (otherwise
     * `buildTopBarContext`'s "Filling into …" takes its place), and in the
     * locked view's bar — the same logo, at the same 101 by 42dp size, the main
     * app's Android home header centers between its own Lock and Settings
     * buttons (`HomeScreenLogo` in `VaultScreen.tsx`, `h-[42px]`).
     * `R.drawable.ic_home_logo` is that artwork transcribed 1:1; it replaced
     * the keyhole-on-navy-plate `ic_vault_logo` (the login screen's mark)
     * this slot used to show at 24dp. Purely decorative, unlike the buttons
     * either side of it, so no click handler. 42dp inside a 44dp bar is
     * fine: the artwork has its own transparent margin, the visible
     * lettering is only ~18dp tall.
     */
    private fun buildTopBarLogo(): View {
        return ImageView(context).apply {
            setImageResource(R.drawable.ic_home_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = FrameLayout.LayoutParams(dip(101), dip(42)).apply {
                gravity = Gravity.CENTER
            }
        }
    }

    /**
     * The "fix a mistake" control — wipes whatever's in the *host app's*
     * currently focused field (`onClearField`; see the class doc). Top
     * right, a text "Clear" label on the same 32dp gradient rounded
     * rectangle as Lock (in a 40dp tap area), 20dp from the screen's right edge (mirroring
     * Lock's 20dp on the left, for a balanced frame around the centered
     * logo). `minWidth` (40dp) guarantees the floor for a `WRAP_CONTENT`
     * label. For
     * `CLEAR_UNDO_MS` after a clear it reads "Undo" — see `onClearTapped`.
     */
    private fun buildTopBarClearFieldButton(): View {
        clearFieldButton = TextView(context).apply {
            text = "Clear"
            textSize = 12f
            setTextColor(SECONDARY_FOREGROUND)
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = insetPill(gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, TOP_BAR_BUTTON_RADIUS_DP))
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(12), 0, dip(12), 0)
            minWidth = dip(MIN_TOUCH_TARGET_DP)
            minimumWidth = dip(MIN_TOUCH_TARGET_DP)
            contentDescription = "Clear field"
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP)).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                marginEnd = dip(20)
                topMargin = dip(TOP_BAR_BUTTON_CLEARANCE_DP)
                bottomMargin = dip(TOP_BAR_BUTTON_CLEARANCE_DP)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClearTapped()
            }
        }
        if (clearUndoText != null) showClearAsUndo()
        return clearFieldButton
    }

    /** Clear, or — within `CLEAR_UNDO_MS` of one — Undo. Clear reads the
     * field's whole text first (`onReadField`), wipes it, and, if there was
     * anything, turns into "Undo" for a few seconds; Undo types that text
     * back and turns back into "Clear". One tap used to erase a field with
     * no way back (`docs/IME-UX-REVIEW.md` C6). */
    private fun onClearTapped() {
        val pending = clearUndoText
        if (pending != null) {
            onCommitText(pending)
            endClearUndo()
            return
        }
        val existing = onReadField()?.takeIf { it.isNotEmpty() }
        onClearField()
        if (existing == null) return
        clearUndoText = existing
        showClearAsUndo()
        uiHandler.removeCallbacks(endClearUndoRunnable)
        uiHandler.postDelayed(endClearUndoRunnable, CLEAR_UNDO_MS)
    }

    private fun showClearAsUndo() {
        clearFieldButton.text = "Undo"
        clearFieldButton.contentDescription = "Undo clear"
    }

    /** Drops the held text and turns "Undo" back into "Clear". */
    private fun endClearUndo() {
        clearUndoText = null
        uiHandler.removeCallbacks(endClearUndoRunnable)
        if (::clearFieldButton.isInitialized) {
            clearFieldButton.text = "Clear"
            clearFieldButton.contentDescription = "Clear field"
        }
    }

    /** The search box and the keypad, wrapped as one visually distinct
     * block (shared background, a pill-shaped search field, and a divider
     * between the box and the first key row) — the "one unit" from the
     * spec. */
    private fun buildSearchAndKeypadUnit(): LinearLayout {
        val unit = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            // BACKGROUND, not CARD — see buildTopBar's note. The search box
            // itself gets its own pill-shaped surface below, rather than the
            // whole unit reading as one flat panel.
            setBackgroundColor(BACKGROUND)
        }
        searchBoxRow = buildSearchBoxRow()
        unit.addView(searchBoxRow)

        // Inset on both sides rather than edge-to-edge, and a little
        // clearance above it — reads as a deliberate seam between the
        // search box and the keys, not just wherever the box happened to
        // end.
        searchDivider = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(1)).apply {
                marginStart = dip(14)
                marginEnd = dip(14)
                topMargin = dip(4)
            }
            setBackgroundColor(BORDER)
        }
        unit.addView(searchDivider)

        keyboardContainer = buildKeyboard()
        unit.addView(keyboardContainer)

        return unit
    }

    /** No icon, no corner label — just the query text (or the "Search
     * vault" placeholder). Tapping it while an entry is selected returns to
     * search (brings the keypad back, clears the selection); while already
     * searching it does nothing, same as tapping any other inert text. */
    private fun buildSearchBoxRow(): View {
        // Fixed height (part of `BODY_HEIGHT_DP`'s arithmetic): 6dp above
        // and below a 40dp field.
        val outer = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(14), dip(6), dip(14), dip(6))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(SEARCH_ROW_HEIGHT_DP))
        }

        // The pill is what actually reads as "a text field" — the outer row
        // is just there to inset it from the unit's edges and give it a
        // tap target slightly larger than the pill itself.
        val pill = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            // 10px radius, matching `EntryList.tsx`'s own search field —
            // was a 20dp near-full pill, the old reference's own shape, not
            // the real app's (visual-parity pass).
            background = filledStrokedRoundedRect(CARD, BORDER, 1, 10)
            setPadding(dip(16), 0, dip(4), 0)
            setOnClickListener { returnToSearch() }
        }

        queryText = TextView(context).apply {
            textSize = 16f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.START
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        pill.addView(queryText)

        // Clears the whole query in one tap — shown only while there is one
        // (`updateQueryDisplay`). A 40dp-square touch target filling the 40dp
        // field's height, the glyph itself 18dp.
        clearQueryButton = ImageView(context).apply {
            setImageResource(R.drawable.ic_close)
            setColorFilter(MUTED_FOREGROUND)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dip(11), dip(11), dip(11), dip(11))
            isClickable = true
            isFocusable = true
            contentDescription = "Clear search"
            layoutParams = LinearLayout.LayoutParams(dip(MIN_TOUCH_TARGET_DP), dip(MIN_TOUCH_TARGET_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                query.clear()
                onQueryChanged()
            }
        }
        pill.addView(clearQueryButton)

        // MATCH_PARENT — the pill fills the whole row; "Add entry" is the
        // "+" key on `spaceRow`, not a button beside the search box.
        outer.addView(pill, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        updateQueryDisplay()
        return outer
    }

    /** Renders the search box's current text (or placeholder), plus a
     * blinking caret — see `cursorBlinkRunnable` — but only while the
     * search field is actually the active one, i.e. not while an entry's
     * detail view has taken over the results region and hidden the
     * letter keys. `queryText` is a plain `TextView`, not an `EditText`,
     * so there's no real caret to show or hide; this fakes one with
     * `CURSOR_CHAR`.
     *
     * `CURSOR_CHAR` is always part of the string — every blink only
     * toggles its *color* between the text's own color and fully
     * transparent, via a span, rather than adding/removing the character
     * from the string. A transparent character still reserves its own
     * width, so the surrounding text never reflows on every blink the way
     * it did when the character was spliced in and out.
     */
    private fun updateQueryDisplay() {
        clearQueryButton.visibility = if (query.isNotEmpty()) View.VISIBLE else View.GONE
        val cursorColor = if (screen == Screen.SEARCH && cursorVisible) FOREGROUND else Color.TRANSPARENT
        if (query.isEmpty()) {
            val full = "$CURSOR_CHAR Search vault"
            val spanned = SpannableString(full)
            spanned.setSpan(ForegroundColorSpan(cursorColor), 0, CURSOR_CHAR.length, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
            spanned.setSpan(ForegroundColorSpan(PLACEHOLDER), CURSOR_CHAR.length, full.length, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
            queryText.text = spanned
        } else {
            val full = "$query$CURSOR_CHAR"
            val queryLength = query.length
            val spanned = SpannableString(full)
            spanned.setSpan(ForegroundColorSpan(FOREGROUND), 0, queryLength, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
            spanned.setSpan(ForegroundColorSpan(cursorColor), queryLength, full.length, SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE)
            queryText.text = spanned
        }
    }

    private fun onQueryChanged() {
        updateQueryDisplay()
        renderResultsArea()
    }

    /** Leaves `Screen.DETAIL`, if that's what's showing — a no-op
     * otherwise. Shared by the search box tap and the detail view's own
     * header tap. */
    private fun returnToSearch() {
        if (screen != Screen.DETAIL) return
        selectedEntryId = null
        revealedFields.clear()
        screen = Screen.SEARCH
        updateBottomRowsForScreen()
        updateQueryDisplay()
        renderResultsArea()
    }

    /**
     * Rebuilds whatever the results region is currently showing — an empty
     * search box's "Recent" list (or nothing, if this app has no fill
     * history yet), up to ~2.5 rows of ranked matches, a "no matches"
     * message, one entry's full field list, or the account-creation panel
     * — and sets the region's height to match. This is the one function
     * every keystroke, entry tap, and creation-panel action funnels
     * through, so none of those states can drift apart from each other.
     *
     * Every `Screen.SEARCH` sub-state (empty query, matches, no matches)
     * sets the SAME height — deliberately, so a keystroke only ever swaps
     * the region's *content*, never its size. `Screen.DETAIL`/
     * `Screen.CREATE` are the only two cases that set a different height,
     * and they're the two cases allowed to: see the class doc for why a
     * typing-triggered resize would drag the keypad around under the
     * user's fingers — neither of those two screens has letter keys
     * showing for that to matter.
     *
     * Self-heals a selection that's gone stale first — if `selectedEntryId`
     * points at an entry that dropped out of a refreshed `allEntries` (the
     * vault relocked, or the entry was deleted from another device
     * mid-sync) this falls back to the search view instead of rendering an
     * empty detail region with no explanation. This is also what makes
     * `start()` leaving a stale `Screen.DETAIL` in place across a
     * dismiss/reopen safe — see its own doc.
     */
    private fun renderResultsArea() {
        if (screen == Screen.DETAIL && allEntries.none { it.id == selectedEntryId }) {
            screen = Screen.SEARCH
            selectedEntryId = null
            revealedFields.clear()
            updateBottomRowsForScreen()
            if (::queryText.isInitialized) updateQueryDisplay()
        }

        resultsContainer.removeAllViews()

        when (screen) {
            Screen.CREATE -> {
                draftPanelView = null
                resultsContainer.addView(buildCreatePanel(currentDraft))
                val panel = draftPanelView
                if (scrollToDraftPanel && panel != null) {
                    scrollToDraftPanel = false
                    resultsScroll.post { panel.requestRectangleOnScreen(Rect(0, 0, panel.width, panel.height)) }
                }
            }
            Screen.DETAIL -> {
                val entry = allEntries.first { it.id == selectedEntryId }
                resultsContainer.addView(buildDetailView(entry))
            }
            Screen.SEARCH -> renderSearchResults()
        }
    }

    /**
     * `Screen.SEARCH`'s content. An empty query shows, in order:
     * - **Recent** — entries already filled from this app
     *   (`QuickFillRanking.recents`). In a browser every site shares the
     *   browser's one package name, so the label says "Recent in Chrome"
     *   rather than implying the entries match this site.
     * - **Suggested for Netflix** — entries matching the calling app's name
     *   (`QuickFillRanking.suggestions`), not already listed. Native apps
     *   only; a browser's name says nothing about the site.
     * - Neither: a one-line hint, instead of a blank panel.
     *
     * A typed query shows ranked matches, or "No matches for 'x'" plus a
     * button that starts a new Login titled after the query.
     */
    private fun renderSearchResults() {
        if (query.isEmpty()) {
            val recents = QuickFillRanking.recents(context, callingPackage, allEntries)
            if (recents.isNotEmpty()) {
                val label = if (callingAppIsBrowser && callingAppLabel.isNotEmpty()) "Recent in $callingAppLabel" else "Recent"
                resultsContainer.addView(buildSectionLabel(label))
                for (entry in recents) resultsContainer.addView(buildResultRow(entry))
            }
            val suggestions = if (callingAppIsBrowser) {
                emptyList()
            } else {
                val shown = recents.map { it.id }.toSet()
                QuickFillRanking.suggestions(context, callingPackage, callingAppLabel, allEntries).filter { it.id !in shown }
            }
            if (suggestions.isNotEmpty()) {
                val label = if (callingAppLabel.isNotEmpty()) "Suggested for $callingAppLabel" else "Suggested"
                resultsContainer.addView(buildSectionLabel(label))
                for (entry in suggestions) resultsContainer.addView(buildResultRow(entry))
            }
            if (recents.isEmpty() && suggestions.isEmpty()) {
                resultsContainer.addView(buildMessageRow("Type to search your vault"))
            }
            return
        }
        val ranked = QuickFillRanking.rank(context, callingPackage, query.toString(), allEntries)
        if (ranked.isNotEmpty()) {
            for (entry in ranked) resultsContainer.addView(buildResultRow(entry))
            return
        }
        val typed = query.toString().trim()
        resultsContainer.addView(buildMessageRow("No matches for \u2018$typed\u2019"))
        val title = typed.replaceFirstChar { it.uppercase() }
        resultsContainer.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(smallActionButton("Save new login for \u2018$typed\u2019") { _ ->
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                startCreatingDraft(titleGuess = title)
            })
        })
    }

    /** A small muted heading above the empty-query "Recent" list — the only
     * place search results need one, since a typed query's results are
     * self-explanatory. */
    private fun buildSectionLabel(text: String): View {
        return TextView(context).apply {
            this.text = text
            setTextColor(MUTED_FOREGROUND)
            textSize = 11f
            setPadding(dip(16), dip(8), dip(16), dip(2))
        }
    }

    private fun buildMessageRow(message: String): View {
        return TextView(context).apply {
            text = message
            gravity = Gravity.CENTER
            setTextColor(MUTED_FOREGROUND)
            textSize = 14f
            setPadding(dip(16), dip(16), dip(16), dip(16))
        }
    }

    /** One search result: the entry's icon, its title with a one-line
     * subtitle under it (`rowSubtitle` — the username for a Login), and,
     * for a Login that has both a username/email and a password, a one-tap
     * **Fill** chip (`performLoginRowFill`). Tapping anywhere else opens the
     * entry's detail view. About 52dp tall (8dp padding around a 36dp
     * title/subtitle block) with 2dp margins, so the search screen's
     * results region holds a section label plus three rows — see
     * `SEARCH_RESULTS_HEIGHT_DP`. Used for recents, suggestions and matches
     * alike. */
    private fun buildResultRow(entry: FillEntry): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            // Flat `CARD`, no gradient — a search result is this file's
            // equivalent of the web app's own entry shelf/row, which the
            // design language deliberately keeps flat (no gradients except
            // the button recipe). 10px radius, matching `EntrySiteIcon`'s
            // own box.
            background = filledRoundedRect(CARD, 10)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dip(12)
                rightMargin = dip(12)
                topMargin = dip(2)
                bottomMargin = dip(2)
            }
            setPadding(dip(12), dip(8), dip(12), dip(8))
        }

        row.addView(buildAvatar(entry))

        val text = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        text.addView(TextView(context).apply {
            this.text = entry.title.ifEmpty { "Untitled" }
            setTextColor(FOREGROUND)
            textSize = 15f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        })
        val subtitle = rowSubtitle(entry)
        if (subtitle.isNotEmpty()) {
            text.addView(TextView(context).apply {
                this.text = subtitle
                setTextColor(MUTED_FOREGROUND)
                textSize = 12f
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
        }
        row.addView(text)

        if (loginRowFillFields(entry) != null) {
            row.addView(smallActionButton("Fill", heightDp = MIN_TOUCH_TARGET_DP) { button ->
                performLoginRowFill(entry, button)
            })
        }

        row.setOnClickListener { openEntryDetail(entry) }
        return row
    }

    /** Opens `entry`'s detail view with fresh per-entry state. */
    private fun openEntryDetail(entry: FillEntry) {
        selectedEntryId = entry.id
        screen = Screen.DETAIL
        revealedFields.clear()
        cardChunkProgress = 0
        cancelCardFilledRevert()
        cardFillInParts = false
        expiryFormatSwapped = false
        moreFieldsExpanded = false
        updateBottomRowsForScreen()
        updateQueryDisplay()
        renderResultsArea()
    }

    /** The line under a result row's title — a port of `EntryList.tsx`'s
     * `rowSubtitle`, so the IME tells two accounts on one site apart the way
     * the app does: a Login's username (else its email); any other type's
     * first non-sensitive, single-line, non-empty value. Date-shaped fields
     * are skipped here, unlike the app: the bridge sends them as bare fill
     * digits ("1128"), which read as noise in a subtitle. Empty when there's
     * nothing suitable — the row then shows just its title. */
    private fun rowSubtitle(entry: FillEntry): String {
        fun valueOf(key: String) = entry.fields.firstOrNull { it.key == key }?.value?.trim().orEmpty()
        if (entry.type == "login") return valueOf("username").ifEmpty { valueOf("email") }
        return entry.fields.firstOrNull {
            !it.sensitive && it.dataType != "multiline" && it.dataType != "monthYear" &&
                it.dataType != "date" && it.value.isNotBlank()
        }?.value?.trim().orEmpty()
    }

    /** A Login's (username-or-email, password) pair, when a result row can
     * offer one-tap Fill for it; `null` otherwise. */
    private fun loginRowFillFields(entry: FillEntry): Pair<FillField, FillField>? {
        if (entry.type != "login") return null
        val password = entry.fields.firstOrNull { it.key == PASSWORD_FIELD_KEY && it.fillable } ?: return null
        val user = listOf("username", "email").firstNotNullOfOrNull { key ->
            entry.fields.firstOrNull { it.key == key && it.fillable && it.value.isNotEmpty() }
        } ?: return null
        return user to password
    }

    /** A result row's one-tap Fill: the password if the focused field is a
     * password field, otherwise the username (or email) — whose ordinary
     * "Fill, then Tab" chain then fills the password once focus lands on
     * the password field (`armPostFillTabAndPasswordCheck`). Stays on the
     * search screen. */
    private fun performLoginRowFill(entry: FillEntry, button: Button) {
        val (user, password) = loginRowFillFields(entry) ?: return
        performFill(entry, if (focusedFieldIsPassword) password else user, button)
    }

    // The app's neutral peg plate (`EntryList.tsx`'s `PEG_FILL`/
    // `pegForeground`, `docs/vault-visual-language-spec.md` §4.2): a faint
    // white wash, the same for every entry, and Home's `#d6e4ef` glyph at
    // 75%. No per-entry colour — the old eight-hue hashed palette read as far
    // too strong; don't bring it back. The glyph's 75% is `imageAlpha`, not
    // an alpha colour filter — `setColorFilter` would blend a translucent
    // tint with the drawable's own placeholder colour.
    private val PEG_FILL = Color.argb(18, 255, 255, 255)
    private val PEG_FOREGROUND = Color.rgb(0xd6, 0xe4, 0xef)
    private val PEG_FOREGROUND_ALPHA = 191

    /** A result row's icon — the same one the app's own `EntrySiteIcon`
     * (`EntryList.tsx`) shows for that entry: a Login's site favicon when
     * one is available, otherwise the neutral plate (see `PEG_FILL`)
     * carrying the entry type's glyph (the globe for a Login).
     *
     * The IME never touches the network: the favicon comes over the bridge
     * (`EntrySource.readIcon` → `store.tsx`'s `readIcon`), fetched and
     * cached by the app through the same path its entry list uses, and
     * only while the app's "site icons" setting is on. A row with no icon
     * yet renders its plate and asks; a `Pending` answer is simply re-asked
     * on the next auto-refresh re-render, and a `Ready` one swaps into the
     * plate in place if the row is still on screen. See
     * `docs/MANUAL-FILL-DESIGN.md`'s "Result-row icons". */
    private fun buildAvatar(entry: FillEntry): View {
        val isLogin = entry.type == "login"
        val url = if (isLogin) entry.fields.firstOrNull { it.key == "url" }?.value?.trim().orEmpty() else ""
        val key = siteIconKey(entry.id, url)
        val avatar = FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(dip(AVATAR_SIZE_DP), dip(AVATAR_SIZE_DP)).apply {
                marginEnd = dip(12)
            }
        }
        val cached = if (url.isEmpty()) null else siteIcons[key]
        if (cached != null) {
            showSiteIcon(avatar, cached)
            return avatar
        }
        avatar.background = filledRoundedRect(PEG_FILL, AVATAR_RADIUS_DP)
        avatar.addView(ImageView(context).apply {
            setImageResource(entryTypeIconRes(entry.type))
            setColorFilter(PEG_FOREGROUND)
            imageAlpha = PEG_FOREGROUND_ALPHA
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = FrameLayout.LayoutParams(dip(18), dip(18)).apply {
                gravity = Gravity.CENTER
            }
        })
        if (url.isNotEmpty() && !siteIcons.containsKey(key)) requestSiteIcon(entry.id, key, avatar)
        return avatar
    }

    private fun siteIconKey(entryId: String, url: String): String = "$entryId\u0000$url"

    private fun requestSiteIcon(entryId: String, key: String, avatar: FrameLayout) {
        if (!siteIconRequests.add(key)) return
        entrySource.readIcon(entryId) { result ->
            siteIconRequests.remove(key)
            when (result) {
                is SiteIconResult.Pending -> Unit
                is SiteIconResult.None -> siteIcons[key] = null
                is SiteIconResult.Ready -> {
                    val bitmap = decodeSiteIcon(result.dataBase64)
                    siteIcons[key] = bitmap
                    if (bitmap != null && avatar.isAttachedToWindow) showSiteIcon(avatar, bitmap)
                }
            }
        }
    }

    /** `null` for anything `BitmapFactory` can't read — an SVG favicon, a
     * truncated download — which then settles to the plate, the same way
     * `EntrySiteIcon`'s `onError` falls back on the app side. */
    private fun decodeSiteIcon(dataBase64: String): Bitmap? {
        return try {
            val bytes = Base64.decode(dataBase64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** Replaces `avatar`'s plate with the favicon itself: no plate
     * behind it, fit inside the same `AVATAR_SIZE_DP` rounded square the
     * plate uses — the IME-sized equivalent of `EntrySiteIcon`'s `<img>`
     * (Android's 50px box with a 10px radius). */
    private fun showSiteIcon(avatar: FrameLayout, bitmap: Bitmap) {
        avatar.removeAllViews()
        avatar.background = null
        avatar.addView(ImageView(context).apply {
            setImageBitmap(bitmap)
            scaleType = ImageView.ScaleType.FIT_CENTER
            background = filledRoundedRect(Color.TRANSPARENT, AVATAR_RADIUS_DP)
            clipToOutline = true
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        })
    }

    /** `entryTypes.ts`'s `icon` for each type id, resolved to its
     * transcribed drawable — the same table as `entryTypeIcons.tsx`'s
     * `ENTRY_TYPE_ICONS`, including its globe fallback for Login and for
     * any type id this side doesn't know. */
    private fun entryTypeIconRes(type: String): Int = when (type) {
        "card" -> R.drawable.ic_type_card
        "bank" -> R.drawable.ic_type_bank
        "identity" -> R.drawable.ic_type_identity
        "phone" -> R.drawable.ic_type_phone
        "address" -> R.drawable.ic_type_address
        "wifi" -> R.drawable.ic_type_wifi
        "licenseKey" -> R.drawable.ic_type_license_key
        "sshKey" -> R.drawable.ic_type_ssh_key
        "backupCodes" -> R.drawable.ic_type_backup_codes
        "securityQa" -> R.drawable.ic_type_security_qa
        "loyalty" -> R.drawable.ic_type_loyalty
        "vehicle" -> R.drawable.ic_type_vehicle
        "insurance" -> R.drawable.ic_type_insurance
        "secureNote" -> R.drawable.ic_type_secure_note
        else -> R.drawable.ic_globe
    }

    // ── Account-creation panel ──────────────────────────────────────────
    // See `docs/ACCOUNT-CREATION-DESIGN.md` for behavior and
    // `docs/IME-DETAIL-CREATE-VISUAL-PASS.md` for the layout: the same shape
    // as `buildDetailView` below (a header, then the fields in one card),
    // in the warm palette the app's own entry-creation screens use.

    /** The new-entry panel, top to bottom:
     * - the header (`buildCreateHeader`: Cancel ✕ · title and type · Save),
     *   or the discard confirmation in its place;
     * - a one-line helper with "Switch keyboard";
     * - callouts, when there's something to say (`buildGrabOfferRow`,
     *   `draftNotice`);
     * - the fields in one warm card (`buildDraftFieldRow`), or the type
     *   list in its place (`buildTypeListPanel`).
     *
     * After Save, the whole panel is replaced by `buildSavedConfirmation`.
     * The fields are whatever the *current draft type* has — `draft.fields`,
     * in registry order — never a hardcoded Login list (a flat
     * `draft.username`/`.password` shape silently shows no fields for every
     * other type). `draft` is `null` only for the one render between
     * `startCreatingDraft` and its `getDraft` answer. */
    private fun buildCreatePanel(draft: DraftSnapshot?): View {
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(CREATE_BG)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setPadding(0, 0, 0, dip(12))
        }

        draftSavedMessage?.let { message ->
            container.addView(buildSavedConfirmation(message))
            return container
        }

        container.addView(if (confirmingDraftDiscard) buildDiscardConfirmBar() else buildCreateHeader(draft))
        container.addView(buildCreateHelperLine())

        buildGrabOfferRow(draft)?.let { container.addView(buildCallout(it)) }
        draftNotice?.let { message ->
            container.addView(buildCallout(TextView(context).apply {
                text = message
                setTextColor(CREATE_FG)
                textSize = 13f
            }))
        }

        if (draft == null) return container
        if (openDraftPanelKey == TYPE_PANEL_KEY) {
            val panel = buildTypeListPanel(draft)
            draftPanelView = panel
            container.addView(panel)
            return container
        }
        val card = fieldCard(CREATE_CARD)
        draft.fields.forEachIndexed { index, field ->
            if (index > 0) card.addView(cardDivider(CREATE_BORDER))
            card.addView(buildDraftFieldRow(field, draft))
        }
        container.addView(card)
        return container
    }

    /** Cancel ✕ on the left, apart from Save — the app's own editor's
     * order, and it keeps the destructive control away from the confirm.
     * The title block shows the guessed title and, under it, the entry
     * type ("Login ⌄") — tapping the block opens the type list. Save is the
     * panel's one filled coral button. */
    private fun buildCreateHeader(draft: DraftSnapshot?): View {
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(4), dip(8), dip(12), dip(4))
        }
        header.addView(iconButton(R.drawable.ic_close, CREATE_LABEL, "Cancel") { cancelDraftFlow() })

        val titleBlock = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            minimumHeight = dip(MIN_TOUCH_TARGET_DP)
            setPadding(dip(4), 0, dip(8), 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            contentDescription = "Entry type: ${draft?.typeLabel ?: "Login"}. Change type"
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                toggleTypeList()
            }
        }
        titleBlock.addView(TextView(context).apply {
            text = draft?.title?.ifEmpty { "New entry" } ?: "New entry"
            setTextColor(CREATE_FG)
            textSize = 16f
            typeface = MEDIUM
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        titleBlock.addView(TextView(context).apply {
            text = draft?.typeLabel ?: "Login"
            setTextColor(CREATE_ACCENT)
            textSize = 12f
            compoundDrawablePadding = dip(2)
            setCompoundDrawablesRelative(null, null, tintedIcon(R.drawable.ic_chevron_down, CREATE_ACCENT, 14), null)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        header.addView(titleBlock)

        header.addView(createPillButton("Save") { _ -> finishDraft() }.apply {
            (layoutParams as LinearLayout.LayoutParams).marginEnd = 0
        })
        return header
    }

    /** One line of guidance plus "Switch keyboard": this screen hides the
     * keypad, and typing a username or email into the page means using the
     * regular keyboard — the one step of signing up this keyboard can't do
     * itself (`docs/IME-UX-REVIEW.md` P7). The draft survives the switch,
     * and coming back offers what was typed (`offerGrabOnReturn`). */
    private fun buildCreateHelperLine(): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(16), 0, dip(4), dip(4))
        }
        row.addView(TextView(context).apply {
            text = if (likelySignupField) "Looks like a sign-up form. Type the rest with your usual keyboard." else "Type the rest with your usual keyboard."
            setTextColor(CREATE_LABEL)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        row.addView(textButton("Switch keyboard", CREATE_ACCENT, iconRes = R.drawable.ic_keyboard) { _ -> returnToPreviousKeyboard() })
        return row
    }

    /** Stands in for the header while `confirmingDraftDiscard` is set — see
     * `cancelDraftFlow`. "Keep editing" (outline) and "Discard" (danger
     * outline): the destructive choice is never the visually prominent one. */
    private fun buildDiscardConfirmBar(): View {
        val bar = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dip(16), dip(12), dip(16), dip(8))
        }
        bar.addView(TextView(context).apply {
            text = "Discard this entry? Anything already typed into the page won't be saved in Vault."
            setTextColor(CREATE_FG)
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(10)
            }
        })
        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        actions.addView(createOutlineButton("Keep editing") {
            confirmingDraftDiscard = false
            renderResultsArea()
        }.apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = dip(8) })
        actions.addView(createOutlineButton("Discard", color = DANGER) { discardDraft() })
        bar.addView(actions)
        return bar
    }

    /** Replaces the panel for `SAVE_CONFIRM_MS` after Save — see
     * `finishDraft`: a check in a coral ring, then what happened. */
    private fun buildSavedConfirmation(message: String): View {
        val box = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dip(24), dip(48), dip(24), dip(24))
        }
        box.addView(FrameLayout(context).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setStroke(dip(2), CREATE_ACCENT)
            }
            layoutParams = LinearLayout.LayoutParams(dip(44), dip(44)).apply { bottomMargin = dip(16) }
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_check)
                setColorFilter(CREATE_ACCENT)
                layoutParams = FrameLayout.LayoutParams(dip(24), dip(24)).apply { gravity = Gravity.CENTER }
            })
        })
        box.addView(TextView(context).apply {
            text = message
            setTextColor(CREATE_FG)
            textSize = 16f
            gravity = Gravity.CENTER
        })
        return box
    }

    /** A tinted strip with a 3dp accent bar on the left — how the panel
     * says something (the grab-on-return offer, "saved to this entry, tap
     * Fill", "nothing to grab"), instead of yet another bordered row. Square
     * corners: a one-sided accent bar and rounded corners don't mix. */
    private fun buildCallout(content: View): View {
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(CREATE_CALLOUT)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dip(12)
                rightMargin = dip(12)
                bottomMargin = dip(8)
            }
            addView(View(context).apply {
                setBackgroundColor(CREATE_ACCENT)
                layoutParams = LinearLayout.LayoutParams(dip(3), ViewGroup.LayoutParams.MATCH_PARENT)
            })
            addView(content.apply {
                setPadding(dip(12), dip(10), dip(12), dip(10))
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
        }
    }

    /** The create panel's secondary button: an outline pill, 40dp tall —
     * coral by default, `DANGER` for "Discard". Used for Grab, Pick, Keep
     * editing, and the grab-on-return offer's field choices. */
    private fun createOutlineButton(label: String, color: Int = CREATE_ACCENT, onClick: () -> Unit): TextView {
        return TextView(context).apply {
            text = label
            setTextColor(color)
            textSize = 13f
            typeface = MEDIUM
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = strokedRoundedRect(color, 1.5f, MIN_TOUCH_TARGET_DP / 2)
            setPadding(dip(14), 0, dip(14), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /** A tertiary action: text only (optionally with a leading 16dp icon),
     * 40dp tall — "Fill" on a new-entry row, "Switch keyboard", "Dismiss",
     * "Regenerate". A `Button` so `markFilled` can flash it. */
    private fun textButton(label: String, color: Int, iconRes: Int? = null, onClick: (Button) -> Unit): Button {
        return Button(context).apply {
            text = label
            isAllCaps = false
            textSize = 13f
            typeface = MEDIUM
            setTextColor(color)
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            background = null
            stateListAnimator = null
            if (iconRes != null) {
                setCompoundDrawablesRelative(tintedIcon(iconRes, color, 16), null, null, null)
                compoundDrawablePadding = dip(6)
            }
            setPadding(dip(10), 0, dip(10), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick(this)
            }
        }
    }

    /** A 40×40 icon-only button with no background (Cancel ✕, show/hide). */
    private fun iconButton(iconRes: Int, tint: Int, description: String, onClick: () -> Unit): ImageView {
        return ImageView(context).apply {
            setImageResource(iconRes)
            setColorFilter(tint)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setPadding(dip(10), dip(10), dip(10), dip(10))
            contentDescription = description
            isClickable = true
            isFocusable = true
            layoutParams = LinearLayout.LayoutParams(dip(MIN_TOUCH_TARGET_DP), dip(MIN_TOUCH_TARGET_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /** A drawable tinted `color`, sized `sizeDp` square, for a compound
     * drawable next to a label. */
    private fun tintedIcon(iconRes: Int, color: Int, sizeDp: Int) =
        context.getDrawable(iconRes)?.mutate()?.apply {
            setTint(color)
            setBounds(0, 0, dip(sizeDp), dip(sizeDp))
        }

    /** The rounded card both field screens group their rows in. */
    private fun fieldCard(color: Int): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = filledRoundedRect(color, 10)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dip(12)
                rightMargin = dip(12)
                topMargin = dip(4)
            }
        }
    }

    /** A 1dp divider between card rows, inset 16dp from the left so it
     * lines up with the row text rather than running edge to edge. */
    private fun cardDivider(color: Int): View {
        return View(context).apply {
            setBackgroundColor(color)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(1)).apply {
                marginStart = dip(16)
            }
        }
    }

    /** A field label: 11sp medium, upper-case, tracked. */
    private fun fieldLabel(text: String, color: Int): TextView {
        return TextView(context).apply {
            this.text = text.uppercase()
            setTextColor(color)
            textSize = 11f
            typeface = MEDIUM
            letterSpacing = 0.06f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
    }

    /**
     * "Use “jane@x.com” for: [Email] [Username] · Dismiss" — shown in a
     * callout at the top of the create panel when the keyboard comes back
     * mid-draft and the focused field holds text the draft doesn't have yet:
     * typically a username or email the user just typed with their regular
     * keyboard (`offerGrabOnReturn`). One tap saves it into the chosen
     * field. Nothing is typed on the user's behalf — this only records what
     * they already typed, `ACCOUNT-CREATION-DESIGN.md`'s option (a).
     *
     * Which fields are offered: from a password field, only the draft's
     * sensitive fields, and the text shows as "••••"; otherwise the
     * non-sensitive single-line ones (not Notes), with email fields first
     * when the text looks like an email — at most three. `null` when there's
     * nothing to offer.
     */
    private fun buildGrabOfferRow(draft: DraftSnapshot?): View? {
        val text = grabOfferText ?: return null
        if (draft == null) return null
        val candidates = if (grabOfferIsPassword) {
            draft.fields.filter { it.sensitive }
        } else {
            val plain = draft.fields.filter { !it.sensitive && it.key != "notes" }
            if (EMAIL_SHAPE.matches(text)) plain.sortedByDescending { it.key.contains("email", ignoreCase = true) } else plain
        }.take(3)
        if (candidates.isEmpty()) return null

        val box = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val shown = if (grabOfferIsPassword) "••••" else text.let { if (it.length > 40) it.take(40) + "…" else it }
        box.addView(TextView(context).apply {
            this.text = "Use \u201c$shown\u201d for:"
            setTextColor(CREATE_FG)
            textSize = 13f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(8)
            }
        })
        val chips = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        for (field in candidates) {
            chips.addView(createOutlineButton(field.label) {
                grabOfferText = null
                // Typed by the user, so it starts masked (only a generated
                // password starts shown).
                revealedDraftFields.remove(field.key)
                entrySource.setDraftField(field.key, text)
                refreshDraftAndRender()
            }.apply { (layoutParams as LinearLayout.LayoutParams).marginEnd = dip(8) })
        }
        chips.addView(textButton("Dismiss", CREATE_LABEL) { _ ->
            grabOfferText = null
            renderResultsArea()
        })
        box.addView(HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(chips)
        })
        return box
    }

    /** Called once per show while a draft is active: if the focused field
     * holds text the draft doesn't already have, remember it for
     * `buildGrabOfferRow`. Uses the field's whole text (`onReadField`), and
     * whether the field is a password field (`focusedFieldIsPassword`,
     * already current — `onStartInput` runs before `onStartInputView`). The
     * text is held only while the offer is showing: cleared on a choice,
     * Dismiss, the draft ending, and `stop()`. */
    private fun offerGrabOnReturn(draft: DraftSnapshot) {
        val text = onReadField()?.trim()?.takeIf { it.isNotEmpty() } ?: return
        if (draft.fields.any { it.value == text }) return
        grabOfferText = text
        grabOfferIsPassword = focusedFieldIsPassword
    }

    /**
     * One draft field as a card row: label and value on the left ("Not
     * set" when empty, in the label color — not a bold dash that reads as
     * data); on the right, one main action and, once the field has a value,
     * a text "Fill" that types it into the page again (the confirm-password
     * case, or the same username in a second field):
     * - a generatable field (Password): **Generate**, the one filled coral
     *   button in the row; its strength shows as a thin bar under the value,
     *   and an eye shows or hides the value (`toggleDraftReveal`);
     * - a pick-from-vault field (Email): **Pick** (outline) — its list
     *   (`buildEmailListPanel`) also offers "Use what's in the field", the
     *   Grab this row would otherwise need a second button for;
     * - anything else: **Grab** (outline).
     *
     * Generate's generator panel and Pick's email list open inside the row,
     * below it — only one at a time, see `openDraftPanelKey`. Generic per
     * `DraftFieldSnapshot`'s own `canGenerate`/`canPickFromVault`/`sensitive`
     * flags, not a hardcoded `key == "password"` check.
     */
    private fun buildDraftFieldRow(field: DraftFieldSnapshot, draft: DraftSnapshot): View {
        val cell = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dip(60)
            setPadding(dip(16), dip(8), dip(12), dip(8))
        }

        val textCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dip(8)
            }
        }
        textCol.addView(fieldLabel(field.label, CREATE_LABEL))
        textCol.addView(TextView(context).apply {
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            textSize = 16f
            if (field.value.isEmpty()) {
                text = "Not set"
                setTextColor(CREATE_LABEL)
            } else {
                text = if (field.sensitive && field.key !in revealedDraftFields) "••••••••" else field.value
                setTextColor(CREATE_FG)
                // System Roboto/`Typeface.MONOSPACE`, not the web app's
                // bundled Inter/JetBrains Mono — decided, not forgotten (see
                // `docs/ime-visual-parity-plan.md` item 7).
                typeface = if (field.sensitive) Typeface.MONOSPACE else MEDIUM
            }
        })
        if (field.canGenerate) draft.passwordStrength?.let { textCol.addView(buildStrengthBar(it)) }
        row.addView(textCol)

        if (field.sensitive && field.value.isNotEmpty()) {
            val shown = field.key in revealedDraftFields
            row.addView(iconButton(
                if (shown) R.drawable.ic_eye_off else R.drawable.ic_eye,
                CREATE_LABEL,
                if (shown) "Hide ${field.label}" else "Show ${field.label}",
            ) { toggleDraftReveal(field.key) })
        }
        if (field.value.isNotEmpty()) {
            row.addView(textButton("Fill", CREATE_ACCENT) { button -> fillDraftValue(field.value, button) })
        }
        when {
            field.canGenerate -> row.addView(
                createPillButton("Generate") { button -> generateDraftPasswordField(field.key, button) }.apply {
                    (layoutParams as LinearLayout.LayoutParams).marginEnd = 0
                },
            )
            field.canPickFromVault -> row.addView(createOutlineButton("Pick") { toggleEmailList(field.key) })
            else -> row.addView(createOutlineButton("Grab") { grabIntoDraftField(field.key) })
        }
        cell.addView(row)

        if (openDraftPanelKey == field.key) {
            val panel = when {
                field.canGenerate -> buildPasswordOptionsPanel(field.key, draft.passwordOptions)
                field.canPickFromVault -> buildEmailListPanel(field.key)
                else -> null
            }
            if (panel != null) {
                draftPanelView = panel
                cell.addView(panel)
            }
        }
        return cell
    }

    /** Shows or hides a sensitive draft value (the eye on its row). The
     * plaintext is already in the draft snapshot — no bridge call. Unlike
     * the detail view's reveal it doesn't re-mask itself: this is a value
     * being edited, and the app's own editor has no timeout either
     * (`docs/ACCOUNT-CREATION-DESIGN.md`). */
    private fun toggleDraftReveal(key: String) {
        if (!revealedDraftFields.remove(key)) revealedDraftFields.add(key)
        renderResultsArea()
    }

    /** A Password field's strength, under its value: one 3dp bar filled in
     * proportion to the score, colored by it (0-1 bad, 2 warn, 3-4 ok, as
     * the web `StrengthBar` picks them), with the word at its right. The
     * word for a bad score is `DANGER`, not `STRENGTH_BAD`: text needs
     * 4.5:1 and `STRENGTH_BAD` is 3.4:1 on the card (a bar only needs 3:1).
     * `strength` comes from `estimateStrength` on the JS side; nothing here
     * re-derives it. */
    private fun buildStrengthBar(strength: PasswordStrength): View {
        val tone = when {
            strength.score <= 1 -> STRENGTH_BAD
            strength.score == 2 -> STRENGTH_WARN
            else -> SUCCESS
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dip(4)
            }
        }
        val filled = (strength.score + 1).coerceIn(1, 5)
        val track = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            background = filledRoundedRect(CREATE_BORDER, 2)
            layoutParams = LinearLayout.LayoutParams(0, dip(3), 1f)
            weightSum = 5f
            addView(View(context).apply {
                background = filledRoundedRect(tone, 2)
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, filled.toFloat())
            })
        }
        row.addView(track)
        row.addView(TextView(context).apply {
            text = strength.label
            setTextColor(if (strength.score <= 1) DANGER else tone)
            textSize = 11f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = dip(8)
            }
        })
        return row
    }

    /** The inset both inline panels (generator, saved emails) sit in, inside
     * their row: the panel background, a shade darker than the card. */
    private fun draftPanelCard(): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = filledRoundedRect(CREATE_BG, 8)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dip(12)
                rightMargin = dip(12)
                bottomMargin = dip(12)
            }
        }
    }

    /**
     * The generator panel — a port of the web `GeneratorPanel`
     * (`PasswordField.tsx`): a "Generator" heading with a "Done" that
     * collapses it, the length slider with its current value, the four
     * character-class toggles and "Regenerate". Every control goes through
     * `applyPasswordOptions` (or, for Regenerate, `generateDraftPasswordField`),
     * so each regenerates. The slider commits only on finger lift
     * (`onStopTrackingTouch`) — a JS round trip and host-field retype per
     * drag tick would be wasteful; the number beside it still updates live.
     * The last enabled class's toggle is dimmed and unclickable, mirroring
     * `canDisable`.
     */
    private fun buildPasswordOptionsPanel(fieldKey: String, options: PasswordOptions): View {
        val card = draftPanelCard().apply { setPadding(dip(12), dip(4), dip(4), dip(8)) }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(fieldLabel("Generator", CREATE_LABEL).apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(textButton("Done", CREATE_ACCENT) { _ ->
            openDraftPanelKey = null
            renderResultsArea()
        })
        card.addView(header)

        val lengthRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, dip(8), 0)
        }
        lengthRow.addView(TextView(context).apply {
            text = "Length"
            setTextColor(CREATE_LABEL)
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val lengthValue = TextView(context).apply {
            text = options.length.toString()
            setTextColor(CREATE_FG)
            textSize = 14f
            typeface = Typeface.MONOSPACE
        }
        lengthRow.addView(lengthValue)
        card.addView(lengthRow)

        val sliderRange = PASSWORD_MAX_LENGTH - PASSWORD_MIN_LENGTH
        val slider = SeekBar(context).apply {
            max = sliderRange
            progress = (options.length - PASSWORD_MIN_LENGTH).coerceIn(0, sliderRange)
            progressTintList = ColorStateList.valueOf(CREATE_ACCENT)
            thumbTintList = ColorStateList.valueOf(CREATE_ACCENT)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(40))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                    lengthValue.text = (PASSWORD_MIN_LENGTH + progress).toString()
                }

                override fun onStartTrackingTouch(seekBar: SeekBar) {
                    draftSliderDragging = true
                }

                override fun onStopTrackingTouch(seekBar: SeekBar) {
                    draftSliderDragging = false
                    applyPasswordOptions(fieldKey, options.copy(length = PASSWORD_MIN_LENGTH + seekBar.progress))
                }
            })
        }
        card.addView(slider)

        val enabledCount = listOf(options.uppercase, options.lowercase, options.numbers, options.symbols).count { it }
        val toggles = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, 0, dip(2), 0)
        }
        toggles.addView(modeToggle("A-Z", "Uppercase letters", options.uppercase, options.uppercase && enabledCount == 1) {
            applyPasswordOptions(fieldKey, options.copy(uppercase = !options.uppercase))
        })
        toggles.addView(modeToggle("a-z", "Lowercase letters", options.lowercase, options.lowercase && enabledCount == 1) {
            applyPasswordOptions(fieldKey, options.copy(lowercase = !options.lowercase))
        })
        toggles.addView(modeToggle("0-9", "Numbers", options.numbers, options.numbers && enabledCount == 1) {
            applyPasswordOptions(fieldKey, options.copy(numbers = !options.numbers))
        })
        toggles.addView(modeToggle("!@#", "Symbols", options.symbols, options.symbols && enabledCount == 1) {
            applyPasswordOptions(fieldKey, options.copy(symbols = !options.symbols))
        })
        card.addView(toggles)

        card.addView(textButton("Regenerate", CREATE_ACCENT) { button -> generateDraftPasswordField(fieldKey, button) }.apply {
            (layoutParams as LinearLayout.LayoutParams).topMargin = dip(4)
        })
        return card
    }

    /** One character-class toggle in the generator panel — a *mode*
     * control, never filled, so it reads as a setting rather than an action
     * (`docs/IME-CONTROLS-REFINEMENT-PLAN.md` item 4; filled coral is kept
     * for Generate and Save). On = a 1.5dp `CREATE_ACCENT` outline, accent
     * text and a 14dp check before the label; off = a 1dp `CREATE_BORDER`
     * outline, `CREATE_LABEL` text, no check. `locked` (the last class
     * still on) is dimmed and unclickable, like the web toggle's `disabled`
     * + `opacity-70`. A row rather than a `Button` with a compound drawable,
     * so the check stays beside the label instead of at the chip's edge.
     * Four of these share a row equally (weight 1). */
    private fun modeToggle(label: String, description: String, on: Boolean, locked: Boolean, onClick: () -> Unit): View {
        val color = if (on) CREATE_ACCENT else CREATE_LABEL
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = if (on) {
                strokedRoundedRect(CREATE_ACCENT, 1.5f, MIN_TOUCH_TARGET_DP / 2)
            } else {
                strokedRoundedRect(CREATE_BORDER, 1f, MIN_TOUCH_TARGET_DP / 2)
            }
            isClickable = !locked
            isFocusable = !locked
            isEnabled = !locked
            alpha = if (locked) 0.7f else 1f
            describeModeState(this, description, on)
            layoutParams = LinearLayout.LayoutParams(0, dip(MIN_TOUCH_TARGET_DP), 1f).apply {
                marginEnd = dip(6)
            }
            if (on) addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_check)
                setColorFilter(color)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                layoutParams = LinearLayout.LayoutParams(dip(14), dip(14)).apply { marginEnd = dip(4) }
            })
            addView(TextView(context).apply {
                text = label
                textSize = 12f
                typeface = Typeface.MONOSPACE
                setTextColor(color)
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            })
            if (!locked) setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /** A mode control's spoken state: "Symbols, on" / "Symbols, off"
     * (or "selected" / "not selected" for a switch's halves), plus
     * `isSelected` and, from API 30, `stateDescription`. */
    private fun describeModeState(view: View, description: String, on: Boolean, onWord: String = "on", offWord: String = "off") {
        view.isSelected = on
        val state = if (on) onWord else offWord
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            view.contentDescription = description
            view.stateDescription = state
        } else {
            view.contentDescription = "$description, $state"
        }
    }

    /**
     * The saved-emails list under an email field: first "Use what's in the
     * field" (Grab — which this row no longer shows a button for), then
     * `draftKnownEmails`, every distinct email-shaped value in the vault,
     * newest first, from `entrySource.listKnownEmails`. About
     * `EMAIL_LIST_MAX_VISIBLE_ROWS` rows show, then the list scrolls inside
     * itself. Tapping an email is `pickKnownEmail`. `null` (fetch in
     * flight) shows "Loading…", an empty list "No saved emails yet".
     */
    private fun buildEmailListPanel(fieldKey: String): View {
        val card = draftPanelCard()
        card.addView(buildPanelListRow("Use what's in the field", CREATE_ACCENT) {
            openDraftPanelKey = null
            grabIntoDraftField(fieldKey)
        })
        val emails = draftKnownEmails
        if (emails == null || emails.isEmpty()) {
            card.addView(cardDivider(CREATE_BORDER))
            card.addView(buildEmailInfoRow(if (emails == null) "Loading…" else "No saved emails yet"))
            return card
        }
        val list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        for (email in emails) {
            list.addView(cardDivider(CREATE_BORDER))
            list.addView(buildPanelListRow(email, CREATE_FG) { pickKnownEmail(fieldKey, email) })
        }
        val visibleRows = minOf(emails.size, EMAIL_LIST_MAX_VISIBLE_ROWS)
        card.addView(ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (dip(EMAIL_ROW_HEIGHT_DP) + dip(1)) * visibleRows)
            addView(list)
        })
        return card
    }

    /** One tappable 44dp row in an inline list (saved emails, entry types). */
    private fun buildPanelListRow(label: String, color: Int, trailingIcon: Int? = null, onClick: () -> Unit): View {
        return TextView(context).apply {
            text = label
            setTextColor(color)
            textSize = 15f
            gravity = Gravity.CENTER_VERTICAL
            ellipsize = TextUtils.TruncateAt.END
            maxLines = 1
            isClickable = true
            isFocusable = true
            if (trailingIcon != null) setCompoundDrawablesRelative(null, null, tintedIcon(trailingIcon, color, 18), null)
            setPadding(dip(16), 0, dip(16), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(EMAIL_ROW_HEIGHT_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    private fun buildEmailInfoRow(message: String): View {
        return TextView(context).apply {
            text = message
            setTextColor(CREATE_LABEL)
            textSize = 13f
            setPadding(dip(16), dip(12), dip(16), dip(12))
        }
    }

    /** The new entry's type list, shown in place of its fields while open
     * (tap the type under the title to open it; `toggleTypeList`). Every
     * type in the app's registry (`entrySource.listEntryTypes`), the
     * current one checked. Picking another calls `setDraftType`, which
     * resets every field (`ACCOUNT-CREATION-DESIGN.md`'s "Any entry type"
     * rule) — said up front when the draft holds anything. */
    private fun buildTypeListPanel(draft: DraftSnapshot): View {
        val card = fieldCard(CREATE_CARD)
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dip(16), dip(12), dip(16), dip(8))
        }
        header.addView(fieldLabel("Entry type", CREATE_LABEL))
        if (draft.fields.any { it.value.isNotEmpty() }) {
            header.addView(TextView(context).apply {
                text = "Changing the type clears what's filled in."
                setTextColor(CREATE_FG)
                textSize = 12f
            })
        }
        card.addView(header)
        val types = draftEntryTypes
        if (types == null) {
            card.addView(buildEmailInfoRow("Loading…"))
            return card
        }
        for (option in types) {
            val current = option.id == draft.type
            card.addView(cardDivider(CREATE_BORDER))
            card.addView(buildPanelListRow(
                option.label,
                if (current) CREATE_ACCENT else CREATE_FG,
                trailingIcon = if (current) R.drawable.ic_check else null,
            ) {
                openDraftPanelKey = null
                if (!current) entrySource.setDraftType(option.id)
                refreshDraftAndRender()
            })
        }
        return card
    }

    /** Opens (or closes) the type list — fetched fresh on every open. */
    private fun toggleTypeList() {
        if (openDraftPanelKey == TYPE_PANEL_KEY) {
            openDraftPanelKey = null
            renderResultsArea()
            return
        }
        openDraftPanelKey = TYPE_PANEL_KEY
        draftEntryTypes = null
        renderResultsArea()
        entrySource.listEntryTypes { types ->
            draftEntryTypes = types
            if (openDraftPanelKey == TYPE_PANEL_KEY) renderResultsArea()
        }
    }

    /** The create panel's primary button: a coral gradient pill with dark
     * bold text, 40dp tall (the IME's floor), fully rounded — Save and
     * Generate, the only two, so each screen has one clear main action. */
    private fun createPillButton(label: String, onClick: (Button) -> Unit): Button {
        return Button(context).apply {
            text = label
            textSize = 13f
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(CREATE_ACCENT_TEXT)
            background = gradientPill(CREATE_GRADIENT_TOP, CREATE_GRADIENT_BOTTOM, CREATE_BORDER, MIN_TOUCH_TARGET_DP / 2)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(16), 0, dip(16), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP)).apply {
                marginEnd = dip(8)
            }
            setOnClickListener { onClick(this) }
        }
    }

    /**
     * The "Grab" chip's action. Synchronous (no screen change, no vault
     * lookup) — `onGrabFromField` just reads
     * `currentInputConnection` directly and returns immediately. A
     * blank/`null` result (nothing selected, and the field's empty too)
     * shows a brief inline message instead of silently doing nothing, so a
     * tap that found nothing to grab doesn't read as the button being
     * broken.
     */
    private fun grabIntoDraftField(key: String) {
        val grabbed = onGrabFromField()?.takeIf { it.isNotBlank() }
        if (grabbed == null) {
            draftNotice = "Nothing to grab — select text in the field, or type something there first."
            renderResultsArea()
            return
        }
        draftNotice = null
        revealedDraftFields.remove(key)
        entrySource.setDraftField(key, grabbed)
        refreshDraftAndRender()
    }

    /** The selected entry's detail view (`docs/IME-DETAIL-CREATE-VISUAL-PASS.md`):
     * a header — the entry's icon, its title, and "Login · paul@example.com"
     * (type plus the result row's subtitle, confirming which account) — then
     * the fields in one rounded card, like the main app's entry detail: the
     * ones you'd actually fill first, then secondary ones (URL, Notes,
     * multi-line) behind "More fields" as the card's last row
     * (`splitDetailFields`). The header isn't a back control; the keypad's
     * "Back to results" is. */
    private fun buildDetailView(entry: FillEntry): View {
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, dip(12))
        }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(16), dip(14), dip(16), dip(10))
        }
        header.addView(buildAvatar(entry))
        val titleBlock = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleBlock.addView(TextView(context).apply {
            text = entry.title.ifEmpty { "Untitled" }
            setTextColor(FOREGROUND)
            textSize = 16f
            typeface = MEDIUM
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        })
        val subtitle = rowSubtitle(entry)
        titleBlock.addView(TextView(context).apply {
            text = if (subtitle.isEmpty()) entry.typeLabel else "${entry.typeLabel} \u00b7 $subtitle"
            setTextColor(DETAIL_LABEL)
            textSize = 12f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        })
        header.addView(titleBlock)
        container.addView(header)

        val card = fieldCard(DETAIL_CARD)
        val (primary, more) = splitDetailFields(entry)
        val shown = if (moreFieldsExpanded) primary + more else primary
        shown.forEachIndexed { index, field ->
            if (index > 0) card.addView(cardDivider(DETAIL_DIVIDER))
            card.addView(buildDetailFieldRow(entry, field))
        }
        if (more.isNotEmpty()) {
            if (shown.isNotEmpty()) card.addView(cardDivider(DETAIL_DIVIDER))
            card.addView(buildMoreFieldsToggle(more.size))
        }
        container.addView(card)
        return container
    }

    /** An entry's fillable fields, split into the ones you'd actually fill
     * into a form (shown first) and secondary ones — the URL, Notes, and
     * anything multi-line — that go under "More fields". A Login's primary
     * fields are ordered username, email, password (the order a sign-in form
     * asks for them); every other type keeps its registry order. */
    private fun splitDetailFields(entry: FillEntry): Pair<List<FillField>, List<FillField>> {
        val fillable = entry.fields.filter { it.fillable }
        val (more, primary) = fillable.partition { it.key == "url" || it.key == "notes" || it.dataType == "multiline" }
        val ordered = if (entry.type == "login") {
            primary.sortedBy { LOGIN_PRIMARY_ORDER.indexOf(it.key).let { i -> if (i < 0) LOGIN_PRIMARY_ORDER.size else i } }
        } else {
            primary
        }
        return ordered to more
    }

    /** Every fillable field in the order the detail view shows it. */
    private fun detailFieldOrder(entry: FillEntry): List<FillField> =
        splitDetailFields(entry).let { (primary, more) -> primary + more }

    /** The card's last row: "More fields (N)" with a chevron (pointing up
     * once open, reading "Fewer fields") — expands or collapses the
     * secondary fields in place, above it. */
    private fun buildMoreFieldsToggle(count: Int): View {
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            setPadding(dip(16), 0, dip(16), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(44))
            addView(TextView(context).apply {
                text = if (moreFieldsExpanded) "Fewer fields" else "More fields ($count)"
                setTextColor(DETAIL_LABEL)
                textSize = 13f
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
            addView(ImageView(context).apply {
                setImageResource(R.drawable.ic_chevron_down)
                setColorFilter(DETAIL_LABEL)
                rotation = if (moreFieldsExpanded) 180f else 0f
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                layoutParams = LinearLayout.LayoutParams(dip(18), dip(18))
            })
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                moreFieldsExpanded = !moreFieldsExpanded
                renderResultsArea()
            }
        }
    }

    /**
     * One field as a card row: label and value on the left; on the right,
     * the eye (show/hide, sensitive fields only) and **Fill** — a fixed-width
     * pill, so every row's Fill lines up in one column
     * (`DETAIL_FILL_WIDTH_DP`). An empty non-sensitive value reads "Not set"
     * and has no Fill (nothing to fill). A sensitive value is "••••" until
     * shown; shown, it's monospace and the label adds "· hides in Ns"
     * (`REVEAL_SECONDS`, counting down with the 2-second refresh).
     *
     * Two fields add a two-way mode switch under Fill (`buildModeSwitch`,
     * `docs/IME-CONTROLS-REFINEMENT-PLAN.md` item 2). It changes what Fill
     * does, so it looks like a setting, not like Fill:
     * - Card Number — "Whole · 4 parts". Whole fills all 16 digits; 4 parts
     *   fills one 4-digit group per tap (`performChunkFill`), Fill reading
     *   "Fill 1/4" … "Fill 4/4", for sites with four separate boxes. Once
     *   all four parts are in (either way) Fill shows a disabled "Filled"
     *   for `FILLED_REVERT_MS`, then resets (`scheduleCardFilledRevert`).
     *   Switching modes starts again from part 1.
     * - Expiry — "MM/YY · YY/MM", the digit order Fill uses
     *   (`performExpiryFill`).
     * The label and value then sit at the top of the row, level with Fill,
     * instead of centered against the taller right-hand column.
     */
    private fun buildDetailFieldRow(entry: FillEntry, field: FillField): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dip(60)
            setPadding(dip(16), dip(8), dip(12), dip(8))
        }

        val revealed = revealedFields[field.key]
        val textCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dip(8)
            }
        }
        val secondsLeft = revealExpiresAt[field.key]?.let { ((it - SystemClock.uptimeMillis() + 999) / 1000).coerceAtLeast(1) }
        textCol.addView(fieldLabel(field.label, DETAIL_LABEL).apply {
            if (revealed != null && secondsLeft != null) text = "${field.label.uppercase()} \u00b7 hides in ${secondsLeft}s"
        })
        val isEmpty = !field.sensitive && field.value.isEmpty()
        textCol.addView(TextView(context).apply {
            textSize = 16f
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            when {
                isEmpty -> {
                    text = "Not set"
                    setTextColor(DETAIL_LABEL)
                }
                field.sensitive -> {
                    text = revealed ?: "••••••••"
                    setTextColor(FOREGROUND)
                    typeface = Typeface.MONOSPACE
                }
                else -> {
                    text = field.value
                    setTextColor(FOREGROUND)
                    typeface = MEDIUM
                }
            }
        })

        row.addView(textCol)

        val isCardNumber = entry.type == "card" && field.key == "number"
        val modeSwitch = when {
            isEmpty -> null
            isCardNumber -> buildModeSwitch(
                listOf("Whole", "4 parts"),
                listOf("Fill whole number", "Fill in 4 parts"),
                if (cardFillInParts) 1 else 0,
                monospace = false,
            ) { index ->
                cardFillInParts = index == 1
                cardChunkProgress = 0
                cancelCardFilledRevert()
                renderResultsArea()
            }
            field.dataType == "monthYear" -> buildModeSwitch(
                listOf("MM/YY", "YY/MM"),
                listOf("Fill as month, year", "Fill as year, month"),
                if (expiryFormatSwapped) 1 else 0,
                monospace = true,
            ) { index ->
                expiryFormatSwapped = index == 1
                renderResultsArea()
            }
            else -> null
        }

        // Right-hand column: [eye][Fill], and the mode switch under them.
        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL or Gravity.END
        }
        if (field.sensitive) {
            actions.addView(iconButton(
                if (revealed != null) R.drawable.ic_eye_off else R.drawable.ic_eye,
                DETAIL_LABEL,
                if (revealed != null) "Hide ${field.label}" else "Show ${field.label}",
            ) { toggleReveal(entry, field) })
        }

        if (!isEmpty) {
            val fill = when {
                isCardNumber && cardChunkProgress >= 4 -> detailFillButton { }.also {
                    styleAsFilled(it, dip(MIN_TOUCH_TARGET_DP / 2).toFloat())
                    it.text = "Filled"
                    it.isEnabled = false
                    scheduleCardFilledRevert()
                }
                isCardNumber && cardFillInParts -> detailFillButton { button ->
                    performChunkFill(entry, field, button)
                }.also {
                    it.text = "Fill ${cardChunkProgress + 1}/4"
                    it.contentDescription = "Fill part ${cardChunkProgress + 1} of 4"
                }
                isCardNumber -> detailFillButton { button ->
                    cardChunkProgress = 4
                    performFill(entry, field, button)
                }
                field.dataType == "monthYear" -> detailFillButton { button -> performExpiryFill(entry, field, button) }
                else -> detailFillButton { button -> performFill(entry, field, button) }.also {
                    if (field.key == autoFilledFieldKey) styleAsFilled(it, dip(MIN_TOUCH_TARGET_DP / 2).toFloat())
                }
            }
            actions.addView(fill)
        }

        if (modeSwitch == null) {
            row.addView(actions)
            return row
        }
        row.gravity = Gravity.TOP
        (textCol.layoutParams as LinearLayout.LayoutParams).topMargin = dip(2)
        row.addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
            addView(actions)
            addView(modeSwitch.apply {
                (layoutParams as LinearLayout.LayoutParams).topMargin = dip(4)
            })
        })
        return row
    }

    /**
     * A two-way *mode* switch — the detail view's fill-format control
     * (`docs/IME-CONTROLS-REFINEMENT-PLAN.md` item 2). It's a setting, so
     * it never looks like the raised gradient Fill beside it: an outline
     * track with no fill or shadow, the chosen half lightly filled
     * (`MODE_SELECTED_FILL`, `FOREGROUND` text 7.1:1), the other plain
     * (`DETAIL_LABEL` text, 4.8:1). A fixed `MODE_SWITCH_WIDTH_DP` (the eye
     * plus Fill) so it lines up under them; drawn `COMPACT_PILL_HEIGHT_DP`
     * inside a 40dp tap area, like Lock and Clear. Each half is its own
     * control, announced "selected" / "not selected". Tapping the chosen
     * half does nothing.
     */
    private fun buildModeSwitch(
        labels: List<String>,
        descriptions: List<String>,
        selected: Int,
        monospace: Boolean,
        onSelect: (Int) -> Unit,
    ): LinearLayout {
        val radius = COMPACT_PILL_HEIGHT_DP / 2
        val track = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            background = insetPill(strokedRoundedRect(BUTTON_BORDER, 1f, radius))
            layoutParams = LinearLayout.LayoutParams(dip(MODE_SWITCH_WIDTH_DP), dip(MIN_TOUCH_TARGET_DP))
        }
        // The chosen half's fill sits 2dp inside the track's outline.
        val inset = dip((MIN_TOUCH_TARGET_DP - COMPACT_PILL_HEIGHT_DP) / 2 + 2)
        labels.forEachIndexed { index, label ->
            val chosen = index == selected
            track.addView(TextView(context).apply {
                text = label
                textSize = 12f
                gravity = Gravity.CENTER
                maxLines = 1
                typeface = when {
                    monospace -> Typeface.MONOSPACE
                    chosen -> MEDIUM
                    else -> Typeface.DEFAULT
                }
                setTextColor(if (chosen) FOREGROUND else DETAIL_LABEL)
                if (chosen) {
                    background = InsetDrawable(filledRoundedRect(MODE_SELECTED_FILL, radius - 2), dip(2), inset, dip(2), inset)
                }
                isClickable = true
                isFocusable = true
                describeModeState(this, descriptions[index], chosen, "selected", "not selected")
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
                setOnClickListener {
                    if (index == selected) return@setOnClickListener
                    performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    onSelect(index)
                }
            })
        }
        return track
    }

    /** A detail row's primary action: the neutral gradient pill, a fixed
     * `DETAIL_FILL_WIDTH_DP` wide so every row's Fill lines up. */
    private fun detailFillButton(onClick: (Button) -> Unit): Button {
        return Button(context).apply {
            text = "Fill"
            textSize = 13f
            isAllCaps = false
            typeface = MEDIUM
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            setTextColor(SECONDARY_FOREGROUND)
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, MIN_TOUCH_TARGET_DP / 2)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(8), 0, dip(8), 0)
            contentDescription = "Fill"
            layoutParams = LinearLayout.LayoutParams(dip(DETAIL_FILL_WIDTH_DP), dip(MIN_TOUCH_TARGET_DP))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick(this)
            }
        }
    }

    private fun toggleReveal(entry: FillEntry, field: FillField) {
        if (revealedFields.containsKey(field.key)) {
            revealedFields.remove(field.key)
            renderResultsArea()
            return
        }
        entrySource.readField(entry.id, field.key) { value ->
            if (!value.isNullOrEmpty()) {
                revealedFields[field.key] = value
                revealExpiresAt[field.key] = SystemClock.uptimeMillis() + REVEAL_SECONDS * 1000L
                renderResultsArea()
                uiHandler.postDelayed({
                    if (revealedFields.remove(field.key) != null) renderResultsArea()
                }, REVEAL_SECONDS * 1000L)
            }
        }
    }

    /**
     * Disabled immediately so a second tap during the brief "Filled!"
     * window (or while a sensitive value is still being read) can't
     * double-commit. Independent of whatever `revealedFields` currently
     * holds — a Fill tap always fetches fresh and commits, it doesn't reuse
     * a cached reveal.
     *
     * Also where `QuickFillUsage.recordUse` is called — right once a fill
     * is actually going to happen (a non-sensitive field immediately, a
     * sensitive one once its plaintext actually came back), not from
     * `finishFill`, which doesn't have `entry` in hand. Filling more than
     * one field of the same entry in a single visit records more than
     * once — see `QuickFillUsage.recordUse`'s own doc for why that's fine.
     */
    private fun performFill(entry: FillEntry, field: FillField, button: Button) {
        button.isEnabled = false
        if (field.sensitive) {
            entrySource.readField(entry.id, field.key) { value ->
                if (!value.isNullOrEmpty()) {
                    QuickFillUsage.recordUse(context, callingPackage, entry.id)
                    markFilled(button)
                    uiHandler.postDelayed({ finishFill(entry, field, value) }, FILL_FEEDBACK_DELAY_MS)
                } else {
                    // Nothing came back — re-enable rather than leave a dead
                    // button with no acknowledgement shown.
                    button.isEnabled = true
                }
            }
        } else {
            QuickFillUsage.recordUse(context, callingPackage, entry.id)
            markFilled(button)
            uiHandler.postDelayed({ finishFill(entry, field, field.value) }, FILL_FEEDBACK_DELAY_MS)
        }
    }

    /**
     * Fill's action in the card number's "4 parts" mode — commits one 4-digit group of a card
     * number at a time instead of the whole value at once. Fetches the
     * plaintext fresh on every tap (same as any other sensitive-field Fill,
     * no caching of the full number between taps) and re-derives the
     * current group from `cardChunkProgress`, so a stale button tap (the
     * value changed underneath, or this somehow fires twice) can't land the
     * wrong group. Deliberately bypasses `performFill`/`finishFill` — those
     * assume one complete field value, which doesn't apply here: chunked
     * fill only ever shows up in `Screen.DETAIL`'s card-Number row. "Fill,
     * then Tab" only fires once the last group actually lands, same
     * reasoning `finishFill`'s own `afterCommit` already applies to an
     * ordinary fill.
     */
    private fun performChunkFill(entry: FillEntry, field: FillField, button: Button) {
        if (cardChunkProgress >= 4) return
        button.isEnabled = false
        entrySource.readField(entry.id, field.key) { value ->
            if (value.isNullOrEmpty()) {
                button.isEnabled = true
                return@readField
            }
            val chunks = value.chunked(4)
            val index = cardChunkProgress
            if (index >= chunks.size) {
                // The real value turned out shorter than 4 groups (an
                // unusual card number length) — nothing left to split
                // further; treat this tap as "done" rather than crashing on
                // an out-of-range index.
                cardChunkProgress = 4
                renderResultsArea()
                return@readField
            }
            QuickFillUsage.recordUse(context, callingPackage, entry.id)
            uiHandler.postDelayed({
                commitCharByChar(chunks[index]) {
                    cardChunkProgress += 1
                    renderResultsArea()
                    if (cardChunkProgress >= chunks.size) armPostFillTabAndPasswordCheck(entry, field)
                }
            }, FILL_FEEDBACK_DELAY_MS)
        }
    }

    /**
     * The Expiry field's own Fill action — reuses `finishFill` (so it still
     * gets the char-by-char masked commit and "Fill, then Tab" behaviour
     * every other fill does) but, unlike `performFill`, swaps the two
     * digit-pairs first when `expiryFormatSwapped` is set. Doesn't go
     * through `entrySource.readField` at all: a `monthYear` field's value
     * is never sensitive today (see `docs/MANUAL-FILL-DESIGN.md`'s "Filling
     * a masked field" section — a sensitive custom field can't have
     * `dataType: 'monthYear'`, and the Card template's own Expiry isn't
     * marked sensitive), and it already arrives pre-formatted as bare
     * `MMYY` digits — see `monthYearIsoToFillDigits` on the JS side — so
     * `field.value` is always already in hand.
     *
     * Falls back to the ordinary `performFill` if the value isn't the
     * expected 4-digit shape (an empty field, or something not actually
     * `monthYear`-shaped that got here some other way) rather than mangling
     * it.
     */
    private fun performExpiryFill(entry: FillEntry, field: FillField, button: Button) {
        val raw = field.value
        if (raw.length != 4 || raw.any { !it.isDigit() }) {
            performFill(entry, field, button)
            return
        }
        val toFill = if (expiryFormatSwapped) raw.substring(2, 4) + raw.substring(0, 2) else raw
        button.isEnabled = false
        QuickFillUsage.recordUse(context, callingPackage, entry.id)
        markFilled(button)
        uiHandler.postDelayed({ finishFill(entry, field, toFill) }, FILL_FEEDBACK_DELAY_MS)
    }

    /**
     * Swaps a tapped Fill/Generate button to a brief "Filled!"
     * acknowledgement, then reverts it back to its own original label and
     * colors after `FILLED_REVERT_MS` (per request). Called only once the
     * value that's about to be committed is actually in hand, so it never
     * claims success before the fill has happened.
     *
     * Used to rely entirely on the caller re-rendering the view shortly
     * after (`finishFill`, `refreshDraftAndRender`) to undo this — correct
     * whenever that actually happens, but `finishFill`'s own `afterCommit`
     * only re-renders when `screen == Screen.DETAIL`; a fill landing after
     * `screen` had since moved on from `DETAIL` left this exact button
     * stuck on "Filled!", and disabled,
     * indefinitely, since nothing else was ever watching it. A per-button
     * timer here doesn't depend on the caller getting that right, and it's
     * harmless in the already-working cases too: a re-render there discards
     * this exact `Button` instance outright, so the delayed callback below
     * just finds a detached View with nothing left to visibly change.
     */
    private fun markFilled(button: Button) {
        val originalText = button.text
        val originalTextColor = button.currentTextColor
        val originalBackground = button.background
        val originalRadius = (originalBackground as? GradientDrawable)?.cornerRadius
        styleAsFilled(button, originalRadius)
        uiHandler.postDelayed({
            button.text = originalText
            button.setTextColor(originalTextColor)
            button.background = originalBackground
            button.setCompoundDrawablesRelative(null, null, null, null)
            button.isEnabled = true
        }, FILLED_REVERT_MS)
    }

    /** The "Filled!" look: a flat `SUCCESS` fill with dark text and a check
     * glyph. Flat deliberately, not a gradient — a brief, transient
     * confirmation, with no real app reference for a gradient success
     * state. Keeps the button's own corner radius (a coral pill stays a
     * pill). Used by `markFilled` and for a chip the keyboard filled on its
     * own (`autoFilledFieldKey`). */
    private fun styleAsFilled(button: Button, radiusPx: Float? = null) {
        button.text = "Filled!"
        button.setTextColor(BACKGROUND)
        button.background = filledRoundedRect(SUCCESS, 5).apply {
            if (radiusPx != null) cornerRadius = radiusPx
        }
        setCheckIcon(button, BACKGROUND)
    }

    /** A 16dp check glyph before the button's label, tinted `color` — in
     * place of a "✓" text character, whose look varies by device font. */
    private fun setCheckIcon(button: Button, color: Int) {
        val icon = context.getDrawable(R.drawable.ic_check)?.mutate()?.apply {
            setTint(color)
            setBounds(0, 0, dip(16), dip(16))
        }
        button.setCompoundDrawablesRelative(icon, null, null, null)
        button.compoundDrawablePadding = dip(6)
    }

    /**
     * Starts the clock on a fully-filled Card Number row's disabled
     * "Filled" state (`cardChunkProgress >= 4`, reached via Fill in "Whole" mode or
     * the last part in "4 parts" mode): `FILLED_REVERT_MS` after it first shows
     * up, `revertCardFilledRunnable` resets the counter to 0 and
     * re-renders, so Fill comes back clickable ("Fill 1/4" in parts) — the same
     * "acknowledge briefly, then return to normal" every other Fill button
     * already gets from `markFilled`. `markFilled` can't cover this one: it
     * reverts a single `Button` instance, but by the time this state
     * shows the row has been rebuilt around a different, permanently
     * disabled button, which nothing was ever going to revert.
     *
     * Called from the render itself (`buildDetailFieldRow`) rather than at
     * each site that sets the counter, so every route into the state is
     * covered by the one call — Fill in "Whole" mode (which sets it at tap time,
     * before the value has landed), the last chunk, `performChunkFill`'s
     * out-of-range fallback. Only the first render in the state schedules
     * anything (`cardFilledRevertScheduled`), so a re-render from something
     * unrelated can't keep pushing the revert back.
     */
    private fun scheduleCardFilledRevert() {
        if (cardFilledRevertScheduled) return
        cardFilledRevertScheduled = true
        uiHandler.postDelayed(revertCardFilledRunnable, FILLED_REVERT_MS)
    }

    private fun cancelCardFilledRevert() {
        uiHandler.removeCallbacks(revertCardFilledRunnable)
        cardFilledRevertScheduled = false
    }

    /** The result row's one-tap Fill and "Save new login…". 44dp tall by
     * default (40dp in a result row), at or above the IME's 40dp floor.
     * `minWidth`/`minHeight` stay zeroed on purpose: zeroing only stops
     * Android's default `Button` style padding it wider/taller than its
     * text needs.
     *
     * Two looks: an action (the gradient pill) and disabled (flat,
     * outlined, no shadow, muted text — it used to keep the gradient and
     * shadow, so it barely looked disabled). Settings use `modeToggle` /
     * `buildModeSwitch` instead. */
    private fun smallActionButton(
        label: String,
        enabled: Boolean = true,
        heightDp: Int = 44,
        onClick: (Button) -> Unit,
    ): Button {
        return Button(context).apply {
            text = label
            textSize = 13f
            isAllCaps = false
            isEnabled = enabled
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            setTextColor(if (enabled) SECONDARY_FOREGROUND else MUTED_FOREGROUND)
            when {
                // Fully rounded (radius = half the height): every action
                // button outside the keypad is a pill, keys are 5dp
                // rectangles — see `docs/IME-DETAIL-CREATE-VISUAL-PASS.md` V1.
                !enabled -> {
                    background = filledStrokedRoundedRect(CARD, BORDER, 1, heightDp / 2)
                    elevation = 0f
                }
                else -> {
                    background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, heightDp / 2)
                    elevation = dip(BUTTON_ELEVATION_DP).toFloat()
                }
            }
            // 20dp of text clearance either side.
            setPadding(dip(20), 0, dip(20), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(heightDp)).apply {
                marginStart = dip(6)
            }
            setOnClickListener { onClick(this) }
        }
    }

    // ── Locked view ─────────────────────────────────────────────────────

    /** Shown instead of the full search/results/keypad view whenever
     * `entrySource` has nothing to offer — either Vault isn't running, or it
     * is but the vault's locked. Same `BODY_HEIGHT_DP` as every other view
     * (a short strip here used to make the host app jump on every lock and
     * unlock). The top bar keeps its place, showing only the wordmark; below
     * it, one line saying what's going on, a primary "Unlock Vault"
     * (`onOpenVault` — see that callback's own doc for what each adapter
     * does with it) and a secondary "Use other keyboard", so a locked vault
     * never leaves the user stuck in a keyboard that can't type. */
    private fun buildLockedView(): View {
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
        }
        body.addView(buildLockedHeader())

        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(CARD)
            setPadding(dip(24), dip(16), dip(24), dip(16))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        content.addView(TextView(context).apply {
            text = "Vault is locked. Unlock it to fill passwords."
            setTextColor(FOREGROUND)
            textSize = 15f
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(20)
            }
        })
        content.addView(Button(context).apply {
            text = "Unlock Vault"
            textSize = 16f
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            setTextColor(SECONDARY_FOREGROUND)
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            layoutParams = LinearLayout.LayoutParams(dip(220), dip(52))
            setOnClickListener { openVaultForFill() }
        })
        content.addView(TextView(context).apply {
            text = "Use other keyboard"
            setTextColor(SECONDARY_FOREGROUND)
            textSize = 14f
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            setPadding(dip(16), 0, dip(16), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(MIN_TOUCH_TARGET_DP)).apply {
                topMargin = dip(12)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                returnToPreviousKeyboard()
            }
        })
        body.addView(content)
        return withBottomInset(body)
    }

    /** The locked view's top bar: the same height and wordmark as
     * `buildTopBar`, without Lock or Clear — there's nothing to lock, and
     * nothing here writes into the host field. */
    private fun buildLockedHeader(): View {
        val bar = FrameLayout(context).apply {
            setBackgroundColor(BACKGROUND)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(TOP_BAR_HEIGHT_DP))
        }
        bar.addView(buildTopBarLogo())
        return withBottomBorder(bar)
    }

    private fun openVaultForFill() {
        onOpenVault()
        // Also step out of this keyboard — back to whatever the field's
        // regular keyboard is — so the picker isn't just sitting there
        // waiting underneath Vault while it's open.
        returnToPreviousKeyboard()
    }

    /**
     * The keypad's "Lock" key. Unlike a fill or "Open Vault", this
     * deliberately does NOT `returnToPreviousKeyboard()` — the picker stays
     * open and switches itself to the locked view, per the spec ("the IME
     * will go to locked mode"), rather than handing back to whatever
     * keyboard was active before it.
     *
     * `allEntries` is cleared and `render()` called immediately, ahead of
     * any real confirmation from the app — `entrySource.lockVault()` is
     * fire-and-forget, and waiting on the next auto-refresh poll (up to
     * `AUTO_REFRESH_INTERVAL_MS`) for the view to catch up would make a tap
     * that should feel instant visibly lag. If the lock request somehow
     * didn't actually take (app not running, e.g.), the next poll's
     * `listEntries` would already report an empty vault anyway — so this
     * never shows a locked view that doesn't match reality for more than
     * one refresh interval.
     */
    private fun lockVault() {
        entrySource.lockVault()
        allEntries = emptyList()
        render()
    }

    // ── Streamlined account creation ────────────────────────────────────
    // See `docs/ACCOUNT-CREATION-DESIGN.md`. Unlike `openVaultForFill`
    // and the old "+"-launches-`MainActivity` behaviour this replaced,
    // every one of these keeps the picker open — account creation now
    // happens entirely inside this view, not by handing off to the app.

    /**
     * The keypad's "+" key. Already on `Screen.CREATE`: nothing more for
     * "+" to do, a no-op. Anything else: starts (or resumes — see
     * `startCreatingDraft`) the draft and switches to `Screen.CREATE`,
     * replacing whatever was showing, `Screen.DETAIL` included.
     */
    private fun onPlusKeyTapped() {
        if (screen == Screen.CREATE) return
        startCreatingDraft()
    }

    /**
     * Starts a fresh draft, seeded with `titleGuess` — whatever
     * `setDetectedContext` most recently supplied, or the typed query when
     * started from "No matches" — or, if `currentDraft` already holds one (from an
     * earlier show of this same keyboard session that was never finished),
     * resumes that instead of discarding it. `currentDraft` is only a
     * locally cached snapshot — not re-fetched here — but `start()` already
     * refreshes it on every keyboard show, so it's never stale by more than
     * this one show's own actions, which are the only thing that can change
     * it anyway.
     */
    private fun startCreatingDraft(titleGuess: String = detectedTitleGuess) {
        draftNotice = null
        if (currentDraft != null) {
            screen = Screen.CREATE
            updateBottomRowsForScreen()
            renderResultsArea()
            return
        }
        entrySource.startDraft(titleGuess)
        screen = Screen.CREATE
        refreshDraftAndRender()
    }

    /** Re-fetches the draft and re-renders `Screen.CREATE` from it — the
     * one path every draft-mutating action (starting, generating, picking
     * a field) funnels through afterwards, so the panel never shows a value
     * it hasn't actually confirmed with the JS side. */
    private fun refreshDraftAndRender() {
        entrySource.getDraft { draft ->
            currentDraft = draft
            updateBottomRowsForScreen()
            renderResultsArea()
        }
    }

    /** A draft field's "Generate" action (password only). The value comes
     * back from `entrySource.generateDraftPassword`, which also stores it in
     * the draft. Also opens the generator panel under this field
     * (`buildPasswordOptionsPanel`) if it isn't already, the way the web
     * password field's dice button does.
     *
     * Writes into the page only when the focused field is a password field
     * (`focusedFieldIsPassword`) — then with `performFill`'s
     * disable-then-acknowledge shape, replacing the field's text rather than
     * appending (`onClearField` first), since Generate is tapped repeatedly
     * while iterating toward a password. With any other field focused it
     * only updates the draft and says so (`draftNotice`); the draft row's
     * own "Fill" then writes it on an explicit tap. Writing regardless would
     * wipe, say, the username field and show the password there in plain
     * text — see `docs/IME-UX-REVIEW.md` P5.
     *
     * Either way the new password shows in plain text in its row
     * (`revealedDraftFields`): the host's password field only shows dots,
     * so otherwise nothing would say a password was made
     * (`docs/IME-CONTROLS-REFINEMENT-PLAN.md` item 3). */
    private fun generateDraftPasswordField(key: String, button: Button) {
        button.isEnabled = false
        if (openDraftPanelKey != key) {
            openDraftPanelKey = key
            scrollToDraftPanel = true
        }
        entrySource.generateDraftPassword { value ->
            if (value.isNullOrEmpty()) {
                button.isEnabled = true
                return@generateDraftPassword
            }
            revealedDraftFields.add(key)
            if (!focusedFieldIsPassword) {
                draftNotice = PASSWORD_HELD_NOTICE
                refreshDraftAndRender()
                return@generateDraftPassword
            }
            draftNotice = null
            markFilled(button)
            uiHandler.postDelayed({
                onClearField()
                onCommitText(value)
                refreshDraftAndRender()
            }, FILL_FEEDBACK_DELAY_MS)
        }
    }

    /** Every control in the generator panel funnels through here: persists
     * the new settings and regenerates from them
     * (`entrySource.setDraftPasswordOptions`, which also validates/clamps on
     * the JS side and stores the result in the draft), then replaces the
     * host field's text with the result — same clear-then-commit, and the
     * same password-field-only rule, as `generateDraftPasswordField`. An
     * all-classes-off combination is refused up front (the panel already
     * locks the last enabled toggle, so this is a backstop). The result
     * shows in `fieldKey`'s row, as with Generate. */
    private fun applyPasswordOptions(fieldKey: String, options: PasswordOptions) {
        if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) return
        entrySource.setDraftPasswordOptions(options) { value ->
            if (!value.isNullOrEmpty()) {
                revealedDraftFields.add(fieldKey)
                if (focusedFieldIsPassword) {
                    draftNotice = null
                    onClearField()
                    onCommitText(value)
                } else {
                    draftNotice = PASSWORD_HELD_NOTICE
                }
            }
            refreshDraftAndRender()
        }
    }

    /** An email field's "Pick from Vault": opens (or, if it's already open,
     * closes) the inline saved-emails list under that row. The list is
     * fetched fresh on every open, so it never shows a stale set. */
    private fun toggleEmailList(key: String) {
        if (openDraftPanelKey == key) {
            openDraftPanelKey = null
            renderResultsArea()
            return
        }
        openDraftPanelKey = key
        draftKnownEmails = null
        scrollToDraftPanel = true
        renderResultsArea()
        entrySource.listKnownEmails { emails ->
            draftKnownEmails = emails
            if (openDraftPanelKey == key) {
                scrollToDraftPanel = true
                renderResultsArea()
            }
        }
    }

    /** Tapping an email in the inline list: records it in the draft,
     * collapses the list, and replaces the host field's text with it
     * (clear, then type — appending would corrupt a half-typed address) —
     * unless the focused field is a password field, which it must never
     * wipe; then it only updates the draft and says so, the mirror image of
     * `generateDraftPasswordField`'s rule. `setDraftField` and the
     * `getDraft` inside `refreshDraftAndRender` are both queued on the
     * webview in order, so the re-render sees the new value. */
    private fun pickKnownEmail(key: String, email: String) {
        openDraftPanelKey = null
        if (focusedFieldIsPassword) {
            draftNotice = "Email saved to this entry. Tap the page's email field, then Fill to type it there."
        } else {
            draftNotice = null
            onClearField()
            onCommitText(email)
        }
        entrySource.setDraftField(key, email)
        refreshDraftAndRender()
    }

    /** Collapses whichever inline panel is open and drops what it held —
     * called wherever a draft session ends or restarts (`start()`,
     * `finishDraft`, `cancelDraftFlow`). */
    private fun closeDraftPanels() {
        openDraftPanelKey = null
        revealedDraftFields.clear()
        confirmingDraftDiscard = false
        draftSavedMessage = null
        grabOfferText = null
        draftKnownEmails = null
        scrollToDraftPanel = false
        draftSliderDragging = false
    }

    /** A draft field's "Fill" action, once it already has a value — retypes
     * that same stored value into whatever's focused (the confirm-password
     * case from `docs/ACCOUNT-CREATION-DESIGN.md`'s step 6, or just filling
     * the same username into a second field on the form) without touching
     * the draft itself. */
    private fun fillDraftValue(value: String, button: Button) {
        if (value.isEmpty()) return
        button.isEnabled = false
        markFilled(button)
        uiHandler.postDelayed({
            onCommitText(value)
            refreshDraftAndRender()
        }, FILL_FEEDBACK_DELAY_MS)
    }

    /** The creation panel's "Save" action. Commits whatever the draft has
     * — flagged for review, per the design doc, regardless of how few
     * fields got filled in — then says what happened for `SAVE_CONFIRM_MS`
     * before leaving the picker, the same as any other "the user is done
     * here" action. It used to leave instantly with no sign anything was
     * saved (`docs/IME-UX-REVIEW.md` P8).
     *
     * `commitDraft` reports `false` both for an empty draft (nothing to
     * save) and when the vault turned out to have auto-locked — in which
     * case the lock itself already saved the draft, flagged for review. The
     * keyboard's own snapshot tells the two apart: a draft that held values
     * can only have come back `false` through the lock. */
    private fun finishDraft() {
        val hadValues = currentDraft?.fields?.any { it.value.isNotEmpty() } == true
        entrySource.commitDraft { saved ->
            draftSavedMessage = when {
                saved -> "Saved to Vault \u2014 review it in the app."
                hadValues -> "Vault locked \u2014 the entry was saved for review."
                else -> "Nothing to save \u2014 the entry was empty."
            }
            renderResultsArea()
            uiHandler.postDelayed({
                closeDraftPanels()
                draftNotice = null
                currentDraft = null
                screen = Screen.SEARCH
                returnToPreviousKeyboard()
            }, SAVE_CONFIRM_MS)
        }
    }

    /** The creation panel's "Cancel" (✕). A draft with every field still
     * empty is discarded at once. One with any value asks first
     * (`confirmingDraftDiscard` → `buildDiscardConfirmBar`): by then the
     * value may already be in the page — a generated password the site has
     * accepted, say — and discarding would leave it saved nowhere but that
     * site. See `docs/IME-UX-IMPROVEMENT-PLAN.md` D1. */
    private fun cancelDraftFlow() {
        val hasValues = currentDraft?.fields?.any { it.value.isNotEmpty() } == true
        if (hasValues) {
            confirmingDraftDiscard = true
            renderResultsArea()
            return
        }
        discardDraft()
    }

    /** Actually discards the draft and returns to an ordinary, empty search
     * — unlike "Done," this stays open, since cancelling account creation
     * doesn't necessarily mean the user is done with the picker entirely
     * (they may still want to fill something else). */
    private fun discardDraft() {
        draftNotice = null
        entrySource.cancelDraft()
        closeDraftPanels()
        currentDraft = null
        screen = Screen.SEARCH
        query.clear()
        updateBottomRowsForScreen()
        updateQueryDisplay()
        renderResultsArea()
    }

    // ── Shared chrome ───────────────────────────────────────────────────

    /** A 1px hairline under `content`. Android has no cheap one-line
     * "bottom border" for an arbitrary View, so this wraps it with a
     * second, 1dp-tall View instead. */
    private fun withBottomBorder(content: View): View {
        val wrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        wrapper.addView(content)
        val border = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(1))
            setBackgroundColor(BORDER)
        }
        wrapper.addView(border)
        return wrapper
    }

    private fun filledRoundedRect(color: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setColor(color)
        }
    }

    /** The real app's own button recipe (`docs/ime-visual-parity-plan.md`)
     * — a two-stop top-to-bottom gradient with a 1px border, in place of
     * `filledRoundedRect`'s flat fill, for every real action button (never
     * for a field or a result/shelf row — those stay flat, matching the
     * web app's own "no gradients except this one button recipe" rule).
     * Callers also set `elevation = dip(BUTTON_ELEVATION_DP).toFloat()`
     * alongside this background — see `BUTTON_ELEVATION_DP`'s own doc for
     * why that's a separate line here rather than bundled into this
     * function's return value. */
    private fun gradientPill(topColor: Int, bottomColor: Int, borderColor: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(topColor, bottomColor)).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setStroke(dip(1), borderColor)
        }
    }

    /** A filled rect with its own border — the search box pill, matching
     * the real app's own search field (`EntryList.tsx`: `bg-[#1f252d]/70
     * border border-[#4d5761]/70`), which is a flat bordered field, not a
     * gradient button. The only call site that needs both a fill and a
     * border at once; every other field/row on this file's palette is
     * either flat-only (`filledRoundedRect`, result rows) or a real button
     * (`gradientPill`). */
    /** Draws `shape` (a pill, or Lock/Clear's rounded rectangle)
     * `COMPACT_PILL_HEIGHT_DP` tall, vertically centered in
     * a view whose tap area stays `MIN_TOUCH_TARGET_DP` (40dp): the view
     * keeps its height, only its background is inset. The IME's 40dp floor
     * is about where a finger can land, not what's drawn. `InsetDrawable`
     * passes the inset outline on, so an elevation shadow follows the pill,
     * not the full tap area. */
    private fun insetPill(shape: GradientDrawable): InsetDrawable {
        val inset = dip((MIN_TOUCH_TARGET_DP - COMPACT_PILL_HEIGHT_DP) / 2)
        return InsetDrawable(shape, 0, inset, 0, inset)
    }

    private fun filledStrokedRoundedRect(fillColor: Int, strokeColor: Int, strokeWidthDp: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setColor(fillColor)
            setStroke(dip(strokeWidthDp), strokeColor)
        }
    }

    /** An unfilled, stroke-only rounded rect — outline controls: the
     * new-entry panel's secondary buttons and "Discard", and the mode
     * controls (`modeToggle`, `buildModeSwitch`'s track). Outline, not a
     * fill, so they read as lighter-weight than the filled action beside
     * them. */
    private fun strokedRoundedRect(strokeColor: Int, strokeWidthDp: Float, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setColor(Color.TRANSPARENT)
            setStroke((strokeWidthDp * context.resources.displayMetrics.density).toInt().coerceAtLeast(1), strokeColor)
        }
    }

    /** Gives `body` the fixed `BODY_HEIGHT_DP` every view shares, and puts
     * a spacer under it: the system's navigation-bar inset, but never less
     * than `BOTTOM_CLEARANCE_DP`. The floor is deliberate. With gesture
     * navigation the reported inset is only ~16–24dp, yet while a keyboard
     * is up the system draws its own buttons there (hide keyboard, switch
     * keyboard) in a 48dp strip, so the inset alone let them overlap the
     * keypad's bottom row. The spacer only adds height below the body, so
     * the keyboard grows taller and the body moves up; nothing inside it
     * changes size. */
    private fun withBottomInset(body: LinearLayout): View {
        body.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(BODY_HEIGHT_DP))
        val spacer = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
            setBackgroundColor(BACKGROUND)
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
            addView(body)
            addView(spacer)
        }
        root.setOnApplyWindowInsetsListener { _, insets ->
            val navBar = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                insets.getInsets(WindowInsets.Type.navigationBars()).bottom
            } else {
                @Suppress("DEPRECATION")
                insets.systemWindowInsetBottom
            }
            val bottom = maxOf(navBar, dip(BOTTOM_CLEARANCE_DP))
            if (spacer.layoutParams.height != bottom) {
                spacer.layoutParams.height = bottom
                spacer.requestLayout()
            }
            insets
        }
        root.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) = v.requestApplyInsets()
            override fun onViewDetachedFromWindow(v: View) = Unit
        })
        return root
    }

    // ── On-screen keyboard ──────────────────────────────────────────────

    // A minimal on-screen keyboard for the search box only — see the class
    // doc for why the system keyboard can't be used here. Four rows:
    // QWERTYUIOP, ASDFGHJKL, a "123"-toggle + ZXCVBNM + backspace row, and
    // a last row of a globe (switch keyboard), "space" and a "+" (add
    // entry) key — swapped for "Back
    // to results" over `Screen.DETAIL`, or hidden entirely over
    // `Screen.CREATE` (that screen's own Cancel/Save live in
    // `buildCreatePanel`'s header), see `updateBottomRowsForScreen`. Lock
    // and Clear live in `buildTopBar` (`docs/ime-ux-redesign-proposal.md`) —
    // everything here writes into the search box or navigates this picker's
    // own screens, nothing reaches outside it.
    private fun buildKeyboard(): LinearLayout {
        // Rows span the keyboard's (near-)full width — just a small fixed
        // edge margin so keys don't touch the screen's sides, not the 10%
        // side padding this used to carry. Keys still fill their row by
        // weight, so the actual per-key width comes out of KEY_GAP_DP: a
        // wider gap between keys eats into that same shared width and
        // narrows every key, without narrowing the row itself.
        val keyboard = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
            setPadding(dip(4), dip(KEYPAD_PADDING_DP), dip(4), dip(KEYPAD_PADDING_DP))
        }

        keysArea = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        keyboard.addView(keysArea)
        refreshKeysArea()

        // A globe (switch keyboard), "space", and a neutral "+" that starts a
        // new entry — key-sized icon keys (weight 1.2, the same as "123" and
        // backspace), not the half-width coral "Add Entry" this row used to
        // carry.
        // A globe key on the left switches to the next keyboard (held: the
        // system picker) — the IME had no way to switch at all, leaving the
        // user to find the system's own switcher (`docs/IME-UX-REVIEW.md`
        // C4). Hidden when the system says it already offers one.
        val showSwitch = offersKeyboardSwitch()
        spaceRow = keyRow(isFirstRow = false).apply {
            if (showSwitch) {
                addView(
                    iconKey(R.drawable.ic_globe, "Switch keyboard", weight = 1.2f) { onSwitchToNextKeyboard() }.apply {
                        setOnLongClickListener {
                            performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                            onShowKeyboardPicker()
                            true
                        }
                    },
                )
            }
            addView(specialKey("space", weight = if (showSwitch) 7.6f else 8.8f) { query.append(' '); onQueryChanged() })
            addView(iconKey(R.drawable.ic_plus, "Add entry", weight = 1.2f) { onPlusKeyTapped() }.apply {
                setColorFilter(ADD_KEY_GLYPH)
                background = gradientPill(ADD_KEY_TOP, ADD_KEY_BOTTOM, ADD_KEY_BORDER, 5)
            })
        }
        keyboard.addView(spaceRow)

        // Takes `spaceRow`'s place — same slot, same height — over
        // `Screen.DETAIL`; see `updateBottomRowsForScreen`. Returns to the
        // search results *with the query kept* (`returnToSearch`), which is
        // what the label says — don't call it "New search", it doesn't
        // clear anything. Nothing takes
        // this slot for `Screen.CREATE`: the whole keypad hides there.
        detailActionsRow = keyRow(isFirstRow = false).apply {
            addView(specialKey("Back to results", weight = 1f) { returnToSearch() })
        }
        detailActionsRow.visibility = View.GONE
        keyboard.addView(detailActionsRow)

        return keyboard
    }

    /** One `KEY_ROW_HEIGHT_DP`-tall keypad row, with `ROW_GAP_DP` above it
     * unless it's the first. */
    private fun keyRow(isFirstRow: Boolean): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(KEY_ROW_HEIGHT_DP)).apply {
                if (!isFirstRow) topMargin = dip(ROW_GAP_DP)
            }
        }
    }

    /** Swaps the keypad's letter/number rows and whichever of
     * `spaceRow`/`detailActionsRow` is visible to match the current
     * `screen` — the two bottom rows occupy the same slot in `keyboard`'s
     * view tree, so at most one is ever visible; `Screen.CREATE` leaves
     * both hidden, since its own Cancel/Done live in `buildCreatePanel`'s
     * header instead.
     *
     * Also hides the search box and its divider outside `Screen.SEARCH`,
     * so DETAIL/CREATE show just the expanded result region and the bottom
     * buttons. There is no handle/grip bar between the results region and
     * this unit — one was removed by direct request, since nothing ever
     * dragged it; the `CARD`-on-`BACKGROUND` color change is the seam.
     */
    private fun updateBottomRowsForScreen() {
        if (!::keysArea.isInitialized) return
        val searching = screen == Screen.SEARCH
        keysArea.visibility = if (searching) View.VISIBLE else View.GONE
        searchBoxRow.visibility = if (searching) View.VISIBLE else View.GONE
        searchDivider.visibility = if (searching) View.VISIBLE else View.GONE
        spaceRow.visibility = if (screen == Screen.SEARCH) View.VISIBLE else View.GONE
        detailActionsRow.visibility = if (screen == Screen.DETAIL) View.VISIBLE else View.GONE
    }

    /** Rebuilds the letter/number rows from scratch — cheap enough to just
     * redo on every mode toggle. Real QWERTY/ASDFGHJKL/ZXCVBNM, not
     * whatever a design tool's mock export said — see the redesign
     * request's own note that its reference had all rows duplicated. */
    private fun refreshKeysArea() {
        keysArea.removeAllViews()
        when (keyboardMode) {
            KeyboardMode.LETTERS -> {
                keysArea.addView(buildKeyRow(listOf("q", "w", "e", "r", "t", "y", "u", "i", "o", "p"), isFirstRow = true))
                keysArea.addView(buildKeyRow(listOf("a", "s", "d", "f", "g", "h", "j", "k", "l"), horizontalInsetDp = SECOND_ROW_INSET_DP))
                keysArea.addView(buildThirdRow(listOf("z", "x", "c", "v", "b", "n", "m")))
            }
            KeyboardMode.NUMBERS -> {
                keysArea.addView(buildKeyRow(listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "0"), isFirstRow = true))
                // The characters a search actually needs beyond letters and
                // digits — emails, "t-mobile", "a_b", "at&t", "o'reilly" —
                // none of which could be typed before. Also keeps this layer
                // at three rows, the same height as the letters layer.
                keysArea.addView(buildKeyRow(listOf("@", ".", "-", "_", "/", "&", "'"), horizontalInsetDp = SYMBOL_ROW_INSET_DP))
                keysArea.addView(buildThirdRow(emptyList()))
            }
        }
    }

    private fun toggleKeyboardMode() {
        keyboardMode = if (keyboardMode == KeyboardMode.LETTERS) KeyboardMode.NUMBERS else KeyboardMode.LETTERS
        modeToggleButton.text = modeToggleLabel()
        refreshKeysArea()
    }

    private fun modeToggleLabel(): String = if (keyboardMode == KeyboardMode.LETTERS) "123" else "ABC"

    private fun buildKeyRow(chars: List<String>, isFirstRow: Boolean = false, horizontalInsetDp: Int = 0): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(KEY_ROW_HEIGHT_DP)).apply {
                // Every row but the first gets a top margin — that's the
                // "clearance upwards" between rows; the first row already
                // sits below the keyboard container's own top padding.
                if (!isFirstRow) topMargin = dip(ROW_GAP_DP)
            }
            // Padding, not margin — shrinks the row's own content width so
            // the weighted keys inside it redistribute into the smaller
            // space, rather than leaving a gap next to a still-full-width
            // last key.
            if (horizontalInsetDp > 0) setPadding(dip(horizontalInsetDp), 0, dip(horizontalInsetDp), 0)
        }
        for (char in chars) row.addView(characterKey(char))
        return row
    }

    /** The "123"-toggle-plus-letters-plus-backspace row. `letters` is empty
     * in `KeyboardMode.NUMBERS`, where there's nothing to put between the
     * two — a flexible spacer takes that space instead, so the toggle and
     * backspace keys sit at the same width/position as in letters mode. */
    private fun buildThirdRow(letters: List<String>): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(KEY_ROW_HEIGHT_DP)).apply {
                topMargin = dip(ROW_GAP_DP)
            }
        }

        // 1.2f, not 1f — 20% wider than an ordinary key. Weight-based
        // sizing is what makes this grow "towards the center" on its own:
        // each of these two sits at one edge of the row, so the only
        // direction its *other* edge can move when it claims more weight
        // is inward — the row's own left/right bounds don't move.
        modeToggleButton = specialKey(modeToggleLabel(), weight = 1.2f) { toggleKeyboardMode() }
        row.addView(modeToggleButton)

        if (letters.isEmpty()) {
            val spacer = View(context).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 7f)
            }
            row.addView(spacer)
        } else {
            for (char in letters) row.addView(characterKey(char))
        }

        row.addView(buildBackspaceKey())

        return row
    }

    /** Deletes one character per tap and keeps deleting while held: after
     * `BACKSPACE_REPEAT_DELAY_MS`, then every `BACKSPACE_REPEAT_INTERVAL_MS`
     * — clearing a long query used to take one tap per character. The
     * search box's own ✕ clears it all at once. Driven by a touch listener
     * rather than a click listener, so the first delete lands on press, the
     * way a real keyboard's does; `performClick` keeps accessibility
     * services' activation working. */
    private fun buildBackspaceKey(): View {
        val key = iconKey(R.drawable.ic_backspace, "Delete", weight = 1.2f) { deleteQueryChar() }
        val repeat = object : Runnable {
            override fun run() {
                if (deleteQueryChar()) backspaceHandler.postDelayed(this, BACKSPACE_REPEAT_INTERVAL_MS)
            }
        }
        key.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    view.isPressed = true
                    view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                    deleteQueryChar()
                    backspaceHandler.postDelayed(repeat, BACKSPACE_REPEAT_DELAY_MS)
                }
                MotionEvent.ACTION_UP -> {
                    view.isPressed = false
                    backspaceHandler.removeCallbacks(repeat)
                }
                MotionEvent.ACTION_CANCEL -> {
                    view.isPressed = false
                    backspaceHandler.removeCallbacks(repeat)
                }
            }
            true
        }
        return key
    }

    /** Removes the query's last character; `false` when it was already
     * empty (which also ends a held backspace's repeat). */
    private fun deleteQueryChar(): Boolean {
        if (query.isEmpty()) return false
        query.deleteCharAt(query.length - 1)
        onQueryChanged()
        return true
    }

    private fun characterKey(char: String): Button {
        return specialKey(char.uppercase(), weight = 1f) {
            query.append(char)
            onQueryChanged()
        }
    }

    private fun specialKey(
        label: String,
        weight: Float = 1f,
        textSize: Float = KEY_LABEL_SP,
        onClick: () -> Unit,
    ): Button {
        return Button(context).apply {
            text = label
            this.textSize = textSize
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            setTextColor(SECONDARY_FOREGROUND)
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            // Zeroed out, not left at the theme's default Button padding —
            // that default reserves several dp on every side for the text,
            // which on a key this narrow was enough to clip wider labels
            // ("123", "ABC", "space", even some letters at smaller widths).
            // Spacing between keys already comes entirely from the margins
            // below, so the key's own interior can give all of it to text.
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight).apply {
                marginStart = dip(KEY_GAP_DP)
                marginEnd = dip(KEY_GAP_DP)
            }
            // Every text key on the keypad routes through this one builder,
            // so this is the single place a per-key tap "click" (haptic)
            // needs to be wired up. Respects the system's own
            // haptic-feedback setting (no override flags), same as a real
            // keyboard would.
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /** A keypad key showing a vector glyph (backspace, "+") instead of a
     * text character, whose look would vary by device font — same gradient
     * key shape and haptic as `specialKey`. `description` is what a screen
     * reader announces. */
    private fun iconKey(iconRes: Int, description: String, weight: Float, onClick: () -> Unit): ImageButton {
        return ImageButton(context).apply {
            setImageResource(iconRes)
            setColorFilter(SECONDARY_FOREGROUND)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            contentDescription = description
            minimumWidth = 0
            minimumHeight = 0
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(0, dip(10), 0, dip(10))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, weight).apply {
                marginStart = dip(KEY_GAP_DP)
                marginEnd = dip(KEY_GAP_DP)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /**
     * Commits `text` into the focused field, then stays open on this same
     * entry's detail view instead of switching back to the field's own
     * keyboard — per the "keep it active" request, a fill is a small,
     * repeatable action (Login's password right after its username, say),
     * not something that should minimize the picker the way actually
     * leaving it does. `returnToPreviousKeyboard()` is still what
     * `openVaultForFill()` and `finishDraft()` call, since those really are
     * the user stepping out of the picker.
     *
     * Re-renders the detail view afterwards so the "Filled!" button that
     * triggered this doesn't sit there checked (and disabled) forever, and
     * then calls `armPostFillTabAndPasswordCheck` — from the detail view or
     * from a result row's one-tap Fill on the search screen alike, never
     * once the user has moved on to creating an entry.
     */
    private fun finishFill(entry: FillEntry, field: FillField, text: String) {
        if (text.isEmpty()) return

        // Re-render and chain into "Fill, then Tab" once the value lands.
        // Deferred behind a lambda so the char-by-char path below can run it
        // only once the *last* character has actually committed, not the
        // moment the first one does.
        val afterCommit = {
            if (screen == Screen.DETAIL) renderResultsArea()
            if (screen != Screen.CREATE) armPostFillTabAndPasswordCheck(entry, field)
        }

        // See `commitCharByChar`'s own doc for why every field up to
        // `CHAR_BY_CHAR_MAX_LENGTH` goes through it rather than the single
        // bulk `onCommitText` call a longer value still gets.
        if (text.length <= CHAR_BY_CHAR_MAX_LENGTH) {
            commitCharByChar(text, afterCommit)
        } else {
            onCommitText(text)
            afterCommit()
        }
    }

    /**
     * Commits `text` one character at a time, each its own `commitText`
     * call a beat apart, instead of the one bulk call a longer value still
     * gets (see `CHAR_BY_CHAR_MAX_LENGTH`). Started life scoped to just
     * `monthYear`/`date` fields — a target field that auto-inserts its own
     * `/` as the user types an expiry or date is watching for exactly
     * this: one edit per keystroke. A single `commitText("0827")`
     * replaces the field's content in one shot; it doesn't look like four
     * keystrokes to whatever's listening, so its formatter never runs and
     * the digits land with no separator at all. Generalised to every field
     * under the length cap once it was clear the same "does this look like
     * real typing to the target" question applies just as well to any
     * other masked or validated field, not only a date — see
     * `docs/MANUAL-FILL-DESIGN.md`'s "Filling a masked field" section.
     *
     * Relies on `stop()`'s existing `uiHandler.removeCallbacksAndMessages`
     * to abort an in-flight sequence the moment the picker itself stops
     * (dismissed, app switched away, keyboard torn down) — the same
     * `uiHandler` this schedules its own delayed steps on. The one gap
     * that doesn't cover: focus moving to a *different* field without the
     * picker stopping. Narrow in practice and, like the similar gap
     * `armPostFillTabAndPasswordCheck`'s own doc discloses, judged not
     * worth chasing further for this pass.
     */
    private fun commitCharByChar(text: String, onDone: () -> Unit) {
        fun commitNext(index: Int) {
            if (index >= text.length) {
                onDone()
                return
            }
            onCommitText(text[index].toString())
            uiHandler.postDelayed({ commitNext(index + 1) }, CHAR_BY_CHAR_COMMIT_INTERVAL_MS)
        }
        commitNext(0)
    }

    private fun returnToPreviousKeyboard() {
        if (switchedAway) return
        switchedAway = true
        onSwitchToPreviousKeyboard()
    }

    /**
     * "Fill it, then Tab" — see `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then
     * Tab" section. Called right after an ordinary fill (never a
     * draft-pick fill — see `finishFill`'s own doc for why that flow is
     * left alone) has just committed `field`'s value. Sends Tab unless
     * `field` was a password or the entry's last field in display order
     * (see the guard's own comment); that half isn't conditioned on the
     * entry having a password at all. The second half is: if this entry
     * *does* have a fillable password field, this also arms
     * `pendingPostFillPasswordEntry` so the *next* `onEditorInfoChanged`
     * call — the signal that focus actually moved — can decide whether to
     * fill it too.
     *
     * `onEditorInfoChanged` itself, not this function, is what actually
     * checks whether the field Tab landed on is a password field — Android
     * lets an IME learn the newly-focused field's `EditorInfo` (via
     * `VaultIme.onStartInput`), it just can't get that answer
     * synchronously in the middle of sending the key event, hence the
     * arm-then-wait split. `clearPendingPostFillPasswordRunnable`,
     * scheduled here, is the backstop in case that signal never arrives.
     */
    private fun armPostFillTabAndPasswordCheck(entry: FillEntry, field: FillField) {
        // No Tab after a password (focus still on the field just filled —
        // `onStartInput` hasn't moved it yet) or after the entry's last
        // field in display order: the next thing is usually the form's
        // submit button, and Tab would just move focus somewhere unrelated
        // (a "Remember me" box, "Forgot password?").
        if (focusedFieldIsPassword || field.key == PASSWORD_FIELD_KEY) return
        if (detailFieldOrder(entry).lastOrNull()?.key == field.key) return
        onSendTab()
        if (entry.fields.none { it.key == PASSWORD_FIELD_KEY && it.fillable }) return
        uiHandler.removeCallbacks(clearPendingPostFillPasswordRunnable)
        pendingPostFillPasswordEntry = entry
        uiHandler.postDelayed(clearPendingPostFillPasswordRunnable, POST_FILL_TAB_TIMEOUT_MS)
    }

    /**
     * `VaultIme.onStartInput` calls this on every editor change — the
     * first field of a fresh show (before `onStartInputView`) and every
     * later focus change while the picker stays up. Always records whether
     * the newly focused field is a password field (`focusedFieldIsPassword`,
     * what the draft actions check before writing into the page).
     *
     * It's also the signal for the one right after
     * `armPostFillTabAndPasswordCheck` sent a Tab. If a password check is
     * currently armed, the arming is consumed unconditionally (whether or
     * not `info` actually turns out to be a password field), so an
     * unrelated, later focus change never wrongly retriggers it. Fetches and
     * fills the entry's password only when `info` really does look like a
     * password field — see `isPasswordInputType`.
     */
    fun onEditorInfoChanged(info: EditorInfo?) {
        focusedFieldIsPassword = isPasswordInputType(info)
        // Focus moved: Clear's undo would now type into a different field.
        if (clearUndoText != null) endClearUndo()
        val entry = pendingPostFillPasswordEntry ?: return
        pendingPostFillPasswordEntry = null
        uiHandler.removeCallbacks(clearPendingPostFillPasswordRunnable)
        if (!isPasswordInputType(info)) return
        entrySource.readField(entry.id, PASSWORD_FIELD_KEY) { value ->
            if (value.isNullOrEmpty()) return@readField
            onCommitText(value)
            // Say so: flash the Password row's Fill chip, as if it had been
            // tapped — silently filling a second field read as magic, or
            // went unnoticed (`docs/IME-UX-REVIEW.md` P9).
            if (screen == Screen.DETAIL && selectedEntryId == entry.id) {
                autoFilledFieldKey = PASSWORD_FIELD_KEY
                renderResultsArea()
                uiHandler.postDelayed({
                    autoFilledFieldKey = null
                    if (screen == Screen.DETAIL) renderResultsArea()
                }, FILLED_REVERT_MS)
            }
        }
    }

    /**
     * Whether `info` describes a password-variation field — the same
     * signal a screen reader or another IME would use, checked across both
     * the text and numeric input classes (a PIN-style password field is
     * `TYPE_CLASS_NUMBER` with `TYPE_NUMBER_VARIATION_PASSWORD`, not
     * `TYPE_CLASS_TEXT`). `TYPE_TEXT_VARIATION_VISIBLE_PASSWORD` is
     * included alongside the masked variations — a field a form has
     * chosen to show in cleartext (an "eye" toggle left open, one shown
     * unmasked by default) is still the password field.
     */
    private fun isPasswordInputType(info: EditorInfo?): Boolean {
        val inputType = info?.inputType ?: return false
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (inputType and InputType.TYPE_MASK_CLASS) {
            InputType.TYPE_CLASS_TEXT ->
                variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                    variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                    variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun dip(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()
}

/** What `VaultKeyboardView` needs to know about the vault — real
 * entries and field values in production, canned sample data in the
 * preview. Same shape as `WebViewBridge`'s functions, deliberately — see
 * `WebViewBridgeEntrySource` below. The draft functions (added alongside
 * the fill-only ones for streamlined account creation, see
 * `docs/ACCOUNT-CREATION-DESIGN.md`) follow the same fire-and-forget-or-
 * callback shape as everything above them. */
interface EntrySource {
    fun listEntries(callback: (List<FillEntry>) -> Unit)
    fun readField(entryId: String, key: String, callback: (String?) -> Unit)
    /** A Login entry's site icon for its result row — see
     * `VaultKeyboardView.buildAvatar`. */
    fun readIcon(entryId: String, callback: (SiteIconResult) -> Unit)
    /** Fire-and-forget — see `VaultKeyboardView.lockVault`'s doc for
     * why the caller doesn't wait on this before updating its own view. */
    fun lockVault()

    /** Every selectable entry type, for the creation panel's "Type" row —
     * see `docs/ACCOUNT-CREATION-DESIGN.md`'s "Any entry type" revision.
     * Independent of any draft being active. */
    fun listEntryTypes(callback: (List<EntryTypeOption>) -> Unit)
    /** Fire-and-forget. */
    fun startDraft(titleGuess: String)
    /** Fire-and-forget: switches the in-progress draft to a different
     * type — see `VaultCreateBridge.setDraftType`'s doc on the JS
     * side for what happens to any values already filled in. */
    fun setDraftType(type: String)
    fun getDraft(callback: (DraftSnapshot?) -> Unit)
    fun generateDraftPassword(callback: (String?) -> Unit)
    /** Changes the draft's generator settings and immediately regenerates
     * with them, handing back the fresh plaintext. */
    fun setDraftPasswordOptions(options: PasswordOptions, callback: (String?) -> Unit)
    /** Previously-used email addresses, for the creation panel's Email
     * field (a "Pick from Vault"-style shortcut, but of past emails rather
     * than saved entries). */
    fun listKnownEmails(callback: (List<String>) -> Unit)
    /** Fire-and-forget. */
    fun setDraftField(key: String, value: String)
    fun commitDraft(callback: (Boolean) -> Unit)
    /** Fire-and-forget. */
    fun cancelDraft()
}

/** Adapts the real `WebViewBridge` singleton to `EntrySource` — kept as a
 * separate object rather than making `WebViewBridge` itself implement the
 * interface, so this refactor doesn't have to touch (or risk) that file at
 * all. */
object WebViewBridgeEntrySource : EntrySource {
    override fun listEntries(callback: (List<FillEntry>) -> Unit) = WebViewBridge.listEntries(callback)
    override fun readField(entryId: String, key: String, callback: (String?) -> Unit) =
        WebViewBridge.readField(entryId, key, callback)
    override fun readIcon(entryId: String, callback: (SiteIconResult) -> Unit) =
        WebViewBridge.readIcon(entryId, callback)
    override fun lockVault() = WebViewBridge.lockVault()

    override fun listEntryTypes(callback: (List<EntryTypeOption>) -> Unit) = WebViewBridge.listEntryTypes(callback)
    override fun startDraft(titleGuess: String) = WebViewBridge.startDraft(titleGuess)
    override fun setDraftType(type: String) = WebViewBridge.setDraftType(type)
    override fun getDraft(callback: (DraftSnapshot?) -> Unit) = WebViewBridge.getDraft(callback)
    override fun generateDraftPassword(callback: (String?) -> Unit) = WebViewBridge.generateDraftPassword(callback)
    override fun setDraftPasswordOptions(options: PasswordOptions, callback: (String?) -> Unit) =
        WebViewBridge.setDraftPasswordOptions(options, callback)
    override fun listKnownEmails(callback: (List<String>) -> Unit) = WebViewBridge.listKnownEmails(callback)
    override fun setDraftField(key: String, value: String) = WebViewBridge.setDraftField(key, value)
    override fun commitDraft(callback: (Boolean) -> Unit) = WebViewBridge.commitDraft(callback)
    override fun cancelDraft() = WebViewBridge.cancelDraft()
}
