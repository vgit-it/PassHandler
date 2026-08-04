use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;
use crate::Result;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.passhandler.plugin";

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<PassHandler<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "PassHandlerPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = {
        // iOS is explicitly out of scope for this app. The arm exists so the
        // `mobile` cfg compiles as a whole; it is never built.
        compile_error!("iOS is not a supported platform for Pass Handler");
    };

    Ok(PassHandler(handle))
}

/// Every call here is a thin forward into the Kotlin plugin, which is where the
/// Keystore, `BiometricPrompt`, `FLAG_SECURE` and clipboard work actually
/// happens. See `android/src/main/java/PassHandlerPlugin.kt`.
pub struct PassHandler<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> PassHandler<R> {
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
}
