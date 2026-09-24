package com.passhandler.app

import android.content.Intent
import android.content.pm.PackageManager
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.ExtractedTextRequest
import android.view.inputmethod.InputMethodManager

/**
 * The manual-fill trigger on Android: a custom keyboard, switched to from
 * whichever field the user wants filled — the same way they'd switch to any
 * other keyboard. Not the Autofill framework; see
 * `docs/MANUAL-FILL-DESIGN.md` for why.
 *
 * This never decrypts anything and never holds a password longer than it
 * takes to hand it to `commitText`. All of the "does the running app even
 * have an unlocked vault" question lives in `WebViewBridge`, which is the
 * only thing this talks to.
 *
 * This class itself is a thin `InputMethodService` adapter — every view
 * built, every bit of search/selection/reveal/fill/draft state, lives in
 * `VaultKeyboardView`, which knows nothing about being an IME.
 * What's here is just the things only an actual running IME can do (commit
 * text into `currentInputConnection`, switch back to the previous keyboard,
 * launch `MainActivity` to unlock, read the focused field's `EditorInfo`)
 * wired up as callbacks/data, plus forwarding this service's lifecycle to
 * `start()`/`stop()`. See
 * `VaultKeyboardView`'s own doc for why: the same class also backs
 * `VaultImePreviewActivity`, a debug-only screen for previewing every
 * layout/spacing/text change without the enable-in-Settings/switch-keyboard
 * dance this real IME requires.
 */
class VaultIme : InputMethodService() {

    // Built lazily — `this` (as a Context, for view construction) isn't
    // safely usable until the service itself is constructed, and this is
    // only ever first touched from `onCreateInputView`, well after that.
    private val keyboardView: VaultKeyboardView by lazy {
        VaultKeyboardView(
            context = this,
            entrySource = WebViewBridgeEntrySource,
            onViewChanged = { view -> setInputView(view) },
            onCommitText = { text -> currentInputConnection?.commitText(text, 1) },
            onSwitchToPreviousKeyboard = { switchToPreviousKeyboard() },
            onOpenVault = { openVault() },
            // Deletes in both directions around the cursor rather than
            // selecting-all-then-deleting — works regardless of where the
            // cursor happens to sit, and doesn't depend on the target app
            // actually implementing select-all over IPC the way a text
            // context menu action would. CLEAR_FIELD_CHAR_BUDGET, not
            // Int.MAX_VALUE — some `InputConnection` implementations do
            // arithmetic on the requested length internally, and a value
            // that large risks overflowing that math in an app we don't
            // control; a five-figure character budget is already far more
            // than any real field (a password, a card number, a note) will
            // ever hold.
            onClearField = {
                currentInputConnection?.deleteSurroundingText(CLEAR_FIELD_CHAR_BUDGET, CLEAR_FIELD_CHAR_BUDGET)
            },
            onSendTab = { sendTabKeyEvent() },
            onGrabFromField = { grabTextFromTargetField() },
        )
    }

    override fun onCreateInputView(): View = keyboardView.buildLoadingView()

    /** `armPostFillTabAndPasswordCheck`'s trigger — a real `KEYCODE_TAB`
     * down/up pair through `currentInputConnection`, the same path a
     * hardware keyboard's own Tab key would take. Whether this actually
     * moves focus is entirely up to the target app/view honoring Tab for
     * keyboard navigation, same caveat `docs/MANUAL-FILL-DESIGN.md`'s
     * "Fill, then Tab" section discloses — there's no more direct way for
     * an `InputConnection` to ask for "the next field" than this. */
    private fun sendTabKeyEvent() {
        val connection = currentInputConnection ?: return
        val now = SystemClock.uptimeMillis()
        connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_TAB, 0))
        connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_TAB, 0))
    }

    /**
     * `onGrabFromField`'s real implementation — the create/draft panel's
     * "Grab" chip. Reads from the *host app's* currently focused field, not
     * from anything Vault itself holds: this picker's own views
     * never take real input focus (they're not `EditText`s), so
     * `currentInputConnection` keeps pointing at that field for as long as
     * the keyboard is up, the same fact `onCommitText`/`sendTabKeyEvent`
     * already rely on to write into it. Reading works the same way, no
     * special permission needed.
     *
     * Selection first — `getSelectedText` — since a selection is the more
     * specific, deliberate signal ("grab *this*"); only when nothing's
     * selected does this fall back to `getExtractedText` for the field's
     * whole current content ("grab whatever's already there"). See
     * `docs/ime-layout-v2-and-grab-design.md`.
     *
     * Both calls are ordinary read-only `InputConnection` methods, present
     * since API 3/11 respectively — well under this app's
     * `minSdkVersion = 26`, unlike `switchToPreviousInputMethod` (API 28)
     * elsewhere in this file, which needed its own version guard.
     *
     * Not device-verified — a real, if narrow, risk this discloses rather
     * than solves: some apps' own text-selection UI (the floating cut/
     * copy/paste toolbar) can briefly disrupt input-connection state right
     * after a genuine selection was made, which could make
     * `getSelectedText` come back empty even though the user just selected
     * something. No way to rule that out from this sandbox.
     */
    private fun grabTextFromTargetField(): String? {
        val connection = currentInputConnection ?: return null
        connection.getSelectedText(0)?.toString()?.takeIf { it.isNotBlank() }?.let { return it }
        return connection.getExtractedText(ExtractedTextRequest(), 0)?.text?.toString()?.takeIf { it.isNotBlank() }
    }

    /** Called every time the picker is about to be shown, including the
     * first. First checks whether the focused field even belongs to another
     * app — if it's Vault's own, this bails out to the device's
     * normal keyboard instead (see the comment inline below) and never
     * touches `keyboardView` at all. Otherwise reads this show's
     * `EditorInfo` for the streamlined account-creation flow's quiet-bias
     * signals — see `resolveTitleGuess`/`resolveLikelySignup` — before
     * `keyboardView.start()`, which handles resetting per-show state and
     * kicking off a fresh entry (and draft) load; see its own doc.
     *
     * `restarting` is skipped past that `start()` call whenever the picker
     * is already up — see the guard near the bottom of this method for why. */
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)

        // Never open the fill picker for a field inside Vault's own
        // app — there's nothing to fill *into* the vault's own UI from
        // itself, and showing the picker there would be either useless (a
        // plain text field) or actively wrong (the master password field,
        // which must always get the device's normal keyboard, never this
        // one, so it never travels through this IME's own commitText path).
        // `EditorInfo.packageName` names whichever app owns the focused
        // field — comparing it against this service's own `packageName`
        // (inherited from `Context`, not `info`'s) is how an IME learns who
        // it's being shown for. Switches straight back to whatever keyboard
        // was active before Vault's own IME was invoked, via the same
        // `switchToPreviousKeyboard` the rest of this class already uses to
        // hand back control — without ever building or showing this
        // session's fill UI.
        if (info?.packageName == packageName) {
            switchToPreviousKeyboard()
            return
        }

        keyboardView.setDetectedContext(resolveTitleGuess(info), resolveLikelySignup(info), info?.packageName ?: "")

        // `restarting=true` means the framework is re-showing the view for
        // the SAME field/session that was already up — not a fresh field,
        // and not the picker having been dismissed and reopened (that path
        // is `onFinishInputView`+a later fresh `onStartInputView`, which
        // arrives with `restarting=false`). In practice this fires from
        // WebView's own `restartInput()` on an `<input type="number">` (and
        // similar) field every time its value changes programmatically —
        // which, since `commitCharByChar` now commits one character at a
        // time (see `docs/MANUAL-FILL-DESIGN.md`), means once per digit
        // filled. `start()` unconditionally resets all per-show state and
        // flashes the picker to a loading view while it re-fetches entries
        // — exactly right for a genuine new show, but firing that on every
        // one of these same-field restarts is what produces the reported
        // "keyboard flickers away and back" between each character: nothing
        // about the picker actually needs to change for a same-field
        // restart, so skip the rebuild and leave whatever is currently
        // showing exactly as it is. `keyboardView.isActive` guards the case
        // — never observed, but not provably impossible — of `restarting`
        // being true before any real show has happened yet, so that case
        // still gets a genuine `start()` instead of being stuck on the
        // static loading view forever.
        if (restarting && keyboardView.isActive) return

        keyboardView.start()
    }

    /** Fires on every new editor connection — a fresh show (immediately
     * followed by `onStartInputView` above, unless the picker is already
     * visible and doesn't need rebuilding) and, importantly, a plain focus
     * change to a different field in the same app while this keyboard stays
     * open, which `onStartInputView` does *not* re-fire for. That second
     * case is the one `armPostFillTabAndPasswordCheck`'s Tab actually needs
     * — see `VaultKeyboardView.onEditorInfoChanged`'s own doc — so
     * this forwards every call there unconditionally; it's a no-op there
     * whenever nothing is currently armed. */
    override fun onStartInput(info: EditorInfo?, restarting: Boolean) {
        super.onStartInput(info, restarting)
        keyboardView.onEditorInfoChanged(info)
    }

    /** Called whenever the picker stops being shown — the user dismissed
     * the keyboard, switched apps, moved to a field that doesn't want a
     * keyboard, or (via `keyboardView`'s own remaining internal
     * `returnToPreviousKeyboard()` call sites) opened Vault to
     * unlock, or tapped "Done" on the account-creation panel. Filling a
     * value, or an in-progress draft, no longer finishes the input view on
     * its own — the picker deliberately stays open for both, see
     * `VaultKeyboardView.finishFill`'s doc. Whatever the reason,
     * don't leave this as the active input method sitting there for next
     * time — hand back to whatever keyboard was active before it, same as
     * if the user had switched away themselves. `keyboardView`'s own guard
     * makes the actual switch-back a no-op if that already happened for
     * this show. */
    override fun onFinishInputView(finishingInput: Boolean) {
        super.onFinishInputView(finishingInput)
        keyboardView.stop()
    }

    override fun onDestroy() {
        super.onDestroy()
        keyboardView.stop()
    }

    /**
     * `switchToPreviousInputMethod()` is the clean way to do this, but it
     * was only added in API 28 while this app's `minSdkVersion` is 26 —
     * calling it unguarded would crash with `NoSuchMethodError` on Android
     * 8.0/8.1. There is no public, silent equivalent for those versions;
     * showing the system's own IME picker is the honest fallback — the
     * person picks their normal keyboard once, rather than Vault
     * silently failing to switch back at all.
     *
     * `switchToPreviousInputMethod()` itself can also just fail — it
     * returns whether it found a genuinely different previous input method
     * to switch to, and says nothing if not. That's not hypothetical here:
     * it depends on the system's own IME-switch history, which is empty
     * exactly when someone enables Vault's keyboard and starts using
     * it right away without ever having manually switched to any other
     * keyboard first — a very ordinary fresh-setup path, not a rare corner
     * case. A silently-ignored `false` there is indistinguishable from this
     * self-detection never having fired at all, from the user's side: Vault's
     * own keyboard just stays up over its own app's fields either
     * way. Checked now, with `switchToAnyOtherEnabledKeyboard` as the
     * deterministic fallback rather than leaving that gap.
     */
    private fun switchToPreviousKeyboard() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (!switchToPreviousInputMethod()) switchToAnyOtherEnabledKeyboard()
        } else {
            getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
        }
    }

    /**
     * `switchToPreviousKeyboard`'s fallback for when the system's own
     * switch-history comes up empty. Rather than depend on that history at
     * all, this just picks the first *other* enabled input method — any
     * keyboard the user has actually turned on besides Vault's own
     * counts, not only their system default — and switches straight to it
     * via `switchInputMethod`, the same permission-free mechanism the
     * currently active input method is always allowed to call on itself.
     * `showInputMethodPicker()` is the last resort if somehow nothing else
     * is enabled at all — shouldn't happen in practice (Android ships with
     * at least one keyboard already enabled), but leaves the user a way out
     * rather than doing nothing.
     */
    private fun switchToAnyOtherEnabledKeyboard() {
        val imm = getSystemService(InputMethodManager::class.java)
        val other = imm?.enabledInputMethodList?.firstOrNull { it.packageName != packageName }
        if (other != null) {
            @Suppress("DEPRECATION") // No non-deprecated way to name a *specific* other IME —
            // `switchToNextInputMethod` only cycles, it can't target one by id.
            switchInputMethod(other.id)
        } else {
            imm?.showInputMethodPicker()
        }
    }

    private fun openVault() {
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra(MainActivity.EXTRA_LAUNCHED_FROM_FILL, true)
        }
        startActivity(intent)
    }

    // ── Streamlined account creation: best-effort detection ─────────────
    // See docs/ACCOUNT-CREATION-DESIGN.md's "Detect, best-effort" step.
    // Both functions below are read from `EditorInfo`, which only a real
    // running IME session has — this is why they live here rather than in
    // `VaultKeyboardView`, same reasoning as `switchToPreviousKeyboard`.
    // Neither is ever more than a quiet default the user can freely
    // overwrite; see where each result is actually used in
    // `VaultKeyboardView` for what "quiet" means in practice.

    /**
     * A best-effort title guess for a fresh account-creation draft, from
     * the focused app's own package name. `null` whenever there's nothing
     * useful to guess — no `EditorInfo`, or a package this recognises as a
     * browser: a browser's own package name ("com.android.chrome") is
     * never the site the user is actually signing up on, and there's no
     * window-title/URL visibility available to an IME to do better — so
     * this only resolves anything for what looks like a non-browser app's
     * own signup screen.
     */
    private fun resolveTitleGuess(info: EditorInfo?): String {
        val packageName = info?.packageName ?: return ""
        if (packageName in KNOWN_BROWSER_PACKAGES) return ""
        return try {
            val label = packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0))
            label?.toString() ?: ""
        } catch (_: PackageManager.NameNotFoundException) {
            ""
        }
    }

    /**
     * Whether the focused field looks like a new-password field.
     *
     * Always `false` — `EditorInfo` (what an IME actually gets in
     * `onStartInputView`) has no field carrying the autofill hint strings
     * this was written to read. Autofill hints are a `View`-to-autofill-
     * service channel (`View.setAutofillHints`/`View.getAutofillHints`);
     * `EditorInfo` itself only carries an opaque `AutofillId` reference
     * (added in API 30, for an autofill service to correlate the field, not
     * for an IME to read hints off), not the hint strings themselves. There
     * is no IME-visible replacement signal to fall back to — `inputType`
     * only says "this is a password field," never "new" vs. "existing" —
     * so this stays a quiet, always-off default rather than a heuristic
     * built on a field that doesn't exist. Kept as its own function (rather
     * than deleted along with its call site) so `docs/ACCOUNT-CREATION-
     * DESIGN.md`'s "Detect, best-effort" behaviour degrades to "never
     * detected" instead of being ripped out — the one place downstream that
     * reads this (`likelySignupField` in `VaultKeyboardView.kt`)
     * already treats `false` as "nothing to say" per its own doc, not as
     * "confirmed not a signup."
     */
    private fun resolveLikelySignup(info: EditorInfo?): Boolean {
        return false
    }

    companion object {
        // See `onClearField`'s own comment above for why this isn't
        // `Int.MAX_VALUE`.
        private const val CLEAR_FIELD_CHAR_BUDGET = 10_000

        // Common browsers, whose own package name is never the site the
        // user is actually signing up on — better to guess nothing at all
        // than to title a new entry "Chrome".
        private val KNOWN_BROWSER_PACKAGES = setOf(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "org.mozilla.firefox",
            "org.mozilla.firefox_beta",
            "com.microsoft.emmx",
            "com.opera.browser",
            "com.opera.browser.beta",
            "com.brave.browser",
            "com.duckduckgo.mobile.android",
            "com.sec.android.app.sbrowser",
            "com.android.browser",
            "com.UCMobile.intl",
            "org.mozilla.focus",
        )
    }
}
