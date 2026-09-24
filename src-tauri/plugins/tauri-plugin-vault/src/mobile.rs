use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.vault.plugin";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Vault<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "VaultPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = {
        // iOS is explicitly out of scope for this app. The arm exists so the
        // `mobile` cfg compiles as a whole; it is never built.
        compile_error!("iOS is not a supported platform for Vault");
    };

    Ok(Vault(handle))
}

/// Every call here is a thin forward into the Kotlin plugin, which is where the
/// Keystore, `BiometricPrompt`, `FLAG_SECURE` and clipboard work actually
/// happens. See `android/src/main/java/VaultPlugin.kt`.
pub struct Vault<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Vault<R> {
    /// Commands whose only interesting outcome is success or failure.
    ///
    /// The return value is discarded through `serde_json::Value` rather than
    /// deserialised into `()`, because `()` only accepts a JSON `null` and the
    /// Kotlin side resolves with an object.
    fn run_unit<T: serde::Serialize>(&self, command: &str, payload: T) -> Result<()> {
        self.0
            .run_mobile_plugin::<serde_json::Value>(command, payload)
            .map(|_| ())
            .map_err(Into::into)
    }

    pub fn secure_store_set(&self, payload: SecureStoreSetRequest) -> Result<()> {
        self.run_unit("secureStoreSet", payload)
    }

    pub fn secure_store_get(
        &self,
        payload: SecureStoreGetRequest,
    ) -> Result<SecureStoreGetResponse> {
        self.0
            .run_mobile_plugin("secureStoreGet", payload)
            .map_err(Into::into)
    }

    pub fn secure_store_delete(&self, payload: SecureStoreDeleteRequest) -> Result<()> {
        self.run_unit("secureStoreDelete", payload)
    }

    pub fn biometric_status(&self) -> Result<BiometricStatusResponse> {
        self.0
            .run_mobile_plugin("biometricStatus", serde_json::json!({}))
            .map_err(Into::into)
    }

    pub fn biometric_authenticate(&self, payload: BiometricAuthenticateRequest) -> Result<()> {
        self.run_unit("biometricAuthenticate", payload)
    }

    pub fn set_screen_capture_blocked(&self, payload: ScreenCaptureRequest) -> Result<()> {
        self.run_unit("setScreenCaptureBlocked", payload)
    }

    pub fn clipboard_write_sensitive(&self, payload: ClipboardWriteRequest) -> Result<()> {
        self.run_unit("clipboardWriteSensitive", payload)
    }

    pub fn clipboard_clear_if_matches(
        &self,
        payload: ClipboardClearRequest,
    ) -> Result<ClipboardClearResponse> {
        self.0
            .run_mobile_plugin("clipboardClearIfMatches", payload)
            .map_err(Into::into)
    }

    /// Schedules an unconditional clear, natively, independent of the
    /// WebView's JS engine.
    ///
    /// Android blocks a backgrounded app from *reading* the clipboard at all
    /// — `getPrimaryClip()` behaves as if it were empty — so
    /// `clipboard_clear_if_matches`'s compare-then-clear silently does
    /// nothing for exactly the case that matters most: copying a password,
    /// switching away to paste it, and not coming back. Worse, the JS
    /// `setInterval` driving that check is itself throttled or suspended once
    /// the page is hidden, so even a clear that *would* succeed might never
    /// get triggered. Kotlin's `Handler.postDelayed` on the main looper is
    /// not subject to either restriction, so the actual clearing now happens
    /// there, unconditionally — accepting the small risk of clearing
    /// something else copied in the same window, which is the trade-off
    /// every mainstream password manager on Android makes for the same
    /// reason.
    pub fn clipboard_schedule_clear(&self, payload: ClipboardScheduleClearRequest) -> Result<()> {
        self.run_unit("clipboardScheduleClear", payload)
    }

    /// Cancels a pending scheduled clear — e.g. a fresh copy replacing an
    /// earlier one, so the old timer does not later wipe the new value.
    pub fn clipboard_cancel_scheduled_clear(&self) -> Result<()> {
        self.run_unit("clipboardCancelScheduledClear", serde_json::json!({}))
    }

    /// Opens the share sheet with the vault bytes. See `desktop.rs`'s
    /// `export_vault` for the Windows half — the two platforms return
    /// genuinely different `ExportOutcome`s because Android never reports
    /// what happens after the picker is shown.
    pub fn export_vault(&self, payload: ExportVaultRequest) -> Result<ExportOutcome> {
        self.0
            .run_mobile_plugin("exportVault", payload)
            .map_err(Into::into)
    }

    /// Opens Android's document picker (`ACTION_OPEN_DOCUMENT`) and reads
    /// back whatever the user chose. See
    /// `android/src/main/java/VaultPlugin.kt`'s `importVault` — the
    /// first command in this plugin that has to wait on an
    /// `ActivityResult` rather than resolving synchronously.
    pub fn import_vault(&self) -> Result<ImportOutcome> {
        self.0
            .run_mobile_plugin("importVault", serde_json::json!({}))
            .map_err(Into::into)
    }

    /// Manual-fill is Windows-only for now — see `docs/MANUAL-FILL-DESIGN.md`.
    /// There is no Kotlin side to forward to, and nothing on Android ever
    /// calls this: the hotkey that would trigger it is never registered
    /// here. Present anyway, like `desktop.rs`'s non-Windows stub, so
    /// `commands.rs` can call `type_text` uniformly across platforms.
    pub fn type_text(&self, _payload: TypeTextRequest) -> Result<()> {
        Err(crate::Error::Unavailable)
    }

    /// Same reasoning as `type_text` just above — Android's "fill, then
    /// Tab, then maybe the password" behaviour is implemented entirely in
    /// `VaultKeyboardView.kt`/`VaultIme.kt`, which sends its own
    /// Tab key event straight through `currentInputConnection` and never
    /// calls this plugin at all. Present only so `commands::press_tab` can
    /// call `press_tab` uniformly across platforms.
    pub fn press_tab(&self) -> Result<()> {
        Err(crate::Error::Unavailable)
    }

    /// Same reasoning as `type_text`/`press_tab` above — the real-detection
    /// UI Automation path this mirrors (`desktop.rs`) is Windows-only.
    /// Android already gets a *real* answer to "is this a password field"
    /// for its own fill flow, but through `VaultKeyboardView.kt`'s own
    /// `EditorInfo` inspection inside the IME itself, not through this
    /// plugin — nothing on Android ever calls this command (see
    /// `VaultScreen.tsx`'s `tabThenMaybeFillPassword`, which only calls it
    /// on non-Android platforms). Present only so `commands.rs`'s
    /// `focused_field_is_password` can forward uniformly across platforms
    /// without a platform `cfg` of its own — same as its two siblings just
    /// above, and the reason this plugin failed to build for Android at all
    /// before this method existed: `Vault<R>` (this struct) had no such
    /// method, only `desktop.rs`'s copy did.
    pub fn focused_field_is_password(&self) -> Result<FocusedFieldPasswordResponse> {
        Err(crate::Error::Unavailable)
    }
}
