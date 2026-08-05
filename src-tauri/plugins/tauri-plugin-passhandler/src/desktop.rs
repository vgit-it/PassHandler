use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<PassHandler<R>> {
    Ok(PassHandler(app.clone()))
}

pub struct PassHandler<R: Runtime>(AppHandle<R>);

impl<R: Runtime> PassHandler<R> {
    // ---------------------------------------------------------------- secrets

    pub fn secure_store_set(&self, payload: SecureStoreSetRequest) -> Result<()> {
        if payload.value.is_empty() {
            return Err(Error::InvalidArgument);
        }
        keyring_entry(payload.slot)?
            .set_password(&payload.value)
            .map_err(|_| Error::Storage)
    }

    pub fn secure_store_get(
        &self,
        payload: SecureStoreGetRequest,
    ) -> Result<SecureStoreGetResponse> {
        // Windows Credential Manager has no per-entry biometric gate: an entry
        // is readable by any process running as the logged-in user. So user
        // presence is enforced here, before the read, by asking Windows Hello.
        // See docs/SECURITY.md — this is weaker than the Android Keystore's
        // hardware-bound guarantee and is documented as such rather than
        // papered over.
        if payload.slot.requires_user_presence() {
            let reason = payload
                .reason
                .unwrap_or_else(|| "Unlock your vault".to_string());
            self.verify_user_presence(&reason)?;
        }

        match keyring_entry(payload.slot)?.get_password() {
            Ok(value) => Ok(SecureStoreGetResponse { value: Some(value) }),
            Err(keyring::Error::NoEntry) => Ok(SecureStoreGetResponse { value: None }),
            Err(_) => Err(Error::Storage),
        }
    }

    pub fn secure_store_delete(&self, payload: SecureStoreDeleteRequest) -> Result<()> {
        match keyring_entry(payload.slot)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(Error::Storage),
        }
    }

    // -------------------------------------------------------------- biometric

    pub fn biometric_status(&self) -> Result<BiometricStatusResponse> {
        #[cfg(target_os = "windows")]
        {
            Ok(windows_hello::status())
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(BiometricStatusResponse {
                available: false,
                reason: Some("unsupported-platform".to_string()),
            })
        }
    }

    pub fn biometric_authenticate(&self, payload: BiometricAuthenticateRequest) -> Result<()> {
        self.verify_user_presence(&payload.reason)
    }

    #[cfg(target_os = "windows")]
    fn verify_user_presence(&self, reason: &str) -> Result<()> {
        use tauri::Manager;

        // Windows Hello on a Win32 app must be anchored to a window, otherwise
        // the prompt has no owner and can appear behind the app.
        //
        // The handle is carried as a raw pointer rather than as a typed `HWND`:
        // Tauri links its own version of the `windows` crate, and its `HWND` is
        // a different type from ours even though both are one pointer wide.
        let hwnd = self
            .0
            .webview_windows()
            .values()
            .next()
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as *mut core::ffi::c_void);

        windows_hello::request_verification(hwnd, reason)
    }

    #[cfg(not(target_os = "windows"))]
    fn verify_user_presence(&self, _reason: &str) -> Result<()> {
        // Linux is a type-checking target only, not a supported platform. Fail
        // closed: no verifier means no verification, never a silent pass.
        Err(Error::Unavailable)
    }

    // ------------------------------------------------------- window security

    pub fn set_screen_capture_blocked(&self, _payload: ScreenCaptureRequest) -> Result<()> {
        // Android-only. Windows has `SetWindowDisplayAffinity`, but the PRD
        // scopes screen-capture protection to Android and nothing in the
        // Windows UI depends on it, so this is a no-op rather than a
        // half-tested extra.
        Ok(())
    }

    // ------------------------------------------------------------- clipboard

    pub fn clipboard_write_sensitive(&self, payload: ClipboardWriteRequest) -> Result<()> {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        // Windows has no equivalent of Android's sensitive-content flag. The
        // protection here is the auto-clear timer in the UI layer.
        self.0
            .clipboard()
            .write_text(payload.text)
            .map_err(|_| Error::Platform)
    }

    pub fn clipboard_clear_if_matches(
        &self,
        payload: ClipboardClearRequest,
    ) -> Result<ClipboardClearResponse> {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        let current = self.0.clipboard().read_text().unwrap_or_default();
        if current != payload.expected {
            // Something else was copied in the meantime. That content belongs
            // to the user and must not be destroyed.
            return Ok(ClipboardClearResponse { cleared: false });
        }

        self.0
            .clipboard()
            .write_text(String::new())
            .map_err(|_| Error::Platform)?;
        Ok(ClipboardClearResponse { cleared: true })
    }
}

fn keyring_entry(slot: SecretSlot) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE_NAME, slot.account()).map_err(|_| Error::Storage)
}

#[cfg(target_os = "windows")]
mod windows_hello {
    use windows::core::HSTRING;
    use windows::Foundation::IAsyncOperation;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::IUserConsentVerifierInterop;

    use crate::models::BiometricStatusResponse;
    use crate::{Error, Result};

    pub fn status() -> BiometricStatusResponse {
        let availability = UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|op| op.get())
            .unwrap_or(UserConsentVerifierAvailability::DeviceNotPresent);

        let reason = match availability {
            UserConsentVerifierAvailability::Available => None,
            UserConsentVerifierAvailability::DeviceNotPresent => Some("no-sensor"),
            UserConsentVerifierAvailability::NotConfiguredForUser => Some("not-enrolled"),
            UserConsentVerifierAvailability::DisabledByPolicy => Some("disabled-by-policy"),
            UserConsentVerifierAvailability::DeviceBusy => Some("device-busy"),
            _ => Some("unavailable"),
        };

        BiometricStatusResponse {
            available: reason.is_none(),
            reason: reason.map(str::to_string),
        }
    }

    pub fn request_verification(hwnd: Option<*mut core::ffi::c_void>, reason: &str) -> Result<()> {
        let message = HSTRING::from(reason);

        // The plain WinRT `UserConsentVerifier::RequestVerificationAsync` only
        // works for packaged UWP apps. A Win32 process has to go through the
        // interop interface and pass its own window handle.
        let result = match hwnd {
            Some(raw) => {
                let interop =
                    windows::core::factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                        .map_err(|_| Error::Unavailable)?;

                let operation: IAsyncOperation<UserConsentVerificationResult> = unsafe {
                    interop
                        .RequestVerificationForWindowAsync(HWND(raw), &message)
                        .map_err(|_| Error::Platform)?
                };

                operation.get().map_err(|_| Error::Platform)?
            }
            None => UserConsentVerifier::RequestVerificationAsync(&message)
                .map_err(|_| Error::Unavailable)?
                .get()
                .map_err(|_| Error::Platform)?,
        };

        match result {
            UserConsentVerificationResult::Verified => Ok(()),
            UserConsentVerificationResult::DeviceNotPresent
            | UserConsentVerificationResult::NotConfiguredForUser
            | UserConsentVerificationResult::DisabledByPolicy => Err(Error::Unavailable),
            // Canceled, RetriesExhausted, DeviceBusy — all mean "no consent".
            _ => Err(Error::Denied),
        }
    }
}
