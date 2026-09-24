package com.passhandler.app

import android.animation.LayoutTransition
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.text.SpannableString
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.FrameLayout
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
        // Foreground at 50% alpha — was a separately-sampled blue-navy hue,
        // now literally the same family as `FOREGROUND`, just dimmer,
        // matching every "muted" text on the real Android app (always
        // `text-[#d6e4ef]/50`, never a genuinely different hue). Kept as
        // its own named constant despite being derived, same reasoning
        // `ACCENT_FOREGROUND`/`BACKGROUND` used to share below.
        private val MUTED_FOREGROUND = Color.parseColor("#80D6E4EF")
        private val FOREGROUND = Color.parseColor("#D6E4EF") // no change — already correct
        // Foreground at ~50% alpha — used for the search box's placeholder.
        private val PLACEHOLDER = Color.parseColor("#80D6E4EF") // no change — already correct
        // Same value as the web app's `ok` Tailwind token (`#4ade80`,
        // `tailwind.config.js`), so the one "it worked" color matches
        // across the Windows/Android webview and this native keyboard —
        // still true after the palette migration, no change needed. Not
        // the same as the *newer*, more muted `--vault-ok` (`#6fbf8b`) that
        // exists alongside it in the web app's own token set — this
        // matches the brighter, older `ok` specifically, which is what the
        // IME's one prior author actually sourced it from.
        private val SUCCESS = Color.parseColor("#4ADE80") // no change — already correct
        // `ACCENT`/`ACCENT_FOREGROUND` (the blue `#4A9EE0`/`#0C1827` pair)
        // are gone — they were sourced from a since-superseded reference
        // project's abstract `--accent` token, applied to this flow's own
        // "Add Entry" key on the theory that "primary action" meant blue.
        // The real Android app's own "Add entry" button
        // (`BottomTabBar.tsx:138`) says otherwise: it's a warm copper/coral
        // gradient (`#bb8c7a`→`#ac6e55`, border `#b98d7c`, text `#241a16`),
        // not blue — and `#241a16` is the exact same hex as this file's own
        // `CREATE_BG`/`CREATE_ACCENT_TEXT` below, so "Add Entry" and the
        // create-flow it leads into already read as one coherent coral
        // identity on the real app, not two unrelated colors. `ADD_ENTRY_*`
        // below replaces `ACCENT`/`ACCENT_FOREGROUND` with that real value
        // instead of guessing a vault-blue equivalent that turned out not
        // to exist.
        private val ADD_ENTRY_TOP = Color.parseColor("#bb8c7a")
        private val ADD_ENTRY_BOTTOM = Color.parseColor("#ac6e55")
        private val ADD_ENTRY_BORDER = Color.parseColor("#b98d7c")
        private val ADD_ENTRY_TEXT = Color.parseColor("#241a16")

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
        // above). The hex values below are unchanged from that first,
        // pixel-sampled choice — see `docs/ime-ux-redesign-proposal.md` for
        // the sampled values and where each one was taken from — only the
        // *shape* of the buttons built from them changes, to the same
        // gradient-pill recipe as everywhere else, recolored in this same
        // coral family: `CREATE_GRADIENT_TOP`/`CREATE_GRADIENT_BOTTOM`
        // below, a lightened/darkened pair derived from `CREATE_ACCENT`,
        // stand in for the neutral recipe's `#3f454a`/`#32373d`.
        // Scoped deliberately narrow, unchanged: only
        // `buildCreatePanel`/`buildDraftFieldRow` use these constants;
        // `buildDetailView`/`smallActionButton` (the DETAIL screen's own
        // field rows) are unaffected, still on the shared palette above —
        // "the IME new entry flow" is what this was scoped to, not the
        // whole IME.
        private val CREATE_BG = Color.parseColor("#241A16")
        private val CREATE_BORDER = Color.parseColor("#4A352D")
        private val CREATE_ACCENT = Color.parseColor("#E0A087")
        // Dark text/glyph color drawn on top of an `CREATE_ACCENT` fill
        // (the pill buttons, the checkmark glyph on its filled button) —
        // happens to equal `CREATE_BG`'s value, same coincidence
        // `ACCENT_FOREGROUND`/`BACKGROUND` used to share above, same
        // reasoning for keeping it a separate named constant.
        private val CREATE_ACCENT_TEXT = Color.parseColor("#241A16")
        // The muted tan used for each field's "TITLE"-style label — warmer
        // and slightly more saturated than `CREATE_CHEVRON` below; sampled
        // as a visually distinct color in the reference image, not a
        // rendering artifact of the same one.
        private val CREATE_MUTED = Color.parseColor("#A8887C")
        // The back chevron's own muted color — cooler/greyer than
        // `CREATE_MUTED`, sampled separately for the same reason.
        private val CREATE_CHEVRON = Color.parseColor("#A7A3A2")
        private val CREATE_FG = Color.parseColor("#FFFFFF")
        // The coral gradient's two stops, standing in for the neutral
        // recipe's `#3f454a`/`#32373d` — lightened/darkened from
        // `CREATE_ACCENT` (`#E0A087`) by the same rough proportion the
        // neutral pair's own top/bottom stops sit apart, rather than a
        // second independently-sampled value (there is no second reference
        // screenshot for a "pressed"/gradient state of this color to
        // sample from). Approximate by construction — see this button's
        // own call site for how to eyeball-correct it against
        // `VaultImePreviewActivity` once a real build can render it.
        private val CREATE_GRADIENT_TOP = Color.parseColor("#e8b49c")
        private val CREATE_GRADIENT_BOTTOM = Color.parseColor("#cf8a6c")

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

        // How long a tapped button's "✓ Filled!" acknowledgement stays up
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

        // How long `armPostFillTabAndPasswordCheck` waits for
        // `onEditorInfoChanged` to report the field Tab landed on before
        // giving up. Generous relative to how quickly a focus change
        // actually round-trips through the target app and back to this
        // IME, so it isn't the thing that misses a real one; short enough
        // that a target that never reports back (or wasn't listening for
        // Tab at all) doesn't leave this armed against some unrelated,
        // much later focus change.
        private const val POST_FILL_TAB_TIMEOUT_MS = 1_500L

        // Results-region heights — the three values `setResultsHeight` ever
        // sets it to. SEARCH_HEIGHT_DP is used for every search-mode
        // sub-state alike (empty query, matches, no matches) specifically
        // so none of them change the region's height — see the class doc.
        private const val SEARCH_HEIGHT_DP = 120 // ~2.5 rows of matches
        // A selected entry's fields — sized to roughly SEARCH_HEIGHT_DP plus
        // the search-and-keypad unit's own height, so the results region
        // actually fills the space the keypad freed up when it hides,
        // instead of leaving a visible gap of bare background underneath.
        // Was 340 while the whole keypad hid behind the detail view; now
        // one action row ("New search") stays visible instead — see
        // `updateBottomRowsForScreen` — so ~40dp less space is actually
        // freed, and this was pulled down to match.
        private const val DETAIL_HEIGHT_DP = 300
        // `Screen.CREATE`'s own height. Used to share `DETAIL_HEIGHT_DP`
        // back when the account-creation panel still had its own
        // `createActionsRow` (Cancel/Done) staying visible on the keypad,
        // same as `Screen.DETAIL`'s "New search" row does. Cancel/Done have
        // since moved into `buildCreatePanel`'s own header (per
        // `EntryEditor.tsx`'s literal Cancel/title/Done placement — see
        // that function's doc), so nothing on the keypad stays visible for
        // this screen any more — the whole keypad hides, same case
        // `DETAIL_HEIGHT_DP`'s own comment describes as the original,
        // pre-reduction 340.
        private const val CREATE_HEIGHT_DP = 340

        // The top bar's fixed height — a direct request
        // (`docs/ime-ux-redesign-proposal.md`'s later revision). Used to be
        // implicit (`WRAP_CONTENT` plus 7dp vertical padding around a 12sp
        // label); now explicit so Lock/logo/Clear-field's own clearances
        // (see `buildTopBar`) have a fixed bar height to measure against.
        // 44dp, not 40 — that same doc's own touch-target rule ("keep the
        // tap target's touchable area at least 44dp") wasn't actually met at
        // 40dp once Lock/Clear-field's 4dp top/bottom margins were
        // subtracted (32dp clickable, not 44) — see docs/UI-UX-REVIEW.md's
        // top findings #2. Both buttons now use the full bar height with no
        // margins (below) instead, so MATCH_PARENT resolves to exactly this
        // value.
        private const val TOP_BAR_HEIGHT_DP = 44

        // The thin "handle" bar between the results region and the search
        // box — visually marks the seam between the two, and its grip pill
        // signals the search-box-and-keypad unit as one draggable-feeling
        // block even though nothing here actually drags.
        private const val HANDLE_BAR_HEIGHT_DP = 10

        // Keys were 42dp tall, then 34dp, then 36dp, then 38dp; bumped up
        // 4dp more per the layout-v2 "roomier" pass
        // (`docs/ime-layout-v2-and-grab-design.md`).
        private const val KEY_ROW_HEIGHT_DP = 42
        // 3dp margin on each side of a key = 6dp horizontal gap between
        // two adjacent keys. History: 2 → 3 → 5 → 4 → 3dp — each step
        // chased the same "text is legible again, the gap can afford to
        // give a little width back" tradeoff.
        private const val KEY_GAP_DP = 3
        // Vertical clearance between one keypad row and the next. Used to
        // just reuse KEY_GAP_DP × 2 (= 6dp) — split into its own constant
        // and bumped +2dp, since horizontal and vertical spacing were
        // asked to change independently of each other.
        private const val ROW_GAP_DP = 8
        // Horizontal clearance from the screen edges for the ASDFGHJKL
        // row only — it has one fewer key than the QWERTYUIOP row above
        // it, so without this it sits flush against both edges while the
        // row above and the toggle/backspace row below don't, reading as
        // misaligned rather than intentionally offset.
        private const val SECOND_ROW_INSET_DP = 18
        // Fixed clearance below the whole unit for the OS's own gesture bar
        // / nav buttons — present whether or not the keypad itself is
        // showing.
        private const val BOTTOM_INSET_DP = 48

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
    // via the "Split N/4" chip (see `performChunkFill`) — 0..4, where 4
    // means fully filled (whether via "Fill all" or by tapping through
    // every chunk). Reset alongside `revealedFields` whenever the selected
    // entry changes, same lifetime — and also back to 0 on its own,
    // `FILLED_REVERT_MS` after the disabled "✓ Filled" row that 4 shows
    // first appears, so the row comes back clickable instead of staying
    // stuck (see `scheduleCardFilledRevert`).
    private var cardChunkProgress = 0

    // Whether `revertCardFilledRunnable` is currently queued on `uiHandler`
    // — the guard that keeps every re-render during the "✓ Filled" window
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
    // `CREATE_HEIGHT_DP`. View state only — never persisted; cleared by
    // `closeDraftPanels` wherever a draft session ends or restarts.
    private var openDraftPanelKey: String? = null

    // The email list's contents, fetched from `entrySource.listKnownEmails`
    // each time the list is opened. `null` while that fetch is in flight
    // (the panel shows "Loading…" rather than a premature "No saved emails
    // yet").
    private var draftKnownEmails: List<String>? = null

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

    // Set by `grabIntoDraftField` when `onGrabFromField` came back
    // empty/blank — a brief inline note in `buildCreatePanel`, cleared on
    // the next successful grab or whenever the draft flow (re)starts, so it
    // never survives into a later, unrelated draft session.
    private var draftGrabMessage: String? = null

    // ── Quick-fill ranking (docs/QUICK-FILL-RANKING-DESIGN.md) ──────────

    // The focused field's calling app, read once per show from
    // `EditorInfo.packageName` — see `setDetectedContext`'s third
    // parameter and `VaultIme.onStartInputView`. Empty when no
    // `EditorInfo` was available (e.g. the preview activity, unless it
    // supplies one). `QuickFillUsage`/`QuickFillRanking` both treat an
    // empty package as "no frecency signal" rather than a real scope, so
    // this never needs its own null-check at each call site.
    private var callingPackage: String = ""

    // Captured in `stop()`, restored once in `buildRootView()` — see that
    // function's own note — so reopening the keyboard on the same field
    // resumes scrolled to where the user left off, same as the search
    // text and selection do.
    private var savedScrollY: Int = 0

    private lateinit var resultsContainer: LinearLayout
    private lateinit var resultsScroll: ScrollView
    private lateinit var queryText: TextView
    // The search box row and the hairline divider just below it — hidden,
    // along with the letter keys, whenever `screen` isn't `Screen.SEARCH`;
    // see `updateBottomRowsForScreen`. `buildHandleBar()`'s bar (above
    // these two in the view tree) stays visible either way and doubles as
    // the "spacer" between an expanded DETAIL/CREATE region and whichever
    // bottom row is showing in that state.
    private lateinit var searchBoxRow: View
    private lateinit var searchDivider: View
    private lateinit var keyboardContainer: LinearLayout
    private lateinit var keysArea: LinearLayout
    // The keypad's own last row (space, full width), and the two rows that
    // take its place for `Screen.DETAIL` ("New search") and
    // `Screen.CREATE` (Cancel / Done) respectively — see
    // `updateBottomRowsForScreen`. Exactly one of the three is ever
    // visible. Lock and the "fix a mistake" clear-field key used to open
    // each of these rows (Lock / ✕ / ...) — both moved to the top bar
    // instead, per `docs/ime-ux-redesign-proposal.md`: everything that's
    // actually left in these rows writes into the search box or navigates
    // this picker's own screens, never into the host app's field, and
    // Lock/Clear-field being screen-independent utilities belongs with
    // `buildTopBar`'s other always-visible chrome, not repeated on three
    // separate rows.
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
     * Search text, entry selection, and scroll position deliberately do
     * NOT reset here — see `docs/QUICK-FILL-RANKING-DESIGN.md`'s "Session
     * persistence": switching apps mid-fill (to check something, copy a
     * value, whatever) and coming back should resume exactly where the
     * user left off, the same way the account-creation draft below already
     * does. `screen` is left alone too — if it was `Screen.DETAIL` on a
     * still-valid entry, it stays there; `renderResultsArea`'s own
     * staleness guard falls back to search if that entry disappeared while
     * this was closed (relocked, deleted from another device), so there's
     * no need to re-check that here. `revealedFields` is the one exception
     * that still clears unconditionally — a shown sensitive value is a
     * shoulder-surf risk `REVEAL_SECONDS` already guards against within a
     * single show; there's no reason to extend that exposure across a
     * dismiss-and-reopen too.
     *
     * An in-progress account-creation draft is the other piece of state
     * that was already surviving a dismiss/reopen before this — see
     * `docs/ACCOUNT-CREATION-DESIGN.md`'s "Session lifetime". This fetches
     * whatever `entrySource.getDraft` currently says and forces
     * `Screen.CREATE` if it's non-null, rather than forcing the user to tap
     * "+" again. */
    fun start() {
        isActive = true
        keyboardMode = KeyboardMode.LETTERS
        closeDraftPanels()
        revealedFields.clear()
        switchedAway = false
        viewMode = ViewMode.LOADING
        onViewChanged(buildLoadingView())
        entrySource.listEntries { entries ->
            allEntries = entries
            entrySource.getDraft { draft ->
                currentDraft = draft
                if (draft != null) screen = Screen.CREATE
                render()
            }
        }
        startAutoRefresh()
        startCursorBlink()
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
     * way. */
    fun setDetectedContext(titleGuess: String, likelySignup: Boolean, packageName: String) {
        detectedTitleGuess = titleGuess
        likelySignupField = likelySignup
        callingPackage = packageName
    }

    /** Call whenever the picker stops being shown — the user dismissed the
     * keyboard, switched apps, moved to a field that doesn't want a
     * keyboard, the preview activity is being destroyed, or (via this
     * class's two remaining `returnToPreviousKeyboard()` call sites)
     * opened Vault to unlock, or tapped "Done" on the
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
        // `removeCallbacksAndMessages` above cancels the timeout Runnable if
        // it's still pending, but doesn't itself reset the field it guards
        // — same for the card "✓ Filled" revert's own scheduled flag, so a
        // picker reopened while that state is still up re-arms it.
        pendingPostFillPasswordEntry = null
        cancelCardFilledRevert()
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

    fun buildLoadingView(): View {
        return TextView(context).apply {
            text = "Loading…"
            gravity = Gravity.CENTER
            setTextColor(FOREGROUND)
            setBackgroundColor(BACKGROUND)
            setPadding(dip(24), dip(32), dip(24), dip(32))
        }
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
        // hand-rolled ValueAnimators.
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
        resultsScroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0)
            setBackgroundColor(CARD)
        }
        resultsScroll.addView(resultsContainer)
        root.addView(resultsScroll)

        root.addView(buildHandleBar())
        root.addView(buildSearchAndKeypadUnit())
        root.addView(bottomInsetSpacer())

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

        return root
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
     * same request — the logo now carries the app identity, and Lock's own
     * `SUCCESS`-tinted icon is what's left to signal "unlocked," with no
     * text alongside it any more.
     */
    private fun buildTopBar(): View {
        val bar = FrameLayout(context).apply {
            // BACKGROUND, not CARD — this bar sits on the dock's own base
            // color, same as the handle bar and search-and-keypad unit
            // below it. Only the results/detail region above gets the
            // lighter CARD "panel" treatment.
            setBackgroundColor(BACKGROUND)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(TOP_BAR_HEIGHT_DP))
        }
        bar.addView(buildTopBarLockButton())
        bar.addView(buildTopBarLogo())
        bar.addView(buildTopBarClearFieldButton())
        return withBottomBorder(bar)
    }

    /**
     * The vault's lock state and the control that locks it. Used to carry
     * an "Unlocked" text label beside the icon; dropped per direct request
     * to remove that label (and the "Vault" text beside it) from
     * the top bar entirely. `R.drawable.ic_lock` tinted `SUCCESS` via
     * `setColorFilter` is the only "unlocked" signal left, and it stays for
     * exactly that reason — see `buildTopBar`'s own doc.
     *
     * 20dp from the screen's left edge, full `TOP_BAR_HEIGHT_DP` (44dp) tall
     * and wide — no top/bottom margins any more (see that constant's own
     * doc on why: the previous 4dp margins ate into the 44dp floor the
     * redesign doc itself calls for). The icon's own rendered size stays
     * what it was at the old 32dp box — 24dp content square (padding 10dp a
     * side inside the 44dp box).
     *
     * The whole 44dp box is now a visible gradient pill, the same recipe as
     * the main app's Android home-header Lock/Settings buttons
     * (`VaultScreen.tsx`: `#3f454a` to `#32373d`, 1px `#565656` border, 5px
     * radius, soft shadow, itself exactly 44 by 44) — it used to be a bare,
     * borderless icon. The icon keeps its `SUCCESS` tint (the IME's
     * "unlocked" signal) rather than the home header's plain white.
     */
    private fun buildTopBarLockButton(): View {
        return ImageButton(context).apply {
            setImageResource(R.drawable.ic_lock)
            setColorFilter(SUCCESS)
            scaleType = ImageView.ScaleType.FIT_CENTER
            minimumWidth = 0
            minimumHeight = 0
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(10), dip(10), dip(10), dip(10))
            contentDescription = "Lock vault"
            layoutParams = FrameLayout.LayoutParams(dip(TOP_BAR_HEIGHT_DP), ViewGroup.LayoutParams.MATCH_PARENT).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                marginStart = dip(20)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                lockVault()
            }
        }
    }

    /**
     * The Home screen wordmark (keyhole plus "Vault" lettering), centered in
     * the top bar — the same logo, at the same 101 by 42dp size, the main
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
     * right, per direct request, with a text "Clear" label instead of the
     * circled-X icon this used to show. Same gradient pill as Lock and the
     * main app's home-header buttons (see Lock's own doc) — it used to be
     * bare `MUTED_FOREGROUND` text on purpose (a rare, destructive action,
     * kept quieter than Lock), but a filled pill has no such thing as
     * "quiet", so the label is `SECONDARY_FOREGROUND` like every other
     * gradient-pill chip's. 20dp from the
     * screen's right edge (mirroring Lock's 20dp on the left, for a
     * balanced frame around the centered logo), full `TOP_BAR_HEIGHT_DP`
     * (44dp) tall now — no top/bottom margins, same reasoning as Lock's own
     * doc. `minWidth` (44dp) is the one addition here Lock didn't need: a
     * `WRAP_CONTENT` text label has no fixed box to widen in lockstep with
     * padding the way Lock's fixed-width icon box did, so this guarantees
     * the 44dp floor directly regardless of how wide "Clear" happens to
     * render at 12sp.
     */
    private fun buildTopBarClearFieldButton(): View {
        return TextView(context).apply {
            text = "Clear"
            textSize = 12f
            setTextColor(SECONDARY_FOREGROUND)
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(6), dip(4), dip(6), dip(4))
            minWidth = dip(TOP_BAR_HEIGHT_DP)
            minimumWidth = dip(TOP_BAR_HEIGHT_DP)
            contentDescription = "Clear field"
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                marginEnd = dip(20)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClearField()
            }
        }
    }

    /** The seam between the results region and the search-box-and-keypad
     * unit below it — a small bar with a centered grip pill, distinct from
     * (and shorter than) the top bar above the results. */
    private fun buildHandleBar(): View {
        val bar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(BACKGROUND)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(HANDLE_BAR_HEIGHT_DP))
        }
        val grip = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(dip(32), dip(3))
            background = filledRoundedRect(BORDER, 2)
        }
        bar.addView(grip)
        return withBottomBorder(bar)
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
        val outer = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(14), dip(10), dip(14), dip(10))
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
            setPadding(dip(16), dip(12), dip(16), dip(12))
            setOnClickListener { returnToSearch() }
        }

        queryText = TextView(context).apply {
            textSize = 16f
        }
        pill.addView(queryText)

        // MATCH_PARENT — this row's only child. "+"/"Add Entry" used to sit
        // beside it; per direct request it now sits on `spaceRow` instead,
        // beside "space" — see that row's own build call in `buildKeyboard`
        // — so the pill goes back to filling the whole row on its own.
        outer.addView(pill, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

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
                setResultsHeight(CREATE_HEIGHT_DP)
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
                setResultsHeight(DETAIL_HEIGHT_DP)
                resultsContainer.addView(buildDetailView(entry))
            }
            Screen.SEARCH -> {
                setResultsHeight(SEARCH_HEIGHT_DP)
                if (query.isEmpty()) {
                    val recents = QuickFillRanking.recents(context, callingPackage, allEntries)
                    if (recents.isNotEmpty()) {
                        resultsContainer.addView(buildSectionLabel("Recent"))
                        for (entry in recents) resultsContainer.addView(buildResultRow(entry))
                    }
                } else {
                    val ranked = QuickFillRanking.rank(context, callingPackage, query.toString(), allEntries)
                    if (ranked.isEmpty()) {
                        resultsContainer.addView(buildMessageRow("No matches."))
                    } else {
                        for (entry in ranked) resultsContainer.addView(buildResultRow(entry))
                    }
                }
            }
        }
    }

    private fun setResultsHeight(dpValue: Int) {
        val params = resultsScroll.layoutParams
        params.height = dip(dpValue)
        resultsScroll.layoutParams = params
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

    /** One search result: a small avatar plus the title, in its own rounded
     * box — the box itself (visible at rest, not just while pressed) is the
     * tap-area affordance now, in place of a trailing chevron. Tapping
     * selects the entry, hides the keypad, and switches the results region
     * to that entry's details. Also used for the empty-query "Recent"
     * list — same row, same tap behaviour, just a different set of entries
     * feeding it. */
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
            // own box (visual-parity pass; was 8dp).
            background = filledRoundedRect(CARD, 10)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                leftMargin = dip(12)
                rightMargin = dip(12)
                topMargin = dip(5)
                bottomMargin = dip(5)
            }
            // 14/13/14/13 → 16/16/16/16 — roomier per the layout-v2 pass
            // (`docs/ime-layout-v2-and-grab-design.md`).
            setPadding(dip(16), dip(16), dip(16), dip(16))
        }

        row.addView(buildAvatar(entry))

        val title = TextView(context).apply {
            text = entry.title.ifEmpty { "Untitled" }
            setTextColor(FOREGROUND)
            textSize = 16f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        row.addView(title)

        row.setOnClickListener {
            selectedEntryId = entry.id
            screen = Screen.DETAIL
            revealedFields.clear()
            cardChunkProgress = 0
            cancelCardFilledRevert()
            expiryFormatSwapped = false
            updateBottomRowsForScreen()
            updateQueryDisplay()
            renderResultsArea()
        }

        return row
    }

    // Visual-parity pass: replaces the old six-hue `AVATAR_COLORS`
    // Tailwind approximation (rose/amber/lime/teal/sky/violet at ~20%
    // alpha, a distinct text tint per hue) with the real current mechanism
    // it used to (mis-)cite — `EntryList.tsx`'s own `PEG_COLORS`/
    // `pegColor`/`PEG_FOREGROUND`: eight solid hues, one shared foreground
    // for all of them, not a per-hue text pair. Same hex values as the web
    // source, not re-sampled.
    private val PEG_COLORS: List<Int> = listOf(
        Color.parseColor("#c9835f"), // terracotta
        Color.parseColor("#c7a23f"), // brass
        Color.parseColor("#8caf5f"), // moss
        Color.parseColor("#5fac93"), // teal-green
        Color.parseColor("#9a8fc9"), // steel violet
        Color.parseColor("#c97ba3"), // rose plum
        Color.parseColor("#9aa3ad"), // slate
        Color.parseColor("#c9955f"), // ochre amber
    )
    private val PEG_FOREGROUND = Color.parseColor("#0a0d10")

    /** No favicon fetching on this side — no network access from the IME,
     * and `FillEntry` carries no icon URL to fetch even if there were, see
     * its own doc — so a search/recents row always shows the same
     * fallback the real app's own `EntrySiteIcon` shows when it has no
     * favicon either: a globe for a Login entry, an initial-letter circle
     * for anything else. `pegColorFor`'s hash-to-palette scheme mirrors
     * `EntryList.tsx`'s `pegColor` directly (see `PEG_COLORS`'s own doc) —
     * not necessarily bit-for-bit, since JS's `>>> 0` and Kotlin's `Int`
     * overflow don't produce identical hashes — a cosmetic difference, not
     * a correctness one.
     *
     * Bug found during the visual-parity icon audit, fixed here: this used
     * to always show the initial-letter fallback, for every entry
     * including Login — `ic_globe.xml` was fully drawn and documented as
     * "used by `buildAvatar` in place of a Login entry's first-letter
     * initial," but nothing actually branched on `entry.type` to use it.
     * `EntryTypeIcon`-per-type coverage for every OTHER entry type (card,
     * note, wifi, …) — matching `EntrySiteIcon`'s own non-Login fallback
     * exactly — is a larger, separate undertaking (transcribing a whole
     * icon set), out of scope for this pass; Login-vs-everything-else is
     * the one distinction `ic_globe.xml` was already built for. */
    private fun buildAvatar(entry: FillEntry): View {
        val bg = pegColorFor(entry.title.ifEmpty { entry.id })
        val isLogin = entry.type == "login"
        return FrameLayout(context).apply {
            background = filledOval(bg)
            layoutParams = LinearLayout.LayoutParams(dip(36), dip(36)).apply {
                marginEnd = dip(10)
            }
            if (isLogin) {
                addView(ImageView(context).apply {
                    setImageResource(R.drawable.ic_globe)
                    setColorFilter(PEG_FOREGROUND)
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    layoutParams = FrameLayout.LayoutParams(dip(20), dip(20)).apply {
                        gravity = Gravity.CENTER
                    }
                })
            } else {
                val label = entry.title.trim().ifEmpty { "?" }.first().uppercaseChar().toString()
                addView(TextView(context).apply {
                    text = label
                    setTextColor(PEG_FOREGROUND)
                    textSize = 14f
                    gravity = Gravity.CENTER
                    setTypeface(typeface, Typeface.BOLD)
                    layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                })
            }
        }
    }

    private fun pegColorFor(seed: String): Int {
        var hash = 0
        for (c in seed) hash = hash * 31 + c.code
        val index = ((hash % PEG_COLORS.size) + PEG_COLORS.size) % PEG_COLORS.size
        return PEG_COLORS[index]
    }

    // ── Account-creation panel ──────────────────────────────────────────
    // See `docs/ACCOUNT-CREATION-DESIGN.md`. Same visual shape as
    // `buildDetailView`/`buildDetailFieldRow` just below (a header, one row
    // per field) — deliberately: this panel is doing the same job for a
    // not-yet-saved entry that those do for a saved one.

    /** The account-creation panel: chevron / title (left-aligned, not
     * centered) / outline-X / filled-checkmark — sampled directly from a
     * screenshot of the actual intended design (no source file for it is
     * connected to this session; see `CREATE_BG`'s own doc for why that
     * screenshot superseded the two earlier, wrong guesses). The chevron
     * and the outline-X both discard the draft (`cancelDraftFlow`) — two
     * affordances for the one "back out of this" action, matching the
     * screenshot's layout without inventing a third distinct behavior this
     * flow has no real use for; the filled checkmark commits it
     * (`finishDraft`), same as this flow's "Done" always has. Cancel/Done
     * used to be `createActionsRow`, a row on the keypad below; both moved
     * up into this header instead, so the keypad shows nothing at all for
     * `Screen.CREATE` any more — see `CREATE_HEIGHT_DP`. Followed by the
     * quiet-bias subtitle (`likelySignupField`) and one row per field the
     * *current draft type* has — `draft.fields`, in registry order, not a
     * hardcoded Login-only list; see `docs/ACCOUNT-CREATION-DESIGN.md`'s
     * "Any entry type" revision and `DraftSnapshot`'s own doc. `draft` is
     * only ever `null` for one render's worth of time, between
     * `startCreatingDraft` switching `screen` and its `entrySource.getDraft`
     * callback actually returning — rendered as no field rows at all for
     * that one render, same as a real empty `fields` list would look.
     *
     * Restored to this generic shape after a regression: an intervening
     * edit (outside this session) had reverted this function and
     * `buildDraftFieldRow` to a hardcoded, Login-only five-field version —
     * a `draftFieldLabels` constant plus direct `draft.username`/`.email`/
     * `.password`/`.url`/`.notes` access — which no longer compiled at all,
     * since `DraftSnapshot` dropped those flat properties when it moved to
     * `fields` for the "Any entry type" work. Fixed by restoring the
     * `draft.fields`-driven loop, not by patching the broken property
     * access in place — the flat-property version would have compiled
     * (via a `fields.find { it.key == key }` lookup) but stayed
     * functionally Login-only, silently showing no fields at all for any
     * other draft type. */
    private fun buildCreatePanel(draft: DraftSnapshot?): View {
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(CREATE_BG)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(16), dip(12), dip(16), dip(12))
        }
        // Same "‹" glyph and size `buildDetailView`'s own back chevron
        // uses, just recolored — this screen's chevron is one of its two
        // "cancel" affordances, not real back-stack navigation (the IME
        // has no navigation stack to speak of here).
        val chevron = TextView(context).apply {
            text = "‹"
            // `docs/UI-UX-REVIEW.md` finding #1 (IME section): icon-only,
            // previously unlabeled for TalkBack — unlike the close-field's
            // top-bar Lock/Clear buttons, which already had one each.
            contentDescription = "Back"
            setTextColor(CREATE_CHEVRON)
            textSize = 27f
            isClickable = true
            isFocusable = true
            setPadding(0, 0, dip(6), 0)
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                cancelDraftFlow()
            }
        }
        header.addView(chevron)
        val title = TextView(context).apply {
            text = draft?.title?.ifEmpty { "New entry" } ?: "New entry"
            setTextColor(CREATE_FG)
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            ellipsize = TextUtils.TruncateAt.END
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        header.addView(title)
        val closeButton = TextView(context).apply {
            text = "✕"
            contentDescription = "Cancel"
            setTextColor(CREATE_ACCENT)
            textSize = 16f
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            // 5px radius, matching every button on the real app
            // (visual-parity pass; was 12dp). Stays stroke-only, no
            // elevation — an outline button, deliberately lighter-weight
            // than the filled `doneButton` beside it; the real app's own
            // gradient-pill shadow only applies to filled buttons too.
            background = strokedRoundedRect(CREATE_ACCENT, 2, 5)
            layoutParams = LinearLayout.LayoutParams(dip(40), dip(40)).apply {
                marginEnd = dip(10)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                cancelDraftFlow()
            }
        }
        header.addView(closeButton)
        val doneButton = TextView(context).apply {
            text = "✓"
            contentDescription = "Save"
            setTextColor(CREATE_ACCENT_TEXT)
            textSize = 18f
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            // Gradient-pill, coral family, 5px radius — matching every
            // filled button on the real app (visual-parity pass; was a
            // flat `CREATE_ACCENT` fill at 12dp).
            background = gradientPill(CREATE_GRADIENT_TOP, CREATE_GRADIENT_BOTTOM, CREATE_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            layoutParams = LinearLayout.LayoutParams(dip(40), dip(40))
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                finishDraft()
            }
        }
        header.addView(doneButton)
        container.addView(withCreateBorder(header))

        val subtitle = TextView(context).apply {
            text = if (likelySignupField) {
                "Looks like a sign-up field — fill in what you can, then Done."
            } else {
                "Generate or fill in what you can, then Done."
            }
            setTextColor(CREATE_MUTED)
            textSize = 12f
            setPadding(dip(16), dip(8), dip(16), dip(8))
        }
        container.addView(withCreateBorder(subtitle))

        draftGrabMessage?.let { message ->
            val notice = TextView(context).apply {
                text = message
                setTextColor(CREATE_MUTED)
                textSize = 12f
                setPadding(dip(16), dip(8), dip(16), dip(8))
            }
            container.addView(withCreateBorder(notice))
        }

        if (draft != null) {
            for (field in draft.fields) {
                container.addView(buildDraftFieldRow(field, draft))
            }
        }

        return container
    }

    /**
     * One draft field: an all-caps muted "TITLE"-style label, the value
     * (or "—") in large bold text below it, then a row of pill-shaped
     * actions below that — label/value/actions stacked, not the
     * label-left/actions-right split every other field row in this file
     * uses (`buildDetailFieldRow`), matching the screenshot this panel's
     * own doc references. Takes the whole `DraftFieldSnapshot` (not a
     * loose key/label/value triple) so the populate action and the masked-
     * value treatment both read off that field's own `canGenerate`/
     * `canPickFromVault`/`sensitive` flags — generic per
     * `docs/ACCOUNT-CREATION-DESIGN.md`'s "Any entry type" revision, not a
     * hardcoded `key == "password"` check (see `buildCreatePanel`'s own
     * doc for the regression that briefly reintroduced that hardcoding).
     * "Grab" and "Fill" are unchanged from before — "Fill" additionally
     * appears once the field actually has a value, to retype that same
     * value again — the confirm-password case from
     * `docs/ACCOUNT-CREATION-DESIGN.md`'s step 6, or just reusing the same
     * value in a second form field.
     *
     * The Password field also shows a strength bar under its value, and its
     * "Generate" opens `buildPasswordOptionsPanel` at the bottom of this row;
     * an email field's "Pick from Vault" opens `buildEmailListPanel` there
     * instead. Both panels live inside this row (above its border) and only
     * one is ever open — see `openDraftPanelKey`. `draft` is the whole
     * snapshot, for the panel/strength data that isn't per-field.
     */
    private fun buildDraftFieldRow(field: DraftFieldSnapshot, draft: DraftSnapshot): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dip(16), dip(14), dip(16), dip(16))
        }

        val labelText = TextView(context).apply {
            text = field.label.uppercase()
            setTextColor(CREATE_MUTED)
            textSize = 11f
            letterSpacing = 0.08f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(6)
            }
        }
        row.addView(labelText)

        val displayValue = if (field.sensitive && field.value.isNotEmpty()) "••••" else field.value
        val valueText = TextView(context).apply {
            text = displayValue.ifEmpty { "—" }
            setTextColor(CREATE_FG)
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
            // System Roboto/`Typeface.MONOSPACE`, not the web app's bundled
            // Inter/JetBrains Mono — a deliberate decision as of the
            // visual-parity pass, not an oversight: real font files exist
            // (`node_modules/@fontsource/inter`,
            // `@fontsource/jetbrains-mono`, self-hosted `.woff2`, already
            // used by the web app) and bundling them into `res/font/` is
            // possible, not just aspirational, but it's a separate decision
            // — APK size, a font-family XML, `Typeface.createFromAsset`/
            // `ResourcesCompat` wiring — that wasn't asked for here.
            // `docs/ime-visual-parity-plan.md` flags it as open; this
            // comment is what closes the loop so it reads as "decided,"
            // not "forgotten," until/unless that separate decision changes.
            if (field.sensitive) typeface = Typeface.MONOSPACE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(12)
            }
        }
        row.addView(valueText)

        if (field.canGenerate) {
            draft.passwordStrength?.let { row.addView(buildStrengthBar(it)) }
        }

        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        // `canGenerate`/`canPickFromVault` are independent flags, not two
        // sides of one boolean — a field could in principle support
        // neither, in which case no populate button shows at all, same as
        // "Fill" already only conditionally appears below.
        if (field.canGenerate) {
            actions.addView(createPillButton("Generate") { button -> generateDraftPasswordField(field.key, button) })
        } else if (field.canPickFromVault) {
            actions.addView(createPillButton("Pick from Vault") { _ -> toggleEmailList(field.key) })
        }

        // Pulls whatever's already in the *host app's* focused field — a
        // text selection there if one exists, otherwise the field's whole
        // current content — straight into this draft field. Every draft
        // field gets it, Password included: a site can show its own
        // generated password as plain visible text, which is a legitimate
        // thing to grab rather than retype. See `onGrabFromField`'s own doc
        // and `docs/ime-layout-v2-and-grab-design.md`.
        actions.addView(createPillButton("Grab") { button -> grabIntoDraftField(field.key, button) })

        if (field.value.isNotEmpty()) {
            actions.addView(createPillButton("Fill") { button -> fillDraftValue(field.value, button) })
        }

        row.addView(actions)

        if (openDraftPanelKey == field.key) {
            val panel = when {
                field.canGenerate -> buildPasswordOptionsPanel(field.key, draft.passwordOptions)
                field.canPickFromVault -> buildEmailListPanel(field.key)
                else -> null
            }
            if (panel != null) {
                draftPanelView = panel
                row.addView(panel)
            }
        }
        return withCreateBorder(row)
    }

    /** The strength bar under a Password field's value — five segments and
     * a label, the web `StrengthBar`'s own shape. `strength` comes from
     * `estimateStrength` on the JS side (`DraftSnapshot.passwordStrength`);
     * nothing here re-derives it. Tone by score, as the web does: 0-1 bad,
     * 2 warn, 3-4 ok (`SUCCESS`). */
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
                bottomMargin = dip(12)
            }
        }
        val segments = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(0, dip(4), 1f)
        }
        for (i in 0..4) {
            segments.addView(View(context).apply {
                background = filledRoundedRect(if (i <= strength.score) tone else CREATE_BORDER, 2)
                layoutParams = LinearLayout.LayoutParams(0, dip(4), 1f).apply {
                    if (i < 4) marginEnd = dip(4)
                }
            })
        }
        row.addView(segments)
        row.addView(TextView(context).apply {
            text = strength.label
            setTextColor(CREATE_MUTED)
            textSize = 11f
            gravity = Gravity.END
            layoutParams = LinearLayout.LayoutParams(dip(76), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                marginStart = dip(8)
            }
        })
        return row
    }

    /** The bordered card both inline panels sit in, directly under their
     * field's action row. */
    private fun draftPanelCard(): LinearLayout {
        return LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = filledStrokedRoundedRect(CREATE_BG, CREATE_BORDER, 1, 10)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dip(12)
            }
        }
    }

    /**
     * The generator panel — a port of the web `GeneratorPanel`
     * (`PasswordField.tsx`): a "Generator" heading with a "Done" that
     * collapses it, the length slider with its current value, the four
     * character-class toggles and "Regenerate". Every control goes through
     * `applyPasswordOptions` (or, for Regenerate, `generateDraftPasswordField`),
     * so each is a regenerate that replaces the host field's text. The
     * slider commits only on finger lift (`onStopTrackingTouch`) — a JS
     * round trip and host-field retype per drag tick would be wasteful; the
     * number beside it still updates live while dragging. The last enabled
     * class's toggle is dimmed and unclickable, mirroring `canDisable`.
     * Coral palette, per `docs/ime-visual-parity-plan.md` item 11.
     */
    private fun buildPasswordOptionsPanel(fieldKey: String, options: PasswordOptions): View {
        val card = draftPanelCard().apply { setPadding(dip(12), dip(4), dip(12), dip(12)) }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(context).apply {
            text = "GENERATOR"
            setTextColor(CREATE_MUTED)
            textSize = 11f
            letterSpacing = 0.08f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(TextView(context).apply {
            text = "Done"
            setTextColor(CREATE_ACCENT)
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            minHeight = dip(40)
            setPadding(dip(12), 0, 0, 0)
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                openDraftPanelKey = null
                renderResultsArea()
            }
        })
        card.addView(header)

        val lengthRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        lengthRow.addView(TextView(context).apply {
            text = "Length"
            setTextColor(CREATE_MUTED)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        val lengthValue = TextView(context).apply {
            text = options.length.toString()
            setTextColor(CREATE_FG)
            textSize = 13f
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
                    applyPasswordOptions(options.copy(length = PASSWORD_MIN_LENGTH + seekBar.progress))
                }
            })
        }
        card.addView(slider)

        val enabledCount = listOf(options.uppercase, options.lowercase, options.numbers, options.symbols).count { it }
        val toggles = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dip(4)
            }
        }
        toggles.addView(createToggleChip("A-Z", options.uppercase, options.uppercase && enabledCount == 1) {
            applyPasswordOptions(options.copy(uppercase = !options.uppercase))
        })
        toggles.addView(createToggleChip("a-z", options.lowercase, options.lowercase && enabledCount == 1) {
            applyPasswordOptions(options.copy(lowercase = !options.lowercase))
        })
        toggles.addView(createToggleChip("0-9", options.numbers, options.numbers && enabledCount == 1) {
            applyPasswordOptions(options.copy(numbers = !options.numbers))
        })
        toggles.addView(createToggleChip("!@#", options.symbols, options.symbols && enabledCount == 1) {
            applyPasswordOptions(options.copy(symbols = !options.symbols))
        })
        card.addView(toggles)

        val regenerateRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dip(10)
            }
        }
        regenerateRow.addView(createPillButton("Regenerate") { button -> generateDraftPasswordField(fieldKey, button) })
        card.addView(regenerateRow)

        return card
    }

    /** One character-class toggle in the generator panel. On = the coral
     * gradient pill, off = outline only in `CREATE_BORDER` with muted text;
     * `locked` (the last class still on) is dimmed and unclickable, like
     * the web toggle's `disabled` + `opacity-70`. Four of these share a row
     * equally (weight 1). */
    private fun createToggleChip(label: String, on: Boolean, locked: Boolean, onClick: () -> Unit): Button {
        return Button(context).apply {
            text = label
            textSize = 12f
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            typeface = Typeface.MONOSPACE
            setTextColor(if (on) CREATE_ACCENT_TEXT else CREATE_MUTED)
            background = if (on) {
                gradientPill(CREATE_GRADIENT_TOP, CREATE_GRADIENT_BOTTOM, CREATE_BORDER, 18)
            } else {
                strokedRoundedRect(CREATE_BORDER, 1, 18)
            }
            if (on) elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(0, 0, 0, 0)
            isEnabled = !locked
            alpha = if (locked) 0.7f else 1f
            layoutParams = LinearLayout.LayoutParams(0, dip(36), 1f).apply {
                marginEnd = dip(6)
            }
            setOnClickListener {
                performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onClick()
            }
        }
    }

    /**
     * The saved-emails list under an email field — `draftKnownEmails`,
     * every distinct email-shaped value in the vault, newest first, from
     * `entrySource.listKnownEmails`. About `EMAIL_LIST_MAX_VISIBLE_ROWS`
     * rows show, then the list scrolls inside itself, so one long list can't
     * take over the panel. Flat rows, no gradients; tapping one is
     * `pickKnownEmail`. `null` (fetch in flight) shows "Loading…", an empty
     * list shows "No saved emails yet".
     */
    private fun buildEmailListPanel(fieldKey: String): View {
        val card = draftPanelCard().apply { setPadding(dip(4), dip(4), dip(4), dip(4)) }
        val emails = draftKnownEmails
        if (emails == null) {
            card.addView(buildEmailInfoRow("Loading…"))
        } else if (emails.isEmpty()) {
            card.addView(buildEmailInfoRow("No saved emails yet"))
        } else {
            val list = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            emails.forEachIndexed { index, email ->
                if (index > 0) {
                    list.addView(View(context).apply {
                        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(1))
                        setBackgroundColor(CREATE_BORDER)
                    })
                }
                list.addView(TextView(context).apply {
                    text = email
                    setTextColor(CREATE_FG)
                    textSize = 15f
                    gravity = Gravity.CENTER_VERTICAL
                    ellipsize = TextUtils.TruncateAt.END
                    maxLines = 1
                    isClickable = true
                    isFocusable = true
                    setPadding(dip(12), 0, dip(12), 0)
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(EMAIL_ROW_HEIGHT_DP))
                    setOnClickListener {
                        performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                        pickKnownEmail(fieldKey, email)
                    }
                })
            }
            val visibleRows = minOf(emails.size, EMAIL_LIST_MAX_VISIBLE_ROWS)
            val visibleHeight = dip(EMAIL_ROW_HEIGHT_DP) * visibleRows + dip(1) * (visibleRows - 1)
            card.addView(ScrollView(context).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, visibleHeight)
                addView(list)
            })
        }
        return card
    }

    private fun buildEmailInfoRow(message: String): View {
        return TextView(context).apply {
            text = message
            setTextColor(CREATE_MUTED)
            textSize = 13f
            setPadding(dip(12), dip(12), dip(12), dip(12))
        }
    }

    /** A fully-rounded (pill-shaped) `CREATE_ACCENT`-gradient button with
     * dark bold text — `buildDraftFieldRow`'s own action button, distinct
     * from `smallActionButton` (the gradient-pill chip every other field
     * row in this file uses, neutral-colored and 5px-radius rather than a
     * true pill) so the DETAIL screen's own chips stay exactly as they
     * were; see `CREATE_BG`'s own doc for why this screen doesn't share
     * that styling any more. */
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
            // 18dp corner radius on a 36dp-tall button = fully pill-shaped,
            // matching the screenshot's rounded buttons exactly (as
            // opposed to `smallActionButton`'s much smaller 8dp radius).
            // Radius kept as-is through the visual-parity pass, unlike
            // every other button's radius in this file — this one's shape
            // has its own direct screenshot source, independent of and
            // predating the general "every button is 5px now" rule; fill
            // becomes the same coral gradient as this panel's other
            // buttons, per that pass, the shape does not.
            background = gradientPill(CREATE_GRADIENT_TOP, CREATE_GRADIENT_BOTTOM, CREATE_BORDER, 18)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            setPadding(dip(16), 0, dip(16), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(36)).apply {
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
    private fun grabIntoDraftField(key: String, button: Button) {
        val grabbed = onGrabFromField()?.takeIf { it.isNotBlank() }
        if (grabbed == null) {
            draftGrabMessage = "Nothing to grab — select text in the field, or type something there first."
            renderResultsArea()
            return
        }
        draftGrabMessage = null
        entrySource.setDraftField(key, grabbed)
        refreshDraftAndRender()
    }

    /** The selected entry's detail view: a small header (title, tap to go
     * back to search) followed by one row per fillable field. */
    private fun buildDetailView(entry: FillEntry): View {
        val container = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            isClickable = true
            isFocusable = true
            setPadding(dip(16), dip(12), dip(16), dip(12))
        }
        val back = TextView(context).apply {
            text = "‹"
            setTextColor(MUTED_FOREGROUND)
            textSize = 27f // 18f + 50%, per request
            setPadding(0, 0, dip(8), 0)
        }
        header.addView(back)
        val titleBlock = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val title = TextView(context).apply {
            text = entry.title.ifEmpty { "Untitled" }
            setTextColor(FOREGROUND)
            textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
        }
        titleBlock.addView(title)
        val typeLabel = TextView(context).apply {
            text = entry.type.replaceFirstChar { it.uppercase() }
            setTextColor(MUTED_FOREGROUND)
            textSize = 12f
        }
        titleBlock.addView(typeLabel)
        header.addView(titleBlock)
        header.setOnClickListener { returnToSearch() }
        container.addView(withBottomBorder(header))

        for (field in entry.fields.filter { it.fillable }) {
            container.addView(buildDetailFieldRow(entry, field))
        }

        return container
    }

    /**
     * One field: its label (small), the value below it (or, for a sensitive
     * field not currently revealed, exactly four dots — not a length-coded
     * mask), then actions below the value: "Fill" always, plus a "Show"/
     * "Hide" toggle for sensitive fields. Actions sit under the value
     * (rather than beside it) so each button has the full row width to
     * stretch into — see `smallActionButton`'s own 20dp side-padding.
     * Revealing fetches the plaintext once and caches it in
     * `revealedFields` until the field is hidden again, the selection
     * changes, or `REVEAL_SECONDS` elapses.
     */
    private fun buildDetailFieldRow(entry: FillEntry, field: FillField): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            // 11 → 14dp vertical, roomier per the layout-v2 pass.
            setPadding(dip(16), dip(14), dip(16), dip(14))
        }

        val labelText = TextView(context).apply {
            text = field.label
            setTextColor(MUTED_FOREGROUND)
            textSize = 12f
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(4)
            }
        }
        row.addView(labelText)

        val revealed = revealedFields[field.key]
        val displayValue = if (!field.sensitive) field.value else (revealed ?: "••••")
        val valueText = TextView(context).apply {
            text = displayValue.ifEmpty { "—" }
            setTextColor(FOREGROUND)
            textSize = 15f
            if (field.sensitive) typeface = Typeface.MONOSPACE
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                bottomMargin = dip(10)
            }
        }
        row.addView(valueText)

        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }

        if (field.sensitive) {
            val revealLabel = if (revealed != null) "Hide" else "Show"
            val revealButton = smallActionButton(revealLabel) { toggleReveal(entry, field) }
            actions.addView(revealButton)
        }

        // A sensitive field's value is never in hand yet (see
        // `FillField.value`, always "" for one) — its Fill button is always
        // enabled, and a tap that turns out empty just fills nothing. A
        // non-sensitive field's value is already known, so an empty one is
        // disabled up front instead of offering a fill that can't do
        // anything.
        val fillEnabled = field.sensitive || field.value.isNotEmpty()

        // Card's Number field gets the chunked treatment
        // (`docs/ime-layout-v2-and-grab-design.md`, per
        // `quick-fill-search-improvements.md`'s "chunked fields" spec) —
        // "Fill all" behaves exactly like the ordinary Fill button below,
        // "Split N/4" commits one 4-digit group per tap via
        // `performChunkFill`. Once all four groups are in (either way) the
        // row shows a disabled "✓ Filled" for `FILLED_REVERT_MS`, then
        // resets to a fresh "Fill all"/"Split 0/4" — see
        // `scheduleCardFilledRevert`. Every other field, expiry included,
        // keeps the plain single-button treatment except for the
        // format-variant addition just below.
        if (entry.type == "card" && field.key == "number") {
            if (cardChunkProgress >= 4) {
                actions.addView(smallActionButton("✓ Filled", enabled = false) {})
                scheduleCardFilledRevert()
            } else {
                actions.addView(smallActionButton("Fill all", enabled = fillEnabled) { button ->
                    cardChunkProgress = 4
                    performFill(entry, field, button)
                })
                actions.addView(
                    smallActionButton("Split $cardChunkProgress/4", enabled = fillEnabled) { button ->
                        performChunkFill(entry, field, button)
                    },
                )
            }
        } else if (field.dataType == "monthYear") {
            // Expiry: an ordinary Fill, plus a ghost chip showing (and
            // toggling) which digit order it fills in — see
            // `performExpiryFill`'s own doc for why this field alone needs
            // its own fill path rather than the generic one below.
            actions.addView(smallActionButton("Fill", enabled = fillEnabled) { button ->
                performExpiryFill(entry, field, button)
            })
            actions.addView(smallActionButton(if (expiryFormatSwapped) "YY/MM" else "MM/YY") {
                expiryFormatSwapped = !expiryFormatSwapped
                renderResultsArea()
            })
        } else {
            actions.addView(smallActionButton("Fill", enabled = fillEnabled) { button ->
                performFill(entry, field, button)
            })
        }

        row.addView(actions)
        return withBottomBorder(row)
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
                    uiHandler.postDelayed({ finishFill(entry, value) }, FILL_FEEDBACK_DELAY_MS)
                } else {
                    // Nothing came back — re-enable rather than leave a dead
                    // button with no acknowledgement shown.
                    button.isEnabled = true
                }
            }
        } else {
            QuickFillUsage.recordUse(context, callingPackage, entry.id)
            markFilled(button)
            uiHandler.postDelayed({ finishFill(entry, field.value) }, FILL_FEEDBACK_DELAY_MS)
        }
    }

    /**
     * The "Split N/4" chip's action — commits one 4-digit group of a card
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
                    if (cardChunkProgress >= chunks.size) armPostFillTabAndPasswordCheck(entry)
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
        uiHandler.postDelayed({ finishFill(entry, toFill) }, FILL_FEEDBACK_DELAY_MS)
    }

    /**
     * Swaps a tapped Fill/Generate button to a brief "✓ Filled!"
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
     * stuck on "✓ Filled!", and disabled,
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
        button.text = "✓ Filled!"
        button.setTextColor(BACKGROUND)
        // Radius updated to match the new button standard (visual-parity
        // pass; was 8dp); kept as a flat fill deliberately, not a gradient
        // — this is a brief, transient confirmation flash, and there's no
        // real app reference for a gradient success state to match against,
        // unlike the neutral and coral recipes above (both sourced
        // directly from real buttons).
        button.background = filledRoundedRect(SUCCESS, 5)
        uiHandler.postDelayed({
            button.text = originalText
            button.setTextColor(originalTextColor)
            button.background = originalBackground
            button.isEnabled = true
        }, FILLED_REVERT_MS)
    }

    /**
     * Starts the clock on a fully-filled Card Number row's disabled
     * "✓ Filled" state (`cardChunkProgress >= 4`, reached via "Fill all" or
     * the last "Split N/4" chunk): `FILLED_REVERT_MS` after it first shows
     * up, `revertCardFilledRunnable` resets the counter to 0 and
     * re-renders, so "Fill all"/"Split 0/4" come back clickable — the same
     * "acknowledge briefly, then return to normal" every other Fill button
     * already gets from `markFilled`. `markFilled` can't cover this one: it
     * reverts a single `Button` instance, but by the time this state
     * shows the row has been rebuilt around a different, permanently
     * disabled button, which nothing was ever going to revert.
     *
     * Called from the render itself (`buildDetailFieldRow`) rather than at
     * each site that sets the counter, so every route into the state is
     * covered by the one call — "Fill all" (which sets it at tap time,
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

    /** Every Fill/Show/Hide/Split-N/4/Generate/Grab/Pick-from-Vault chip in
     * both the detail view and the create panel — the single most-tapped
     * control in the whole keyboard. Was `dip(28)` tall; bumped to
     * `dip(44)` to actually clear the ≥44dp touch-target floor
     * `docs/ime-ux-redesign-proposal.md` states for this keyboard (see
     * docs/UI-UX-REVIEW.md's top findings #3) — `minWidth`/`minHeight`
     * stay zeroed on purpose, unrelated to that floor: several of these
     * chips sit side by side in one row (Card's "Fill all" + "Split N/4"),
     * and zeroing width/height-*minimums* only stops Android's default
     * platform `Button` style from padding them wider/taller than their own
     * text needs — it was never what made them short; the literal `dip(28)`
     * layout height was. */
    private fun smallActionButton(label: String, enabled: Boolean = true, onClick: (Button) -> Unit): Button {
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
            // Gradient-pill, 5px radius, matching every button on the real
            // app (visual-parity pass; was a flat `SECONDARY` fill at
            // 8dp — `SECONDARY` itself is retired, see its own doc).
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            // 10 → 20dp: wider chips, now that they sit below the value
            // (`buildDetailFieldRow`) instead of competing with it for
            // horizontal space.
            setPadding(dip(20), 0, dip(20), 0)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dip(44)).apply {
                marginStart = dip(6)
            }
            setOnClickListener { onClick(this) }
        }
    }

    // ── Locked view ─────────────────────────────────────────────────────

    /** Shown instead of the full search/results/keypad view whenever
     * `entrySource` has nothing to offer — either Vault isn't
     * running, or it is but the vault's locked. A single "Unlock Vault"
     * button opens it via `onOpenVault` — see that callback's own doc
     * on `VaultKeyboardView` for what each adapter does with it.
     * Unaffected by this redesign — no search or keypad to speak of either
     * way, since there's nothing loaded to search or fill from. */
    private fun buildLockedView(): View {
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BACKGROUND)
        }
        root.addView(buildLockedHeader())
        root.addView(buildLockedFillStrip())
        root.addView(bottomInsetSpacer())
        return root
    }

    private fun buildLockedHeader(): View {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(CARD)
            setPadding(dip(10), dip(8), dip(10), dip(8))
        }
        val label = TextView(context).apply {
            text = "Vault"
            setTextColor(MUTED_FOREGROUND)
            textSize = 13f
        }
        row.addView(label)
        return withBottomBorder(row)
    }

    private fun buildLockedFillStrip(): View {
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(CARD)
            // Top/bottom padding 6 → 14dp per request (more breathing room
            // above/below the button); strip height grows by the same
            // +16dp total (73 → 89dp) to fit it, same "button's own height
            // plus this padding" relationship as before.
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(89))
            setPadding(dip(10), dip(14), dip(10), dip(14))
        }
        val button = Button(context).apply {
            text = "Unlock Vault"
            textSize = 16f // was 20f, -4pt per request
            isAllCaps = false
            minWidth = 0
            minimumWidth = 0
            minHeight = 0
            minimumHeight = 0
            gravity = Gravity.CENTER
            setTextColor(SECONDARY_FOREGROUND)
            // Gradient-pill, 5px radius, matching every button on the real
            // app (visual-parity pass; was a flat `SECONDARY` fill at 8dp).
            background = gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            elevation = dip(BUTTON_ELEVATION_DP).toFloat()
            // Was 185×40dp (itself already +10dp tall from an earlier
            // request); +20dp on each dimension per "increase the size of
            // the button by 20pts" — width grows too, not just height,
            // since the button also needs to fit noticeably larger text.
            layoutParams = LinearLayout.LayoutParams(dip(205), dip(60))
            setOnClickListener { openVaultForFill() }
        }
        container.addView(button)
        return withBottomBorder(container)
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
     * Starts a fresh draft, seeded with whatever `setDetectedContext` most
     * recently supplied — or, if `currentDraft` already holds one (from an
     * earlier show of this same keyboard session that was never finished),
     * resumes that instead of discarding it. `currentDraft` is only a
     * locally cached snapshot — not re-fetched here — but `start()` already
     * refreshes it on every keyboard show, so it's never stale by more than
     * this one show's own actions, which are the only thing that can change
     * it anyway.
     */
    private fun startCreatingDraft() {
        draftGrabMessage = null
        if (currentDraft != null) {
            screen = Screen.CREATE
            updateBottomRowsForScreen()
            renderResultsArea()
            return
        }
        entrySource.startDraft(detectedTitleGuess)
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

    /** A draft field's "Generate" action (password only) — mirrors
     * `performFill`'s disable-then-acknowledge shape, but there's no entry
     * or field to read from; the value comes back from
     * `entrySource.generateDraftPassword` itself. Also opens the generator
     * panel under this field (`buildPasswordOptionsPanel`) if it isn't
     * already, the way the web password field's dice button does — the
     * panel itself appears with the re-render that follows the commit.
     * Replaces the host field's text rather than appending
     * (`onClearField` first): Generate is tapped repeatedly on the same
     * field while iterating toward a password, and `onCommitText` alone
     * only ever inserts at the cursor. */
    private fun generateDraftPasswordField(key: String, button: Button) {
        button.isEnabled = false
        if (openDraftPanelKey != key) {
            openDraftPanelKey = key
            scrollToDraftPanel = true
        }
        entrySource.generateDraftPassword { value ->
            if (!value.isNullOrEmpty()) {
                markFilled(button)
                uiHandler.postDelayed({
                    onClearField()
                    onCommitText(value)
                    refreshDraftAndRender()
                }, FILL_FEEDBACK_DELAY_MS)
            } else {
                button.isEnabled = true
            }
        }
    }

    /** Every control in the generator panel funnels through here: persists
     * the new settings and regenerates from them
     * (`entrySource.setDraftPasswordOptions`, which also validates/clamps on
     * the JS side), then replaces the host field's text with the result —
     * same clear-then-commit as `generateDraftPasswordField`. An
     * all-classes-off combination is refused up front (the panel already
     * locks the last enabled toggle, so this is a backstop). */
    private fun applyPasswordOptions(options: PasswordOptions) {
        if (!options.uppercase && !options.lowercase && !options.numbers && !options.symbols) return
        entrySource.setDraftPasswordOptions(options) { value ->
            if (!value.isNullOrEmpty()) {
                onClearField()
                onCommitText(value)
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

    /** Tapping an email in the inline list: replaces the host field's text
     * (clear, then type — appending would corrupt a half-typed address),
     * records it in the draft, and collapses the list. `setDraftField` and
     * the `getDraft` inside `refreshDraftAndRender` are both queued on the
     * webview in order, so the re-render sees the new value. */
    private fun pickKnownEmail(key: String, email: String) {
        openDraftPanelKey = null
        onClearField()
        onCommitText(email)
        entrySource.setDraftField(key, email)
        refreshDraftAndRender()
    }

    /** Collapses whichever inline panel is open and drops what it held —
     * called wherever a draft session ends or restarts (`start()`,
     * `finishDraft`, `cancelDraftFlow`). */
    private fun closeDraftPanels() {
        openDraftPanelKey = null
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

    /** The creation panel's "Done" action. Commits whatever the draft has —
     * flagged for review, per the design doc, regardless of how few fields
     * got filled in — and leaves the picker, same as any other "the user is
     * done here" action. A commit that reports nothing worth saving (an
     * empty draft) still leaves the picker the same way; there's nothing
     * useful to keep the keyboard open for either way. */
    private fun finishDraft() {
        entrySource.commitDraft {}
        closeDraftPanels()
        currentDraft = null
        returnToPreviousKeyboard()
    }

    /** The creation panel's "Cancel" action. Discards the draft and returns
     * to an ordinary, empty search — unlike "Done," this stays open, since
     * cancelling account creation doesn't necessarily mean the user is done
     * with the picker entirely (they may still want to fill something
     * else). */
    private fun cancelDraftFlow() {
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

    /** `withBottomBorder`'s own divider, recolored `CREATE_BORDER` instead
     * of `BORDER` — the account-creation panel's palette is its own (see
     * `CREATE_BG`'s own doc), so it can't share `withBottomBorder` itself
     * without also recoloring every other screen's dividers. */
    private fun withCreateBorder(content: View): View {
        val wrapper = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        wrapper.addView(content)
        val border = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(1))
            setBackgroundColor(CREATE_BORDER)
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
    private fun filledStrokedRoundedRect(fillColor: Int, strokeColor: Int, strokeWidthDp: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setColor(fillColor)
            setStroke(dip(strokeWidthDp), strokeColor)
        }
    }

    /** An unfilled, stroke-only rounded rect — the account-creation
     * panel's own "✕" button (see `buildCreatePanel`), which the
     * screenshot it's built from shows as an outline, not a fill (unlike
     * its neighboring "✓" button, which is filled — see
     * `filledRoundedRect`). */
    private fun strokedRoundedRect(strokeColor: Int, strokeWidthDp: Int, radiusDp: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dip(radiusDp).toFloat()
            setColor(Color.TRANSPARENT)
            setStroke(dip(strokeWidthDp), strokeColor)
        }
    }

    /** Used only for `buildAvatar`'s initial-letter circle. */
    private fun filledOval(color: Int): GradientDrawable {
        return GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(color)
        }
    }

    private fun bottomInsetSpacer(): View {
        return View(context).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(BOTTOM_INSET_DP))
            setBackgroundColor(BACKGROUND)
        }
    }

    // ── On-screen keyboard ──────────────────────────────────────────────

    // A minimal on-screen keyboard for the search box only — see the class
    // doc for why the system keyboard can't be used here. Four rows:
    // QWERTYUIOP, ASDFGHJKL, a "123"-toggle + ZXCVBNM + backspace row, and
    // a last row of just "space" — swapped for "New search" over
    // `Screen.DETAIL`, or hidden entirely over `Screen.CREATE` (that
    // screen's own Cancel/Done live in `buildCreatePanel`'s header
    // instead), see `updateBottomRowsForScreen`. Lock and the clear-field
    // key used to
    // open each of these rows too; both now live in `buildTopBar` instead
    // (`docs/ime-ux-redesign-proposal.md`) — everything left here writes
    // into the search box or navigates this picker's own screens, nothing
    // reaches outside it. No symbols/autocorrect — the search box itself
    // only ever needs to match against entry titles and usernames.
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
            setPadding(dip(4), dip(8), dip(4), dip(8))
        }

        keysArea = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        keyboard.addView(keysArea)
        refreshKeysArea()

        // See `buildBottomActionRow`'s own doc for the keys' weights.
        // "Add Entry" rides along here, not on its own row — per direct
        // request, back beside "space" (its original spot, before
        // `docs/ime-layout-v2-and-grab-design.md` first moved it beside the
        // search field). `buildBottomActionRow`'s optional right-key slot
        // already renders a rounded-rectangle `specialKey`, so this needed
        // no new button shape — just using that same optional right-hand
        // key here. Same one-call-site, `Screen.SEARCH`-only visibility
        // "Add Entry" has always had — `spaceRow` only shows there to
        // begin with.
        spaceRow = buildBottomActionRow(
            centerLabel = "space", onCenter = { query.append(' '); onQueryChanged() },
            rightLabel = "Add Entry", rightTextSize = 13f, onRight = { onPlusKeyTapped() },
        )
        keyboard.addView(spaceRow)

        // Takes `spaceRow`'s place — same slot, same layout — over
        // `Screen.DETAIL`; see `updateBottomRowsForScreen`. "New search"
        // replaces typing a query with a single tap back to
        // `returnToSearch()`, since the letter keys are hidden while this
        // row shows. `Screen.CREATE` used to take the same slot again with
        // its own Cancel/Done row (`createActionsRow`); those buttons moved
        // up into `buildCreatePanel`'s own header instead, so nothing
        // takes this slot for `Screen.CREATE` any more — the whole keypad
        // just stays hidden, see `updateBottomRowsForScreen`.
        detailActionsRow = buildBottomActionRow(
            centerLabel = "New search", onCenter = { returnToSearch() },
        )
        detailActionsRow.visibility = View.GONE
        keyboard.addView(detailActionsRow)

        return keyboard
    }

    /** Builds the shared 1-or-2-key bottom row shape: the keypad's own last
     * row (just "space"), and the row that takes its place over
     * `Screen.DETAIL` (just "New search") — `Screen.CREATE` no longer has
     * a row of its own here, see `buildKeyboard`'s doc. Used to also carry
     * Lock and the "fix a mistake" clear-field key as two fixed icon keys
     * on the left of every row this builds; both moved to `buildTopBar`
     * instead (`docs/ime-ux-redesign-proposal.md`) — see that function's
     * own doc for why. What's left here is purely search-box-typing and
     * screen-navigation actions, so a plain center (and optional right)
     * `specialKey` is now the whole row. */
    private fun buildBottomActionRow(
        centerLabel: String,
        onCenter: () -> Unit,
        rightLabel: String? = null,
        rightTextSize: Float = 14f,
        onRight: (() -> Unit)? = null,
    ): LinearLayout {
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dip(KEY_ROW_HEIGHT_DP)).apply {
                topMargin = dip(ROW_GAP_DP)
            }
        }
        // Even split when there's a right-hand key ("Add Entry"/Done); full
        // width otherwise (space, "New search") — no more fixed-width Lock/
        // Clear-field keys on the left eating into either weight.
        val centerWeight = if (rightLabel != null) 0.5f else 1f
        row.addView(specialKey(centerLabel, weight = centerWeight, onClick = onCenter))
        if (rightLabel != null && onRight != null) {
            // `accent = true` — the only caller of this optional slot today
            // is "Add Entry" (starts a draft) on `spaceRow`. See
            // `ADD_ENTRY_TOP`'s own doc comment for where that color comes
            // from, and `buildCreatePanel` for this flow's other "Save"
            // analog ("Done"), which lives in the panel's own header
            // instead of a row built here.
            row.addView(specialKey(rightLabel, weight = 0.5f, textSize = rightTextSize, accent = true, onClick = onRight))
        }
        return row
    }

    /** Swaps the keypad's letter/number rows and whichever of
     * `spaceRow`/`detailActionsRow` is visible to match the current
     * `screen` — the two bottom rows occupy the same slot in `keyboard`'s
     * view tree, so at most one is ever visible; `Screen.CREATE` leaves
     * both hidden, since its own Cancel/Done live in `buildCreatePanel`'s
     * header instead.
     *
     * Also hides the search box and its divider outside `Screen.SEARCH`,
     * per the "just the bottom buttons, a spacer, and the expanded result"
     * layout request — `buildHandleBar()`'s bar (still visible either way,
     * directly above `searchBoxRow` in the view tree) ends up serving as
     * that spacer for DETAIL/CREATE alike.
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

        val backspace = specialKey("⌫", weight = 1.2f) {
            if (query.isNotEmpty()) {
                query.deleteCharAt(query.length - 1)
                onQueryChanged()
            }
        }
        row.addView(backspace)

        return row
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
        textSize: Float = 14f,
        accent: Boolean = false,
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
            // `accent` — see `ADD_ENTRY_TOP`'s own doc comment: this flow's
            // own "Save" analog (`buildBottomActionRow`'s right-hand key),
            // not a general-purpose option every caller needs to think
            // about — every other call site leaves it at the default.
            // Gradient-pill, 5px radius, matching every button on the real
            // app (visual-parity pass; was a flat fill at 6dp) — the accent
            // case uses the real "Add entry" button's own coral-copper
            // gradient, not blue.
            setTextColor(if (accent) ADD_ENTRY_TEXT else SECONDARY_FOREGROUND)
            background = if (accent) {
                gradientPill(ADD_ENTRY_TOP, ADD_ENTRY_BOTTOM, ADD_ENTRY_BORDER, 5)
            } else {
                gradientPill(GRADIENT_TOP, GRADIENT_BOTTOM, BUTTON_BORDER, 5)
            }
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
            // Every key on the keypad routes through this one builder, so
            // this is the single place a per-key tap "click" (haptic) needs
            // to be wired up — covers letters, numbers, backspace, the
            // 123/ABC toggle, and space alike. Respects the system's own
            // haptic-feedback setting (no override flags), same as a real
            // keyboard would.
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
     * Re-renders afterwards purely so the "✓ Filled!" button that
     * triggered this doesn't sit there checked (and disabled) forever — the
     * entry and its fields haven't otherwise changed, just that one
     * button's transient state — and then calls
     * `armPostFillTabAndPasswordCheck`, see its own doc.
     */
    private fun finishFill(entry: FillEntry, text: String) {
        if (text.isEmpty()) return

        // Re-render and chain into "Fill, then Tab" once the value lands.
        // Deferred behind a lambda so the char-by-char path below can run it
        // only once the *last* character has actually committed, not the
        // moment the first one does.
        val afterCommit = {
            if (screen == Screen.DETAIL) {
                renderResultsArea()
                armPostFillTabAndPasswordCheck(entry)
            }
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
     * left alone) has just committed a field's value. `onSendTab` fires
     * unconditionally, for every ordinary fill — that half isn't
     * conditioned on this entry having a password at all. Only the second
     * half is conditional: if this entry *does* have a fillable password
     * field, this also arms `pendingPostFillPasswordEntry` so the *next*
     * `onEditorInfoChanged` call — the signal that focus actually moved —
     * can decide whether to fill it too.
     *
     * `onEditorInfoChanged` itself, not this function, is what actually
     * checks whether the field Tab landed on is a password field — Android
     * lets an IME learn the newly-focused field's `EditorInfo` (via
     * `VaultIme.onStartInput`), it just can't get that answer
     * synchronously in the middle of sending the key event, hence the
     * arm-then-wait split. `clearPendingPostFillPasswordRunnable`,
     * scheduled here, is the backstop in case that signal never arrives.
     */
    private fun armPostFillTabAndPasswordCheck(entry: FillEntry) {
        onSendTab()
        if (entry.fields.none { it.key == PASSWORD_FIELD_KEY && it.fillable }) return
        uiHandler.removeCallbacks(clearPendingPostFillPasswordRunnable)
        pendingPostFillPasswordEntry = entry
        uiHandler.postDelayed(clearPendingPostFillPasswordRunnable, POST_FILL_TAB_TIMEOUT_MS)
    }

    /**
     * `VaultIme.onStartInput` calls this on every editor change while
     * the picker is showing — including, but not only, the one right after
     * `armPostFillTabAndPasswordCheck` sent a Tab. If a password check is
     * currently armed, this is that signal: the arming is consumed
     * unconditionally (whether or not `info` actually turns out to be a
     * password field), so an unrelated, later focus change never wrongly
     * retriggers it. Fetches and fills the entry's password only when
     * `info` really does look like a password field — see
     * `isPasswordInputType`.
     */
    fun onEditorInfoChanged(info: EditorInfo?) {
        val entry = pendingPostFillPasswordEntry ?: return
        pendingPostFillPasswordEntry = null
        uiHandler.removeCallbacks(clearPendingPostFillPasswordRunnable)
        if (!isPasswordInputType(info)) return
        entrySource.readField(entry.id, PASSWORD_FIELD_KEY) { value ->
            if (!value.isNullOrEmpty()) onCommitText(value)
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
