package com.passhandler.app

import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.lang.ref.WeakReference

/**
 * The one link between Vault's native Android code and its
 * already-unlocked vault, which lives only in the running app's WebView —
 * see SECURITY.md and docs/MANUAL-FILL-DESIGN.md. This never decrypts
 * anything itself; it only asks the webview, via `evaluateJavascript`, the
 * same questions the copy-password button already asks it.
 *
 * A process-wide singleton because `VaultIme` is a genuinely separate
 * Android component from `MainActivity` — there is no constructor argument
 * to hand it a reference through. `MainActivity.onWebViewCreate` is the only
 * writer. `VaultIme` (via `VaultKeyboardView`) is the only
 * reader, of every function below — including the streamlined
 * account-creation draft functions, added alongside the original
 * fill-only ones; see `docs/ACCOUNT-CREATION-DESIGN.md`.
 */
object WebViewBridge {
    // A weak reference, not a strong one: this object has no lifecycle of
    // its own and outlives any single Activity instance, so a strong
    // reference here would keep a destroyed Activity's WebView (and
    // everything it holds) alive for as long as the process runs.
    private var webViewRef: WeakReference<WebView>? = null

    fun attach(webView: WebView) {
        webViewRef = WeakReference(webView)
    }

    /** Called from `MainActivity.onDestroy`. Not load-bearing on its own —
     * the weak reference already stops pinning memory — but it means a
     * destroyed Activity's webview stops answering fill requests the
     * instant it's destroyed, not just whenever the GC gets around to it. */
    fun detach(webView: WebView) {
        if (webViewRef?.get() === webView) {
            webViewRef = null
        }
    }

    /**
     * True only while a webview is attached and still reachable. This is
     * not the same as "the vault is unlocked" — `listEntries` genuinely
     * asking is the only way to know that, since Android native code is
     * never told the vault's lock state directly (see this object's own
     * doc). Used only to choose which of two "nothing to show" messages the
     * picker displays.
     */
    val isAttached: Boolean
        get() = webViewRef?.get() != null

    /**
     * The unlocked vault's entries, or an empty list if the vault isn't
     * unlocked, the app isn't running, or the JS bridge isn't installed for
     * any other reason. `store.tsx` only installs `window.__vaultFill`
     * while `phase === 'unlocked'` — see its own comment — so "nothing came
     * back" and "vault is locked" are deliberately the same outcome here.
     * This is what makes "fails closed if not unlocked" true without this
     * object ever having to ask a separate question first.
     */
    fun listEntries(callback: (List<FillEntry>) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(emptyList())
            return
        }
        webView.post {
            webView.evaluateJavascript(LIST_ENTRIES_SCRIPT) { raw ->
                callback(parseEntries(raw))
            }
        }
    }

    /**
     * The plaintext for one sensitive field on one entry — Login's password,
     * a Card's number or CVV, a custom field marked sensitive, whatever `key`
     * names. Fetched only once a field is actually picked, exactly like the
     * old copy-password button did it — never listed alongside the entries
     * (see `FillField.value`, always `""` for a sensitive field), never
     * cached here afterwards.
     *
     * Generalises what used to be a `readPassword(entryId)` with no `key` —
     * password was the only sensitive field a `FillEntry` could ever have.
     * Now that a row can offer a Card's Number and CVV and Login's Password
     * all as separate fill buttons, "which field" has to travel with the
     * request.
     */
    fun readField(entryId: String, key: String, callback: (String?) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(null)
            return
        }
        webView.post {
            val script =
                "window.__vaultFill && window.__vaultFill.readField(${jsStringLiteral(entryId)}, ${jsStringLiteral(key)})"
            webView.evaluateJavascript(script) { raw ->
                callback(parseNullableString(raw))
            }
        }
    }

    /**
     * One Login entry's site icon (favicon) for a result row — see
     * `SiteIconResult` and `store.tsx`'s `readIcon`. The webview does the
     * fetching and caching through the app's own favicon path; this side
     * never touches the network. A detached webview or a missing bridge
     * answers `None`, same "fails closed" shape as `listEntries`.
     */
    fun readIcon(entryId: String, callback: (SiteIconResult) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(SiteIconResult.None)
            return
        }
        webView.post {
            val script =
                "window.__vaultFill && window.__vaultFill.readIcon && window.__vaultFill.readIcon(${jsStringLiteral(entryId)})"
            webView.evaluateJavascript(script) { raw ->
                callback(parseSiteIcon(raw))
            }
        }
    }

    /**
     * Fire-and-forget: ask the running app to lock the vault right now.
     * Used by the manual-fill keyboard's own "Lock" key — the picker
     * doesn't wait for a reply (there isn't one) and instead updates its
     * own display immediately; the next `listEntries` poll (or this same
     * call, if the app is slower) confirms it for real. If the webview
     * isn't attached, there's nothing to lock and this is a no-op — which
     * is fine, since `listEntries` already reports an empty vault whenever
     * that's true anyway.
     */
    fun lockVault() {
        val webView = webViewRef?.get() ?: return
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultFill && window.__vaultFill.lock && window.__vaultFill.lock()",
                null,
            )
        }
    }

    // ── Streamlined account creation ────────────────────────────────────
    // See `docs/ACCOUNT-CREATION-DESIGN.md`. Every function here is a thin
    // pass-through to `window.__vaultCreate` (installed by
    // `store.tsx`, same shape as `window.__vaultFill` above), which
    // holds the actual in-progress draft — this object never sees the
    // draft's field values except in transit.

    /** Fire-and-forget: starts a brand-new Login draft, discarding whatever
     * uncommitted one might already exist. `titleGuess` is this device's
     * best-effort guess at what the user is signing up for — see
     * `VaultIme.resolveTitleGuess`'s doc — and may be empty.
     * `setDraftType` switches it to a different type afterwards. */
    fun startDraft(titleGuess: String) {
        val webView = webViewRef?.get() ?: return
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.startDraft(${jsStringLiteral(titleGuess)})",
                null,
            )
        }
    }

    /** Every selectable entry type, for the creation panel's "Type" row —
     * empty if the webview isn't reachable, same fail-quiet convention
     * `listEntries` uses. Independent of any draft being active. */
    fun listEntryTypes(callback: (List<EntryTypeOption>) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(emptyList())
            return
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.listEntryTypes()",
            ) { raw -> callback(parseEntryTypes(raw)) }
        }
    }

    /** Fire-and-forget: switches the in-progress draft to a different type
     * — see `VaultCreateBridge.setDraftType`'s doc on the JS side for
     * what happens to any values already filled in. */
    fun setDraftType(type: String) {
        val webView = webViewRef?.get() ?: return
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.setDraftType(${jsStringLiteral(type)})",
                null,
            )
        }
    }

    /** The in-progress draft, or `null` if none is active or the webview
     * isn't reachable. Unlike `listEntries`, every field comes back with
     * its real value — see `DraftSnapshot`'s own doc. */
    fun getDraft(callback: (DraftSnapshot?) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(null)
            return
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.getDraft()",
            ) { raw -> callback(parseDraft(raw)) }
        }
    }

    /** Generates a fresh password into the draft and hands back the
     * plaintext once, for the keyboard to type — see
     * `VaultCreateBridge.generateDraftPassword`'s doc on the JS side.
     * `null` if there's no draft, the current type has no `password` field,
     * or the webview isn't reachable. */
    fun generateDraftPassword(callback: (String?) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(null)
            return
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.generateDraftPassword()",
            ) { raw -> callback(parseNullableString(raw)) }
        }
    }

    /** Changes the draft's generator settings and immediately regenerates
     * with them, handing back the fresh plaintext — see
     * `VaultCreateBridge.setDraftPasswordOptions`'s doc on the JS
     * side, which does the actual clamping/validation; this side just
     * relays `options` as a plain JS object literal. No string values here
     * (an `Int` and four `Boolean`s), so unlike `startDraft`/`setDraftField`
     * this needs no `jsStringLiteral` escaping — a `Boolean`'s own
     * `toString()` already is the JS literal `true`/`false`. */
    fun setDraftPasswordOptions(options: PasswordOptions, callback: (String?) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(null)
            return
        }
        val optionsLiteral = "{length:${options.length}," +
            "uppercase:${options.uppercase}," +
            "lowercase:${options.lowercase}," +
            "numbers:${options.numbers}," +
            "symbols:${options.symbols}}"
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.setDraftPasswordOptions($optionsLiteral)",
            ) { raw -> callback(parseNullableString(raw)) }
        }
    }

    /** Every distinct email-shaped value already stored anywhere in the
     * vault, for the Email field's own "Pick from Vault" dropdown — see
     * `VaultCreateBridge.listKnownEmails`'s doc on the JS side.
     * Independent of any draft being active. */
    fun listKnownEmails(callback: (List<String>) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(emptyList())
            return
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.listKnownEmails()",
            ) { raw -> callback(parseStringArray(raw)) }
        }
    }

    /** Fire-and-forget: records a picked value — from the search/detail
     * picker, or (Email only) `listKnownEmails`'s own dropdown — into the
     * draft's `key` field. The picker has already committed `value` into
     * the focused app field itself by the time this is called — this only
     * keeps the draft in sync. */
    fun setDraftField(key: String, value: String) {
        val webView = webViewRef?.get() ?: return
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.setDraftField(${jsStringLiteral(key)}, ${jsStringLiteral(value)})",
                null,
            )
        }
    }

    /** Commits the draft to the vault now. `false` if there's no draft, it
     * has nothing worth saving, or the webview isn't reachable. */
    fun commitDraft(callback: (Boolean) -> Unit) {
        val webView = webViewRef?.get()
        if (webView == null) {
            callback(false)
            return
        }
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.commitDraft()",
            ) { raw -> callback(raw == "true") }
        }
    }

    /** Fire-and-forget: discards the draft without saving anything. */
    fun cancelDraft() {
        val webView = webViewRef?.get() ?: return
        webView.post {
            webView.evaluateJavascript(
                "window.__vaultCreate && window.__vaultCreate.cancelDraft()",
                null,
            )
        }
    }

    private const val LIST_ENTRIES_SCRIPT =
        "window.__vaultFill && window.__vaultFill.listEntries()"

    /**
     * Escapes `value` for embedding as a single-quoted JS string literal in
     * an `evaluateJavascript` call. Used for entry IDs (narrow, always
     * this app's own generated text) and, since the account-creation draft
     * functions were added, also for arbitrary field values and picked
     * entry text — so this has to be a real general-purpose escape, not
     * just backslash/quote: the two JS line-terminator characters
     * (U+2028/U+2029) are illegal inside an unescaped string literal even
     * though they're ordinary characters everywhere else, and a bare
     * newline would otherwise break the call across lines.
     */
    private fun jsStringLiteral(value: String): String {
        // Matched by Unicode code point rather than a char literal for
        // the two JS line-terminator characters (U+2028/U+2029) — both
        // are invisible in source and too easy to corrupt into a plain
        // space by an editor or a copy/paste, so this avoids embedding
        // either literally at all.
        val escaped = buildString(value.length + 2) {
            for (c in value) {
                when (c.code) {
                    0x5C -> append("\\\\") // backslash
                    0x27 -> append("\\'") // '
                    0x0A -> append("\\n") // newline
                    0x0D -> append("\\r") // carriage return
                    0x2028 -> append("\\u2028") // JS line separator
                    0x2029 -> append("\\u2029") // JS paragraph separator
                    else -> append(c)
                }
            }
        }
        return "'$escaped'"
    }

    private fun parseEntries(raw: String?): List<FillEntry> {
        if (raw.isNullOrEmpty() || raw == "null") return emptyList()
        return try {
            val array = JSONTokener(raw).nextValue() as? JSONArray ?: return emptyList()
            (0 until array.length()).mapNotNull { i ->
                val obj = array.optJSONObject(i) ?: return@mapNotNull null
                val id = obj.optString("id", "")
                if (id.isEmpty()) {
                    null
                } else {
                    val type = obj.optString("type", "login")
                    FillEntry(
                        id = id,
                        title = obj.optString("title", ""),
                        type = type,
                        typeLabel = obj.optString("typeLabel", "").ifEmpty { type },
                        fields = parseFields(obj.optJSONArray("fields")),
                    )
                }
            }
        } catch (_: Exception) {
            // Malformed JS-side output is not this object's problem to
            // diagnose — an empty list here just means the picker shows
            // "nothing to fill," same as any other reason it might be empty.
            emptyList()
        }
    }

    /** Same shape as `src/vault/types.ts`'s `EntryField` — this is a direct
     * pass-through of `entry.fields` from `Vault.listEntries()`, not a
     * separate wire format, so there is exactly one place that decides what
     * a field looks like. A malformed individual field is skipped rather
     * than failing the whole entry — one bad field shouldn't hide an
     * otherwise-fillable row. */
    private fun parseFields(array: JSONArray?): List<FillField> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val obj = array.optJSONObject(i) ?: return@mapNotNull null
            val key = obj.optString("key", "")
            if (key.isEmpty()) return@mapNotNull null
            FillField(
                key = key,
                label = obj.optString("label", key),
                value = obj.optString("value", ""),
                sensitive = obj.optBoolean("sensitive", false),
                dataType = obj.optString("dataType", "text"),
                fillable = obj.optBoolean("fillable", true),
            )
        }
    }

    private fun parseSiteIcon(raw: String?): SiteIconResult {
        if (raw.isNullOrEmpty() || raw == "null") return SiteIconResult.None
        return try {
            val obj = JSONTokener(raw).nextValue() as? JSONObject ?: return SiteIconResult.None
            when (obj.optString("status", "none")) {
                "ready" -> {
                    val data = obj.optString("dataBase64", "")
                    if (data.isEmpty()) SiteIconResult.None else SiteIconResult.Ready(data)
                }
                "pending" -> SiteIconResult.Pending
                else -> SiteIconResult.None
            }
        } catch (_: Exception) {
            SiteIconResult.None
        }
    }

    private fun parseNullableString(raw: String?): String? {
        if (raw.isNullOrEmpty() || raw == "null") return null
        return try {
            JSONTokener(raw).nextValue() as? String
        } catch (_: Exception) {
            null
        }
    }

    /** A flat JS array of strings — `listKnownEmails`' own wire shape. Any
     * element that isn't actually a string is dropped rather than failing
     * the whole list, same "one bad entry doesn't hide the rest" reasoning
     * `parseFields` uses. */
    private fun parseStringArray(raw: String?): List<String> {
        if (raw.isNullOrEmpty() || raw == "null") return emptyList()
        return try {
            val array = JSONTokener(raw).nextValue() as? JSONArray ?: return emptyList()
            (0 until array.length()).mapNotNull { i -> array.opt(i) as? String }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** `listEntryTypes`'s own wire shape — id + label pairs, same
     * malformed-entry-skipping convention as `parseEntries`. */
    private fun parseEntryTypes(raw: String?): List<EntryTypeOption> {
        if (raw.isNullOrEmpty() || raw == "null") return emptyList()
        return try {
            val array = JSONTokener(raw).nextValue() as? JSONArray ?: return emptyList()
            (0 until array.length()).mapNotNull { i ->
                val obj = array.optJSONObject(i) ?: return@mapNotNull null
                val id = obj.optString("id", "")
                if (id.isEmpty()) null else EntryTypeOption(id, obj.optString("label", id))
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    /** Mirrors `DraftState`/`draftSnapshot` on the JS side one-to-one —
     * see `DraftSnapshot`'s own doc. Every field value is real, not the
     * empty-string-for-sensitive convention `parseFields` uses for
     * `FillField` — see that class's own doc for why the draft is
     * different. */
    private fun parseDraft(raw: String?): DraftSnapshot? {
        if (raw.isNullOrEmpty() || raw == "null") return null
        return try {
            val obj = JSONTokener(raw).nextValue() as? JSONObject ?: return null
            DraftSnapshot(
                type = obj.optString("type", "login"),
                typeLabel = obj.optString("typeLabel", "Login"),
                title = obj.optString("title", ""),
                fields = parseDraftFields(obj.optJSONArray("fields")),
                passwordOptions = parsePasswordOptions(obj.optJSONObject("passwordOptions")),
                passwordStrength = parsePasswordStrength(obj.optJSONObject("passwordStrength")),
            )
        } catch (_: Exception) {
            null
        }
    }

    /** `DraftSnapshot.passwordOptions`'s own wire shape — mirrors
     * `crypto/generator.ts`'s `DEFAULT_OPTIONS` for every default below, so
     * a missing/malformed object (there should never actually be one, since
     * `draftSnapshot` on the JS side always sets this) still lands on the
     * same settings the app's own password field starts from. */
    private fun parsePasswordOptions(obj: JSONObject?): PasswordOptions {
        return PasswordOptions(
            length = obj?.optInt("length", 20) ?: 20,
            uppercase = obj?.optBoolean("uppercase", true) ?: true,
            lowercase = obj?.optBoolean("lowercase", true) ?: true,
            numbers = obj?.optBoolean("numbers", true) ?: true,
            symbols = obj?.optBoolean("symbols", true) ?: true,
        )
    }

    /** `DraftSnapshot.passwordStrength`'s own wire shape — `null` on the JS
     * side while the password is empty, which arrives here as either a
     * missing key or JSON `null` (`optJSONObject` returns `null` for both). */
    private fun parsePasswordStrength(obj: JSONObject?): PasswordStrength? {
        if (obj == null) return null
        return PasswordStrength(
            score = obj.optInt("score", 0).coerceIn(0, 4),
            label = obj.optString("label", ""),
        )
    }

    /** One draft field, same shape as `FillField` plus the two flags that
     * decide which of Generate/Pick-from-Vault it gets — see
     * `DraftFieldSnapshot`'s own doc. */
    private fun parseDraftFields(array: JSONArray?): List<DraftFieldSnapshot> {
        if (array == null) return emptyList()
        return (0 until array.length()).mapNotNull { i ->
            val obj = array.optJSONObject(i) ?: return@mapNotNull null
            val key = obj.optString("key", "")
            if (key.isEmpty()) return@mapNotNull null
            DraftFieldSnapshot(
                key = key,
                label = obj.optString("label", key),
                value = obj.optString("value", ""),
                sensitive = obj.optBoolean("sensitive", false),
                canGenerate = obj.optBoolean("canGenerate", false),
                canPickFromVault = obj.optBoolean("canPickFromVault", false),
            )
        }
    }
}

/** Enough to render a picker row and every one of its fill buttons — never a
 * sensitive field's value (see `FillField.value`). `type` is the registry id
 * ("secureNote"), for logic; `typeLabel` its display name ("Secure Note"),
 * for anything shown — never show `type` itself. */
data class FillEntry(
    val id: String,
    val title: String,
    val type: String,
    val typeLabel: String,
    val fields: List<FillField>,
)

/** Mirrors `store.tsx`'s `SiteIconResult`. `Ready` carries the image bytes
 * still base64-encoded — decoding is the view's job (`VaultKeyboardView`),
 * and an undecodable format (an SVG favicon, say) is treated there exactly
 * like `None`. The JS side's `mime` isn't carried over: `BitmapFactory`
 * sniffs the format from the bytes themselves. */
sealed class SiteIconResult {
    class Ready(val dataBase64: String) : SiteIconResult()
    object Pending : SiteIconResult()
    object None : SiteIconResult()
}

/** Mirrors `src/vault/types.ts`'s `EntryField` one-to-one. `dataType` is
 * carried through as the raw string `entry-types.ts` uses ("text",
 * "multiline", …) rather than a Kotlin enum — the only thing this side ever
 * needs to know about it is whether it's `"multiline"`, for search and the
 * row subtitle in `VaultIme`. */
data class FillField(
    val key: String,
    val label: String,
    val value: String,
    val sensitive: Boolean,
    val dataType: String,
    val fillable: Boolean,
)

/** One selectable entry type, for the creation panel's "Type" row — mirrors
 * `entryTypes.ts`'s registry down to just what a dropdown row needs. */
data class EntryTypeOption(val id: String, val label: String)

/** One field of an in-progress draft — mirrors `store.tsx`'s
 * `DraftFieldSnapshot` one-to-one. `canGenerate`/`canPickFromVault` are
 * resolved on the JS side (see that class's own doc for why: it's the one
 * place that knows a type's field shapes), not re-derived here from `key`
 * — this side only ever renders whichever of them come back `true`. */
data class DraftFieldSnapshot(
    val key: String,
    val label: String,
    val value: String,
    val sensitive: Boolean,
    val canGenerate: Boolean,
    val canPickFromVault: Boolean,
)

/** One in-progress streamlined-account-creation draft — see
 * `docs/ACCOUNT-CREATION-DESIGN.md`'s "Any entry type" revision. Mirrors
 * `store.tsx`'s `DraftSnapshot` one-to-one; every field carries a real
 * plaintext value, since none of this is in the vault (or vault-protected)
 * yet. No longer Login-specific — `type`/`typeLabel` name whichever type is
 * currently selected, and `fields` is that type's own field list (Login's
 * fixed Username/Email/Password/URL/Notes, or another type's registry
 * fields), not a fixed five-property shape. `passwordOptions` is always
 * present, even for a type with no `password` field — see that property's
 * own doc on the JS side for why. */
data class DraftSnapshot(
    val type: String,
    val typeLabel: String,
    val title: String,
    val fields: List<DraftFieldSnapshot>,
    val passwordOptions: PasswordOptions,
    val passwordStrength: PasswordStrength? = null,
)

/** `crypto/generator.ts`'s `StrengthEstimate` — `score` is 0 (hopeless) to 4
 * (strong), `label` the words shown beside the bar. Computed on the JS side
 * (`DraftSnapshot.passwordStrength`); the IME's strength bar never derives it
 * itself. */
data class PasswordStrength(val score: Int, val label: String)

/** A draft's generator settings — mirrors `crypto/generator.ts`'s
 * `GeneratorOptions` one-to-one (see `docs/ACCOUNT-CREATION-DESIGN.md`'s
 * "Generator options" revision), for the IME's own "Options" panel
 * (`VaultKeyboardView.buildPasswordOptionsPanel`). `length` is kept
 * within 8..64 by the JS side
 * (`crypto/generator.ts`'s `clampLength`) — this side's `SeekBar` uses the
 * same bounds only to match its range, not as a second enforcement point. */
data class PasswordOptions(
    val length: Int,
    val uppercase: Boolean,
    val lowercase: Boolean,
    val numbers: Boolean,
    val symbols: Boolean,
)
