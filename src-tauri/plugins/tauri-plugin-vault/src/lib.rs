//! Platform plumbing for Vault.
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
    ClipboardClearResponse, ClipboardScheduleClearRequest, ClipboardWriteRequest, ExportOutcome,
    ExportVaultRequest, FocusedFieldPasswordResponse, ImportOutcome, KeyboardStatusResponse,
    ScreenCaptureRequest,
    SecretSlot, SecureStoreDeleteRequest, SecureStoreGetRequest, SecureStoreGetResponse,
    SecureStoreSetRequest, TypeTextRequest,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
use desktop::Vault;
#[cfg(mobile)]
use mobile::Vault;

/// Access to the plugin's APIs from Rust.
pub trait VaultExt<R: Runtime> {
    fn vault(&self) -> &Vault<R>;
}

impl<R: Runtime, T: Manager<R>> VaultExt<R> for T {
    fn vault(&self) -> &Vault<R> {
        self.state::<Vault<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("vault")
        .invoke_handler(tauri::generate_handler![
            commands::secure_store_set,
            commands::secure_store_get,
            commands::secure_store_delete,
            commands::biometric_status,
            commands::biometric_authenticate,
            commands::set_screen_capture_blocked,
            commands::clipboard_write_sensitive,
            commands::clipboard_clear_if_matches,
            commands::clipboard_schedule_clear,
            commands::clipboard_cancel_scheduled_clear,
            commands::export_vault,
            commands::import_vault,
            commands::type_text,
            commands::press_tab,
            commands::focused_field_is_password,
            commands::keyboard_status,
            commands::open_keyboard_settings,
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
