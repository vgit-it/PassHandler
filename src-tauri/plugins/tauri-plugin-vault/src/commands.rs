use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result, VaultExt};

/// Runs a plugin call on Tokio's dedicated blocking-task pool, never on an
/// async worker thread.
///
/// Every function `Vault` exposes is a plain synchronous call into an
/// OS API — Windows Credential Manager, Windows Hello's `UserConsentVerifier`
/// (which blocks the calling thread on a WinRT `.get()`), the Android
/// Keystore. None of that is bounded by anything this crate controls: a
/// consent prompt waits on the person in front of the screen, and Windows
/// Hello's own availability check has been observed to stall for tens of
/// seconds when the OS's biometric service is busy or still warming up (see
/// its `DeviceBusy` case, handled explicitly in `desktop.rs`).
///
/// Every one of these commands used to run its blocking call directly inside
/// its `async fn` body. On the same worker-thread pool Tauri's own IPC and
/// resource-request dispatch relies on, one long-blocked call was enough to
/// starve everything else waiting on that pool — including the request
/// serving the app's own UI — which is what produced a "can't reach this
/// page" / blank-window launch with no vault ever touched and nothing
/// written to disk: `biometric_status` alone runs unconditionally on every
/// single startup, whether or not the person ever unlocks anything. This is
/// the same class of bug `favicon.rs`'s cache I/O had — see its module docs.
async fn blocking<F, T>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .unwrap_or(Err(Error::Platform))
}

#[command]
pub(crate) async fn secure_store_set<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreSetRequest,
) -> Result<()> {
    blocking(move || app.vault().secure_store_set(payload)).await
}

#[command]
pub(crate) async fn secure_store_get<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreGetRequest,
) -> Result<SecureStoreGetResponse> {
    blocking(move || app.vault().secure_store_get(payload)).await
}

#[command]
pub(crate) async fn secure_store_delete<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreDeleteRequest,
) -> Result<()> {
    blocking(move || app.vault().secure_store_delete(payload)).await
}

#[command]
pub(crate) async fn biometric_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BiometricStatusResponse> {
    blocking(move || app.vault().biometric_status()).await
}

#[command]
pub(crate) async fn biometric_authenticate<R: Runtime>(
    app: AppHandle<R>,
    payload: BiometricAuthenticateRequest,
) -> Result<()> {
    blocking(move || app.vault().biometric_authenticate(payload)).await
}

#[command]
pub(crate) async fn set_screen_capture_blocked<R: Runtime>(
    app: AppHandle<R>,
    payload: ScreenCaptureRequest,
) -> Result<()> {
    blocking(move || app.vault().set_screen_capture_blocked(payload)).await
}

#[command]
pub(crate) async fn clipboard_write_sensitive<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardWriteRequest,
) -> Result<()> {
    blocking(move || app.vault().clipboard_write_sensitive(payload)).await
}

#[command]
pub(crate) async fn clipboard_clear_if_matches<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardClearRequest,
) -> Result<ClipboardClearResponse> {
    blocking(move || app.vault().clipboard_clear_if_matches(payload)).await
}

#[command]
pub(crate) async fn clipboard_schedule_clear<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardScheduleClearRequest,
) -> Result<()> {
    blocking(move || app.vault().clipboard_schedule_clear(payload)).await
}

#[command]
pub(crate) async fn clipboard_cancel_scheduled_clear<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(move || app.vault().clipboard_cancel_scheduled_clear()).await
}

#[command]
pub(crate) async fn export_vault<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportVaultRequest,
) -> Result<ExportOutcome> {
    blocking(move || app.vault().export_vault(payload)).await
}

#[command]
pub(crate) async fn import_vault<R: Runtime>(app: AppHandle<R>) -> Result<ImportOutcome> {
    blocking(move || app.vault().import_vault()).await
}

#[command]
pub(crate) async fn type_text<R: Runtime>(
    app: AppHandle<R>,
    payload: TypeTextRequest,
) -> Result<()> {
    blocking(move || app.vault().type_text(payload)).await
}

#[command]
pub(crate) async fn press_tab<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(move || app.vault().press_tab()).await
}

#[command]
pub(crate) async fn focused_field_is_password<R: Runtime>(
    app: AppHandle<R>,
) -> Result<FocusedFieldPasswordResponse> {
    blocking(move || app.vault().focused_field_is_password()).await
}

#[command]
pub(crate) async fn keyboard_status<R: Runtime>(app: AppHandle<R>) -> Result<KeyboardStatusResponse> {
    blocking(move || app.vault().keyboard_status()).await
}

#[command]
pub(crate) async fn open_keyboard_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    blocking(move || app.vault().open_keyboard_settings()).await
}
