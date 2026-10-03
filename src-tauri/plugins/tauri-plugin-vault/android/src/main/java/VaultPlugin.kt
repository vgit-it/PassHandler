package com.vault.plugin

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.Settings
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import androidx.activity.result.ActivityResult
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class SecureStoreSetArgs {
    lateinit var slot: String
    lateinit var value: String
}

@InvokeArg
class SecureStoreGetArgs {
    lateinit var slot: String
    var reason: String? = null
}

@InvokeArg
class SecureStoreDeleteArgs {
    lateinit var slot: String
}

@InvokeArg
class BiometricAuthenticateArgs {
    lateinit var reason: String
}

@InvokeArg
class ScreenCaptureArgs {
    var blocked: Boolean = false
}

@InvokeArg
class ClipboardWriteArgs {
    lateinit var text: String
}

@InvokeArg
class ClipboardClearArgs {
    lateinit var expected: String
}

@InvokeArg
class ClipboardScheduleClearArgs {
    var delayMs: Long = 0
}

@InvokeArg
class ExportVaultArgs {
    lateinit var contentsB64: String
    lateinit var suggestedName: String
}

/**
 * Android half of the Vault native plugin.
 *
 * Secrets are held in [EncryptedSharedPreferences], whose master key lives in
 * the Android Keystore and is generated with `StrongBox` where the device
 * offers it. The key material itself never leaves the Keystore — only
 * ciphertext is written to disk.
 *
 * Reading a slot marked as requiring user presence is gated by
 * [BiometricPrompt] first. That is an app-level gate rather than a
 * Keystore-level `setUserAuthenticationRequired` binding; see docs/SECURITY.md
 * for why, and what it does and does not buy.
 */
@TauriPlugin
class VaultPlugin(private val activity: Activity) : Plugin(activity) {

    private companion object {
        // Deliberately still "com.passhandler.app" — matches the app's own
        // `applicationId`/`tauri.conf.json` `identifier`, unchanged even
        // after the app's display name became "Vault" (see `models.rs`'s
        // `SERVICE_NAME`, the Windows twin of this same decision). This is
        // Android's own app-private storage namespace, not a label — renaming
        // it would orphan every secret already written here, invisibly (the
        // app would just look never-enrolled, not broken).
        const val PREFS_FILE = "com.passhandler.app.secrets"

        const val SLOT_DRIVE_REFRESH_TOKEN = "driveRefreshToken"
        const val SLOT_BIOMETRIC_KEY_MATERIAL = "biometricKeyMaterial"

        /** Android 13 named this; earlier releases honour the raw key. */
        const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

        /** Emitted to the webview when Google redirects back after consent. */
        const val EVENT_OAUTH_CALLBACK = "oauth-callback"

        const val OAUTH_REDIRECT_PATH = "/oauth2redirect"
    }

    /**
     * Google returns from the consent screen through a custom-scheme intent
     * rather than a loopback socket, because Android OAuth clients do not
     * accept loopback redirects.
     *
     * The URL is handed to the webview, which passes it back to
     * `drive_complete_auth`. Rust is where the `state` parameter is checked and
     * the code is exchanged — this is only delivery.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        forwardOauthRedirect(intent)
    }

    private fun forwardOauthRedirect(intent: Intent?) {
        val uri = intent?.data ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        if (!uri.scheme.orEmpty().startsWith("com.googleusercontent.apps.")) return
        if (uri.path != OAUTH_REDIRECT_PATH) return

        val payload = JSObject()
        payload.put("url", uri.toString())
        trigger(EVENT_OAUTH_CALLBACK, payload)
    }

    private val prefs by lazy {
        EncryptedSharedPreferences.create(
            activity,
            PREFS_FILE,
            masterKey(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Prefer a StrongBox-backed key — a separate secure element rather than the
     * TEE — and fall back to a plain Keystore key on devices without one. The
     * fallback is still hardware-backed on every device this app targets.
     */
    private fun masterKey(): MasterKey {
        fun build(strongBox: Boolean) =
            MasterKey.Builder(activity, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .setRequestStrongBoxBacked(strongBox)
                .build()

        return try {
            build(strongBox = true)
        } catch (_: Exception) {
            build(strongBox = false)
        }
    }

    private fun slotKey(slot: String): String? = when (slot) {
        SLOT_DRIVE_REFRESH_TOKEN, SLOT_BIOMETRIC_KEY_MATERIAL -> slot
        // An unrecognised slot is a bug or an attempt to reach outside the two
        // entries this app owns. Neither should be honoured.
        else -> null
    }

    private fun requiresUserPresence(slot: String) = slot == SLOT_BIOMETRIC_KEY_MATERIAL

    // ------------------------------------------------------------- secrets

    @Command
    fun secureStoreSet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureStoreSetArgs::class.java)
        val key = slotKey(args.slot) ?: return invoke.reject("invalid argument")
        if (args.value.isEmpty()) return invoke.reject("invalid argument")

        try {
            prefs.edit().putString(key, args.value).apply()
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("storage failure")
        }
    }

    @Command
    fun secureStoreGet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureStoreGetArgs::class.java)
        val key = slotKey(args.slot) ?: return invoke.reject("invalid argument")

        if (!requiresUserPresence(args.slot)) {
            return respondWithSlot(invoke, key)
        }

        promptBiometric(
            reason = args.reason ?: "Unlock your vault",
            onSuccess = { respondWithSlot(invoke, key) },
            onFailure = { code -> invoke.reject(code) },
        )
    }

    private fun respondWithSlot(invoke: Invoke, key: String) {
        try {
            val result = JSObject()
            // Absent and present are different answers: absent means "offer to
            // set this up", denied means "fall back to the master password".
            result.put("value", prefs.getString(key, null))
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("storage failure")
        }
    }

    @Command
    fun secureStoreDelete(invoke: Invoke) {
        val args = invoke.parseArgs(SecureStoreDeleteArgs::class.java)
        val key = slotKey(args.slot) ?: return invoke.reject("invalid argument")

        try {
            prefs.edit().remove(key).apply()
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("storage failure")
        }
    }

    // ----------------------------------------------------------- biometric

    @Command
    fun biometricStatus(invoke: Invoke) {
        val manager = BiometricManager.from(activity)
        val status = manager.canAuthenticate(authenticators())

        val reason = when (status) {
            BiometricManager.BIOMETRIC_SUCCESS -> null
            BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no-sensor"
            BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "device-busy"
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "not-enrolled"
            BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "update-required"
            else -> "unavailable"
        }

        val result = JSObject()
        result.put("available", reason == null)
        result.put("reason", reason)
        invoke.resolve(result)
    }

    @Command
    fun biometricAuthenticate(invoke: Invoke) {
        val args = invoke.parseArgs(BiometricAuthenticateArgs::class.java)
        promptBiometric(
            reason = args.reason,
            onSuccess = { invoke.resolve(JSObject()) },
            onFailure = { code -> invoke.reject(code) },
        )
    }

    /**
     * Deliberately excludes `DEVICE_CREDENTIAL`. What this gates —
     * `secureStoreGet`'s read of `BIOMETRIC_KEY_MATERIAL` — is a
     * password-equivalent secret (see docs/SECURITY.md): anything that
     * passes this check can open the vault. Allowing device credential here
     * would mean anyone who knows the phone's lock-screen PIN or pattern,
     * not just whoever's fingerprint is enrolled, could pass it. A phone
     * with no biometric hardware enrolled simply doesn't get this feature —
     * `biometricStatus` (below) reports it unavailable, same as it would for
     * no sensor at all, and the master password remains the way in.
     */
    private fun authenticators(): Int = BiometricManager.Authenticators.BIOMETRIC_STRONG

    private fun promptBiometric(
        reason: String,
        onSuccess: () -> Unit,
        onFailure: (String) -> Unit,
    ) {
        val fragmentActivity = activity as? FragmentActivity
        if (fragmentActivity == null) {
            onFailure("unavailable")
            return
        }

        // `BiometricPrompt` needs its host Activity actually resumed to show
        // anything. Calling `authenticate()` on a backgrounded Activity
        // doesn't fail loudly — the system just never shows the prompt, and
        // neither `onAuthenticationSucceeded` nor `onAuthenticationError`
        // ever fires, which leaves whoever's waiting on this hung forever.
        // That used to be reachable from `Unlock.tsx`'s own auto-prompt
        // effect (see its doc for the exact repro: lock from the IME while
        // this Activity is backgrounded, then reopen); that call site now
        // guards against it too, but this fails fast for every caller,
        // present and future, rather than relying on each one remembering
        // to check first.
        if (!fragmentActivity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            onFailure("not_foreground")
            return
        }

        activity.runOnUiThread {
            val callback = object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Never surface `errString` — it is user-facing text from
                    // the platform and has no business in our error channel.
                    val mapped = when (errorCode) {
                        BiometricPrompt.ERROR_NO_BIOMETRICS,
                        BiometricPrompt.ERROR_HW_NOT_PRESENT,
                        BiometricPrompt.ERROR_HW_UNAVAILABLE,
                        -> "unavailable"
                        else -> "denied"
                    }
                    onFailure(mapped)
                }

                // onAuthenticationFailed fires on a single bad read; the prompt
                // stays up and the user can retry, so it is not terminal.
            }

            val prompt = BiometricPrompt(
                fragmentActivity,
                ContextCompat.getMainExecutor(activity),
                callback,
            )

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Vault")
                .setSubtitle(reason)
                .setAllowedAuthenticators(authenticators())
                // Required once DEVICE_CREDENTIAL isn't among the allowed
                // authenticators — `PromptInfo.Builder.build()` throws
                // otherwise. Cancelling here lands in the same
                // `onAuthenticationError` branch as any other denial below,
                // which already drops the caller back to the master
                // password.
                .setNegativeButtonText("Cancel")
                .build()

            try {
                prompt.authenticate(info)
            } catch (_: Exception) {
                onFailure("unavailable")
            }
        }
    }

    // ----------------------------------------------------- window security

    // ------------------------------------------------------------ keyboard

    /**
     * Whether Vault's own keyboard (`VaultIme`, in the app's package) is
     * turned on in the system keyboard list. Matched by package rather than
     * by class name, so this never drifts from the IME's actual class.
     */
    @Command
    fun keyboardStatus(invoke: Invoke) {
        val imm = activity.getSystemService(InputMethodManager::class.java)
        val enabled = imm?.enabledInputMethodList?.any { it.packageName == activity.packageName } ?: false
        val result = JSObject()
        result.put("available", true)
        result.put("enabled", enabled)
        invoke.resolve(result)
    }

    /**
     * Android gives an app no way to turn a keyboard on itself — the person
     * has to flip it on in this system screen, which also shows the OS's own
     * warning about keyboards that can read what's typed.
     */
    @Command
    fun openKeyboardSettings(invoke: Invoke) {
        try {
            activity.startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("keyboard settings unavailable")
        }
    }

    /**
     * `FLAG_SECURE` keeps the unlocked vault out of the task-switcher preview
     * and blocks screenshots and screen recording while it is set.
     */
    @Command
    fun setScreenCaptureBlocked(invoke: Invoke) {
        val args = invoke.parseArgs(ScreenCaptureArgs::class.java)

        activity.runOnUiThread {
            if (args.blocked) {
                activity.window.setFlags(
                    WindowManager.LayoutParams.FLAG_SECURE,
                    WindowManager.LayoutParams.FLAG_SECURE,
                )
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            }
        }

        invoke.resolve(JSObject())
    }

    // ---------------------------------------------------------- clipboard

    /**
     * Runs on the main looper, independent of the WebView's JS engine — so it
     * still fires while the app is backgrounded, which is when
     * [clipboardScheduleClear] needs it and ordinary JS timers do not survive.
     */
    private val clipboardHandler = Handler(Looper.getMainLooper())

    /** The pending scheduled clear, if any, so a fresh copy can cancel it. */
    private var pendingClear: Runnable? = null

    private fun clearClipboardNow() {
        try {
            val manager =
                activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.clearPrimaryClip()
            } else {
                manager.setPrimaryClip(ClipData.newPlainText("", ""))
            }
        } catch (_: Exception) {
            // Nothing to surface to JS from here — this can run long after the
            // call that scheduled it returned. Worst case the clipboard is
            // left as it was, not corrupted.
        }
    }

    @Command
    fun clipboardWriteSensitive(invoke: Invoke) {
        val text = invoke.parseArgs(ClipboardWriteArgs::class.java).text

        try {
            val manager =
                activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("", text)

            // Marks the content as sensitive so the system excludes it from the
            // clipboard preview toast and from clipboard history.
            val extras = PersistableBundle()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
            // Android 12 honours the same key by name before it was public API.
            extras.putBoolean(EXTRA_IS_SENSITIVE, true)
            clip.description.extras = extras

            manager.setPrimaryClip(clip)
            invoke.resolve(JSObject())
        } catch (_: Exception) {
            invoke.reject("platform failure")
        }
    }

    @Command
    fun clipboardClearIfMatches(invoke: Invoke) {
        val expected = invoke.parseArgs(ClipboardClearArgs::class.java).expected

        try {
            val manager =
                activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val current = manager.primaryClip
                ?.takeIf { it.itemCount > 0 }
                ?.getItemAt(0)
                ?.coerceToText(activity)
                ?.toString()

            val result = JSObject()
            if (current != expected) {
                // The user copied something else — or, just as likely, the app
                // is not in the foreground and Android refuses clipboard reads
                // to backgrounded apps, which looks identical from here: an
                // empty or null read. Either way, leave it alone; this is only
                // ever a best-effort foreground check now that
                // clipboardScheduleClear is the actual guarantee.
                result.put("cleared", false)
                return invoke.resolve(result)
            }

            clearClipboardNow()
            result.put("cleared", true)
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("platform failure")
        }
    }

    /**
     * Unconditionally clears the clipboard after `delayMs`, cancelling
     * whatever was previously scheduled.
     *
     * Android refuses clipboard *reads* from a backgrounded app — as far as
     * `clipboardClearIfMatches` above can tell, the clipboard is always
     * empty — so a compare-then-clear approach silently does nothing for
     * exactly the case this exists to cover: copy a password, switch away to
     * paste it, and do not come back. This does not compare; it just clears,
     * on a plain `Handler` rather than a JS timer so backgrounding cannot
     * throttle or suspend it away. The trade-off — this can clear something
     * else copied in the same window — is accepted deliberately.
     */
    @Command
    fun clipboardScheduleClear(invoke: Invoke) {
        val delayMs = invoke.parseArgs(ClipboardScheduleClearArgs::class.java).delayMs

        pendingClear?.let { clipboardHandler.removeCallbacks(it) }
        val task = Runnable {
            clearClipboardNow()
            pendingClear = null
        }
        pendingClear = task
        clipboardHandler.postDelayed(task, delayMs)

        invoke.resolve(JSObject())
    }

    @Command
    fun clipboardCancelScheduledClear(invoke: Invoke) {
        pendingClear?.let { clipboardHandler.removeCallbacks(it) }
        pendingClear = null
        invoke.resolve(JSObject())
    }

    // ------------------------------------------------------------- export

    /**
     * Writes the vault bytes to a private cache file and hands them off
     * through the share sheet.
     *
     * There's no document-picker equivalent here: `ACTION_CREATE_DOCUMENT`
     * only offers document providers, where `ACTION_SEND` additionally
     * offers messaging apps, email, "Save to" targets and Nearby Share —
     * closer to what "get an independent copy out of this app" actually
     * needs for a small group of friends. The cost is that Android never
     * reports what the user did with it afterwards, so this only ever
     * resolves with `"shared"` — never a claim the file was saved anywhere.
     *
     * The cache file lives under `cacheDir/exports/`, readable only by this
     * app and, for the duration of the grant below, whichever single app the
     * user picks from the chooser. It is not cleaned up here; see
     * docs/SECURITY.md's "File safety" section.
     */
    @Command
    fun exportVault(invoke: Invoke) {
        val args = invoke.parseArgs(ExportVaultArgs::class.java)

        try {
            val bytes = android.util.Base64.decode(args.contentsB64, android.util.Base64.DEFAULT)

            val exportsDir = java.io.File(activity.cacheDir, "exports").apply { mkdirs() }
            val file = java.io.File(exportsDir, args.suggestedName)
            file.writeBytes(bytes)

            // Also deliberately still "com.passhandler.app" — see PREFS_FILE's
            // own comment above; this authority must match whatever
            // AndroidManifest.xml's <provider> declares, which is itself tied
            // to the unchanged applicationId.
            val uri = androidx.core.content.FileProvider.getUriForFile(
                activity,
                "com.passhandler.app.fileprovider",
                file,
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/octet-stream"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            activity.runOnUiThread {
                activity.startActivity(
                    Intent.createChooser(shareIntent, "Save a copy of your vault"),
                )
            }

            val result = JSObject()
            result.put("kind", "shared")
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("platform failure")
        }
    }

    // ------------------------------------------------------------- import

    /**
     * Opens Android's document picker and hands back whatever the user
     * chose. `ACTION_OPEN_DOCUMENT` (not `ACTION_GET_CONTENT`) so the
     * result carries a long-lived, revocable grant rather than a one-shot
     * read — not that this app needs to reopen it, but it is the correct
     * picker for "choose a specific file" regardless.
     *
     * `.kdbx` has no registered MIME type, so this asks for every type (a
     * wildcard `type`) rather than filtering by `mimeType` — the same
     * reasoning `exportVault`'s share intent uses `application/octet-stream`
     * for. `EXTRA_MIME_TYPES` is not set for the same reason.
     *
     * This is the first command in this plugin that has to wait on an
     * `ActivityResult` rather than resolving synchronously or through its
     * own SDK callback (compare `promptBiometric`'s `BiometricPrompt`
     * callback). `Plugin.startActivityForResult` is Tauri's own bridge for
     * this: it launches the intent and, once Android calls back with a
     * result, invokes the named `@ActivityCallback` method below with the
     * same `invoke` still attached, which is what lets `handleImportResult`
     * resolve or reject it after the fact instead of here.
     */
    @Command
    fun importVault(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        startActivityForResult(invoke, intent, "handleImportResult")
    }

    @ActivityCallback
    fun handleImportResult(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            val outcome = JSObject()
            outcome.put("kind", "cancelled")
            invoke.resolve(outcome)
            return
        }

        try {
            val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            if (bytes == null || bytes.isEmpty()) {
                invoke.reject("read failure")
                return
            }

            val outcome = JSObject()
            outcome.put("kind", "picked")
            // NO_WRAP, not DEFAULT: DEFAULT inserts a newline every 76 chars
            // on encode, which the Rust side's plain
            // `base64::engine::general_purpose::STANDARD.decode` cannot
            // parse — it does not unwrap line breaks. Every other command in
            // this plugin only ever *decodes* base64 that Rust produced
            // (see `exportVault`'s `Base64.decode` above); this is the first
            // one that encodes bytes in Kotlin for Rust to read, so this is
            // the first place that direction's mismatch would show up.
            outcome.put("dataB64", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            invoke.resolve(outcome)
        } catch (_: Exception) {
            invoke.reject("read failure")
        }
    }
}
