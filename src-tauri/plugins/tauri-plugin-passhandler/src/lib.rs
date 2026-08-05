//! Platform plumbing for Pass Handler.
//!
//! Four capabilities that have no portable implementation and therefore cannot
//! live in the shared TypeScript layers:
//!
//! * **OS secure storage** — Windows Credential Manager, Android Keystore.
//! * **Biometric gates** — Windows Hello, Android `BiometricPrompt`.
//! * **Screen-capture protection** — Android `FLAG_SECURE`.
//! * **Sensitive clipboard writes** — Android's "exclude from clipboard
//!   history and preview" flag.
//!
//! Everything else the app needs from the host — vault file I/O, OAuth, the
//! Drive API — is ordinary cross-platform Rust and lives in the main crate.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod error;
pub mod models;

pub use error::{Error, Result};
pub use models::{
    BiometricAuthenticateRequest, BiometricStatusResponse, ClipboardClearRequest,
    ClipboardClearResponse, ClipboardWriteRequest, ScreenCaptureRequest, SecretSlot,
    SecureStoreDeleteRequest, SecureStoreGetRequest, SecureStoreGetResponse,
    SecureStoreSetRequest,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::PassHandler;
#[cfg(mobile)]
use mobile::PassHandler;

/// Access to the plugin's APIs from Rust.
pub trait PassHandlerExt<R: Runtime> {
    fn passhandler(&self) -> &PassHandler<R>;
}

impl<R: Runtime, T: Manager<R>> PassHandlerExt<R> for T {
    fn passhandler(&self) -> &PassHandler<R> {
        self.state::<PassHandler<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("passhandler")
        .invoke_handler(tauri::generate_handler![
            commands::secure_store_set,
            commands::secure_store_get,
            commands::secure_store_delete,
            commands::biometric_status,
            commands::biometric_authenticate,
            commands::set_screen_capture_blocked,
            commands::clipboard_write_sensitive,
            commands::clipboard_clear_if_matches,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let handle = mobile::init(app, api)?;
            #[cfg(desktop)]
            let handle = desktop::init(app, api)?;
            app.manage(handle);
            Ok(())
        })
        .build()
}
