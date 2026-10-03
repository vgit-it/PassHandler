package com.passhandler.app

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Debug-only preview harness for `VaultKeyboardView` — the whole
 * point is seeing every layout/spacing/text-size change to the manual-fill
 * keyboard by just hitting Run, without the real IME's dance (enable it in
 * Settings → Languages & input, switch to it in a text field) on every
 * iteration. This is the SAME view-building code the real `VaultIme`
 * uses, just handed sample data and no-op/toast stand-ins for the three
 * things that need a real IME session (committing text, switching
 * keyboards, launching Vault) — see `VaultKeyboardView`'s own
 * doc.
 *
 * "Lock vault" toggles between the sample entries and an empty list, so you
 * can preview both the full search/keypad view and the locked state
 * without two separate activities.
 *
 * Not referenced from any production code path — it's wired into the
 * manifest purely as its own launchable activity, for you to pick from
 * Android Studio's Run configuration or the launcher (it doesn't declare a
 * LAUNCHER intent-filter, so it won't show up as its own icon; run it via
 * `Select Run/Debug Configuration → Edit Configurations → Launch: Specified
 * Activity` pointed at this class, or `adb shell am start -n
 * com.passhandler.app/.VaultImePreviewActivity`).
 *
 * The one thing this can't preview: the real IME's window is a special
 * bottom-anchored overlay that resizes independently of whatever app is
 * behind it, so "does hiding the keypad actually free up space for the
 * OS's own nav bar" still needs a real device/emulator check. Everything
 * about spacing, sizing, colors, and text within the keyboard's own view
 * tree is faithfully previewed here, since it's the exact same builder
 * code running either way.
 */
class VaultImePreviewActivity : Activity() {

    private val fakeSource = FakePreviewEntrySource(sampleEntries()) { onFakeLocked() }
    private var locked = false
    private lateinit var keyboardView: VaultKeyboardView
    private lateinit var dockContainer: FrameLayout
    private lateinit var lockButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            // Mirrors `VaultKeyboardView`'s own `BACKGROUND` (they're
            // `private` there, so this separate Activity can't reference
            // them directly — kept in sync by hand instead) so this
            // wrapper chrome doesn't show a seam of the old palette around
            // the real keyboard view it hosts. Updated to the real
            // Android-app value as of the visual-parity pass — was
            // `#0A0D11` (the never-fully-applied `--vault-wall` attempt);
            // see `docs/ime-visual-parity-plan.md` for why that token isn't
            // the real target either.
            setBackgroundColor(Color.parseColor("#292c2f"))
        }

        val toggleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dip(16), dip(16), dip(16), dip(16))
        }
        val hint = TextView(this).apply {
            text = "IME preview — same view code as the real keyboard"
            // Mirrors `MUTED_FOREGROUND` — see the `root` background's own
            // doc above. Updated the same way, same pass — was `#8B949E`.
            setTextColor(Color.parseColor("#80D6E4EF"))
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        toggleRow.addView(hint)
        lockButton = Button(this).apply {
            text = "Lock vault"
            setOnClickListener { toggleLocked() }
        }
        toggleRow.addView(lockButton)
        root.addView(toggleRow)

        // Stands in for "the app behind the keyboard" — pushes the preview
        // down to the bottom of the screen, the same position the real IME
        // always renders in.
        val spacer = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        root.addView(spacer)

        dockContainer = FrameLayout(this)
        root.addView(
            dockContainer,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT),
        )

        keyboardView = VaultKeyboardView(
            context = this,
            entrySource = fakeSource,
            onViewChanged = { view ->
                dockContainer.removeAllViews()
                dockContainer.addView(view)
            },
            onCommitText = { text -> toast("Would fill: $text") },
            onSwitchToPreviousKeyboard = { toast("Would switch back to the previous keyboard") },
            onOpenVault = { toast("Would open Vault to unlock") },
            onClearField = { toast("Would clear the focused field") },
            onSendTab = { toast("Would press Tab") },
            // No real target field to read from here — returns a canned
            // sample each time so the "Grab" chip's UI flow (writing the
            // result into the draft, or the "nothing to grab" message) can
            // still be previewed end to end.
            onGrabFromField = {
                toast("Would grab from the focused field")
                "sample-grabbed-value"
            },
            // Clear's undo needs the field's text; the preview has no real
            // field, so this pretends there was something to restore.
            onReadField = { "sample field text" },
            onSwitchToNextKeyboard = { toast("Would switch to the next keyboard") },
            onShowKeyboardPicker = { toast("Would show the keyboard picker") },
            offersKeyboardSwitch = { true },
        )

        setContentView(root)
        // A sample title guess/signup hint, same as `VaultIme` would
        // supply from a real `EditorInfo` — see
        // `docs/ACCOUNT-CREATION-DESIGN.md`'s "Detect, best-effort" step —
        // so the account-creation panel's quiet-bias subtitle previews
        // correctly too. A fixed sample package name so quick-fill
        // ranking's frecency tier and the empty-query "Recent" list have
        // something to show once `QuickFillUsage.recordUse` runs a few
        // times from tapping Fill in this preview.
        keyboardView.setDetectedContext(
            titleGuess = "Sample App",
            likelySignup = true,
            packageName = "com.passhandler.app.preview",
            appLabel = "Sample App",
            isBrowser = false,
        )
        keyboardView.start()
    }

    override fun onDestroy() {
        super.onDestroy()
        keyboardView.stop()
    }

    private fun toggleLocked() {
        locked = !locked
        lockButton.text = if (locked) "Unlock vault" else "Lock vault"
        fakeSource.entries = if (locked) emptyList() else sampleEntries()
        // Same as reopening the picker fresh — mirrors what actually
        // happens on a real relock/unlock, and is what picks up the entry
        // list change.
        keyboardView.start()
    }

    /** Called from `fakeSource` when the keypad's own "Lock" key was
     * tapped — keeps this activity's top toggle button in sync with a lock
     * that happened from inside the keyboard, not from that button. */
    private fun onFakeLocked() {
        locked = true
        lockButton.text = "Unlock vault"
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun dip(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}

/** `entries` is `var`, not `val` — `VaultImePreviewActivity` swaps it
 * between the sample list and empty to simulate locking/unlocking. */
private class FakePreviewEntrySource(
    var entries: List<FillEntry>,
    private val onLocked: () -> Unit,
) : EntrySource {
    override fun listEntries(callback: (List<FillEntry>) -> Unit) = callback(entries)

    override fun readField(entryId: String, key: String, callback: (String?) -> Unit) {
        // Sensitive fields carry no value over the wire in the real bridge
        // either (see `FillField.value`) — this fakes the same "ask, then
        // get the plaintext back" round trip with a made-up value instead
        // of a real webview call.
        val field = entries.firstOrNull { it.id == entryId }?.fields?.firstOrNull { it.key == key }
        callback(field?.let { "sample-${it.key}" })
    }

    // No favicons in the preview — there's no webview to fetch through —
    // so every Login row shows its plate-and-globe fallback.
    override fun readIcon(entryId: String, callback: (SiteIconResult) -> Unit) = callback(SiteIconResult.None)

    override fun lockVault() {
        entries = emptyList()
        onLocked()
    }

    // Streamlined account creation — fakes the same in-memory draft
    // `store.tsx`'s `window.__vaultCreate` holds for real, entirely
    // locally, so the creation panel previews correctly too. See
    // docs/ACCOUNT-CREATION-DESIGN.md's "Any entry type" revision: this
    // isn't Login-only any more, so the fake also needs a small per-type
    // field table (`fakeDraftFields`) — not the real `entryTypes.ts`
    // registry (this file has no access to it), just enough variety (a
    // second password-bearing type, a type with no password at all) to
    // preview the Type row actually changing what's below it. Per the
    // later "Generator options" revision, `setDraftPasswordOptions` below
    // fakes a password that actually reflects the chosen length/classes
    // (unlike `generateDraftPassword`'s fixed sample), so the Options
    // panel's own controls preview visibly doing something too.
    private var draft: DraftSnapshot? = null

    override fun listEntryTypes(callback: (List<EntryTypeOption>) -> Unit) = callback(FAKE_ENTRY_TYPES)

    override fun startDraft(titleGuess: String) {
        draft = DraftSnapshot(
            type = "login",
            typeLabel = "Login",
            title = titleGuess,
            fields = fakeDraftFields("login"),
            passwordOptions = DEFAULT_FAKE_PASSWORD_OPTIONS,
        )
    }

    override fun setDraftType(type: String) {
        val current = draft ?: return
        val label = FAKE_ENTRY_TYPES.firstOrNull { it.id == type }?.label ?: return
        // Resets to the default options, same as the real bridge's own
        // `setDraftType` (`emptyDraft` on the JS side) — a type switch
        // resets everything but the title, generator settings included.
        draft = DraftSnapshot(
            type = type,
            typeLabel = label,
            title = current.title,
            fields = fakeDraftFields(type),
            passwordOptions = DEFAULT_FAKE_PASSWORD_OPTIONS,
        )
    }

    override fun getDraft(callback: (DraftSnapshot?) -> Unit) = callback(draft)

    override fun generateDraftPassword(callback: (String?) -> Unit) {
        val current = draft ?: return callback(null)
        if (current.fields.none { it.key == "password" }) return callback(null)
        val generated = "Sample-Gen-Pw1!".take(current.passwordOptions.length.coerceAtLeast(1))
        draft = withFakeStrength(current.copy(fields = current.fields.map { if (it.key == "password") it.copy(value = generated) else it }))
        callback(generated)
    }

    override fun setDraftPasswordOptions(options: PasswordOptions, callback: (String?) -> Unit) {
        val current = draft ?: return callback(null)
        if (current.fields.none { it.key == "password" }) return callback(null)
        // A canned password that actually reflects the chosen length/
        // classes, unlike `generateDraftPassword`'s fixed sample — so
        // dragging the length slider or toggling a class visibly does
        // something in the preview instead of always showing the same
        // string.
        val pool = buildString {
            if (options.uppercase) append("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
            if (options.lowercase) append("abcdefghijklmnopqrstuvwxyz")
            if (options.numbers) append("0123456789")
            if (options.symbols) append("!#\$%&*")
        }.ifEmpty { "abcdefghijklmnopqrstuvwxyz" }
        val generated = (0 until options.length).joinToString("") { pool[it % pool.length].toString() }
        draft = withFakeStrength(
            current.copy(
                passwordOptions = options,
                fields = current.fields.map { if (it.key == "password") it.copy(value = generated) else it },
            ),
        )
        callback(generated)
    }

    // Canned addresses — not derived from `entries` (none of the sample
    // entries below happen to have an email-shaped field), same "made-up
    // value" convention `readField` above already uses. Six, so the inline
    // list's four-visible-rows-then-scroll behaviour is actually visible.
    override fun listKnownEmails(callback: (List<String>) -> Unit) =
        callback(
            listOf(
                "paul@example.com",
                "paul.work@example.com",
                "paul.shop@example.com",
                "family@example.com",
                "recovery@example.com",
                "old.address@example.org",
            ),
        )

    override fun setDraftField(key: String, value: String) {
        val current = draft ?: return
        if (current.fields.none { it.key == key }) return
        draft = withFakeStrength(current.copy(fields = current.fields.map { if (it.key == key) it.copy(value = value) else it }))
    }

    override fun commitDraft(callback: (Boolean) -> Unit) {
        val committed = draft != null
        draft = null
        callback(committed)
    }

    override fun cancelDraft() {
        draft = null
    }
}

/** `FakePreviewEntrySource.listEntryTypes`'s canned answer — four of the
 * real registry's types, matching `sampleEntries()`'s own four types below
 * for a bit of symmetry, not an attempt at the full ~15-type list. */
private val FAKE_ENTRY_TYPES = listOf(
    EntryTypeOption("login", "Login"),
    EntryTypeOption("card", "Card"),
    EntryTypeOption("wifi", "WiFi"),
    EntryTypeOption("secureNote", "Secure Note"),
)

/** Canned stand-in for `estimateStrength` (`crypto/generator.ts`), which this
 * file can't call — length-based only, just enough for the strength bar to
 * visibly react while previewing. `null` while the password is empty, same
 * as the real `DraftSnapshot.passwordStrength`. */
private fun withFakeStrength(draft: DraftSnapshot): DraftSnapshot {
    val password = draft.fields.firstOrNull { it.key == "password" }?.value.orEmpty()
    if (password.isEmpty()) return draft.copy(passwordStrength = null)
    val score = when {
        password.length < 8 -> 1
        password.length < 12 -> 2
        password.length < 16 -> 3
        else -> 4
    }
    val label = listOf("Empty", "Weak", "Fair", "Good", "Strong")[score]
    return draft.copy(passwordStrength = PasswordStrength(score, label))
}

/** `FakePreviewEntrySource`'s starting generator settings — mirrors
 * `crypto/generator.ts`'s own `DEFAULT_OPTIONS`, since this file has no
 * access to that module either (same reasoning as `fakeDraftFields` not
 * reading the real `entryTypes.ts` registry). */
private val DEFAULT_FAKE_PASSWORD_OPTIONS =
    PasswordOptions(length = 20, uppercase = true, lowercase = true, numbers = true, symbols = true)

/** `FakePreviewEntrySource`'s per-type field table — see `draft`'s own doc
 * above for why this exists instead of reading the real registry. */
private fun fakeDraftFields(type: String): List<DraftFieldSnapshot> = when (type) {
    "card" -> listOf(
        DraftFieldSnapshot("number", "Number", "", sensitive = true, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("expiry", "Expiry", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("cvv", "CVV", "", sensitive = true, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("nameOnCard", "Name on card", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("notes", "Notes", "", sensitive = false, canGenerate = false, canPickFromVault = false),
    )
    "wifi" -> listOf(
        DraftFieldSnapshot("ssid", "SSID", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("password", "Password", "", sensitive = true, canGenerate = true, canPickFromVault = false),
        DraftFieldSnapshot("notes", "Notes", "", sensitive = false, canGenerate = false, canPickFromVault = false),
    )
    "secureNote" -> listOf(
        DraftFieldSnapshot("body", "Body", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("notes", "Notes", "", sensitive = false, canGenerate = false, canPickFromVault = false),
    )
    else -> listOf(
        DraftFieldSnapshot("username", "Username", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("email", "Email", "", sensitive = false, canGenerate = false, canPickFromVault = true),
        DraftFieldSnapshot("password", "Password", "", sensitive = true, canGenerate = true, canPickFromVault = false),
        DraftFieldSnapshot("url", "Website", "", sensitive = false, canGenerate = false, canPickFromVault = false),
        DraftFieldSnapshot("notes", "Notes", "", sensitive = false, canGenerate = false, canPickFromVault = false),
    )
}

/** A handful of entries covering what the detail view needs to show off:
 * a mix of sensitive and non-sensitive fields, a multi-field entry (Card),
 * and a title long enough to check the result row's truncation. */
private fun sampleEntries(): List<FillEntry> = listOf(
    FillEntry(
        id = "preview-login",
        title = "Amazon",
        type = "login",
        typeLabel = "Login",
        fields = listOf(
            FillField("username", "Username", "paul@example.com", sensitive = false, dataType = "text", fillable = true),
            FillField("password", "Password", "", sensitive = true, dataType = "text", fillable = true),
        ),
    ),
    FillEntry(
        id = "preview-card",
        title = "Chase Sapphire",
        type = "card",
        typeLabel = "Card",
        fields = listOf(
            FillField("number", "Card number", "", sensitive = true, dataType = "text", fillable = true),
            FillField("expiry", "Expiry", "11/28", sensitive = false, dataType = "text", fillable = true),
            FillField("cvv", "CVV", "", sensitive = true, dataType = "text", fillable = true),
            FillField("name", "Name on card", "Paul R. Whitfield", sensitive = false, dataType = "text", fillable = true),
        ),
    ),
    FillEntry(
        id = "preview-wifi",
        title = "Home Wi-Fi",
        type = "wifi",
        typeLabel = "WiFi",
        fields = listOf(
            FillField("ssid", "SSID", "Netgear_5G_2E4", sensitive = false, dataType = "text", fillable = true),
            FillField("password", "Password", "", sensitive = true, dataType = "text", fillable = true),
        ),
    ),
    FillEntry(
        id = "preview-note",
        title = "A long entry title that should truncate with an ellipsis",
        type = "note",
        typeLabel = "Secure Note",
        fields = listOf(
            FillField("note", "Note", "Just some sample text", sensitive = false, dataType = "multiline", fillable = true),
        ),
    ),
)
