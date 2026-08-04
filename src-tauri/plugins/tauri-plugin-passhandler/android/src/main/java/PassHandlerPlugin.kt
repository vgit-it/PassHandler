package com.passhandler.plugin

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
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

/**
 * Android half of the Pass Handler native plugin.
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
class PassHandlerPlugin(private val activity: Activity) : Plugin(activity) {

    private companion object {
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
     * Device credential is accepted as a fallback so that a phone with no
     * enrolled fingerprint still has a working unlock path. Both are gated by
     * the lock screen, which is the property that matters here.
     */
    private fun authenticators(): Int =
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL

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
                .setTitle("Pass Handler")
                .setSubtitle(reason)
                .setAllowedAuthenticators(authenticators())
                .build()

            try {
                prompt.authenticate(info)
            } catch (_: Exception) {
                onFailure("unavailable")
            }
        }
    }

    // ----------------------------------------------------- window security

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
                // The user copied something else. Leave it alone.
                result.put("cleared", false)
                return invoke.resolve(result)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.clearPrimaryClip()
            } else {
                manager.setPrimaryClip(ClipData.newPlainText("", ""))
            }
            result.put("cleared", true)
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("platform failure")
        }
    }
}
