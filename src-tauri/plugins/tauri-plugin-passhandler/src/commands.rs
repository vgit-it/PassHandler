use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::{PassHandlerExt, Result};

#[command]
pub(crate) async fn secure_store_set<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreSetRequest,
) -> Result<()> {
    app.passhandler().secure_store_set(payload)
}

#[command]
pub(crate) async fn secure_store_get<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreGetRequest,
) -> Result<SecureStoreGetResponse> {
    app.passhandler().secure_store_get(payload)
}

#[command]
pub(crate) async fn secure_store_delete<R: Runtime>(
    app: AppHandle<R>,
    payload: SecureStoreDeleteRequest,
) -> Result<()> {
    app.passhandler().secure_store_delete(payload)
}

#[command]
pub(crate) async fn biometric_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<BiometricStatusResponse> {
    app.passhandler().biometric_status()
}

#[command]
pub(crate) async fn biometric_authenticate<R: Runtime>(
    app: AppHandle<R>,
    payload: BiometricAuthenticateRequest,
) -> Result<()> {
    app.passhandler().biometric_authenticate(payload)
}

#[command]
pub(crate) async fn set_screen_capture_blocked<R: Runtime>(
    app: AppHandle<R>,
    payload: ScreenCaptureRequest,
) -> Result<()> {
    app.passhandler().set_screen_capture_blocked(payload)
}

#[command]
pub(crate) async fn clipboard_write_sensitive<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardWriteRequest,
) -> Result<()> {
    app.passhandler().clipboard_write_sensitive(payload)
}

#[command]
pub(crate) async fn clipboard_clear_if_matches<R: Runtime>(
    app: AppHandle<R>,
    payload: ClipboardClearRequest,
) -> Result<ClipboardClearResponse> {
    app.passhandler().clipboard_clear_if_matches(payload)
}
