//! Pass Handler — native layer.
//!
//! Everything here is plumbing. No vault is parsed, no entry is read and no
//! password is decrypted on this side of the IPC boundary: the Rust layer moves
//! opaque ciphertext between disk, Google Drive and the renderer, and provides
//! the four platform capabilities that have no portable implementation.
//!
//! Keeping the vault logic in TypeScript is not an accident of convenience.
//! `kdbxweb` needs WebCrypto, WebCrypto exists in the system webview on both
//! Windows and Android, and one implementation of the format is one
//! implementation to get right.

use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

mod drive;
mod error;
mod oauth;
mod prefs;
mod vault_file;

pub use error::{Error, Result};

/// Events the renderer listens for. The vault is locked by the UI layer, which
/// owns the decrypted state; Rust only reports that a locking condition has
/// occurred.
pub const EVENT_LOCK_REQUESTED: &str = "vault://lock-requested";

struct Http(reqwest::Client);

fn http_client<R: Runtime>(app: &AppHandle<R>) -> Result<reqwest::Client> {
    Ok(app.state::<Http>().0.clone())
}

fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        // Sync must never be able to wedge the app. Every request is bounded,
        // and a hung network surfaces as "Offline" rather than a spinner.
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(60))
        .user_agent(concat!("PassHandler/", env!("CARGO_PKG_VERSION")))
        // No redirect following: every endpoint used here is a documented,
        // stable Google URL, and a redirect would be a reason to stop rather
        // than to follow.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_passhandler::init());

    // A second instance would race the first over the same vault file and the
    // same rolling backup. Focus the window that is already open instead.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.webview_windows().values().next() {
            let _ = window.set_focus();
        }
    }));

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    builder
        .manage(Http(build_http_client()))
        .manage(vault_file::BackupState::default())
        .manage(oauth::OauthState::default())
        .invoke_handler(tauri::generate_handler![
            vault_file::vault_exists,
            vault_file::vault_read,
            vault_file::vault_write,
            vault_file::vault_restore_backup,
            vault_file::vault_backup_exists,
            vault_file::vault_delete_local,
            prefs::settings_load,
            prefs::settings_save,
            prefs::sync_state_load,
            prefs::sync_state_save,
            oauth::drive_configure,
            oauth::drive_status,
            oauth::drive_connect,
            oauth::drive_complete_auth,
            oauth::drive_disconnect,
            drive::drive_find_file,
            drive::drive_get_metadata,
            drive::drive_download,
            drive::drive_create,
            drive::drive_update,
        ])
        .setup(|app| {
            // Devtools are a debug-build affordance only. A released binary
            // ships without an inspector so a shoulder-surfer with a keyboard
            // cannot open one over an unlocked vault.
            #[cfg(all(desktop, debug_assertions))]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            #[cfg(desktop)]
            install_desktop_lock_triggers(app.handle());

            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pass Handler");
}

/// Lock the vault when the window closes.
///
/// The PRD also calls for locking on system sleep. Tauri exposes no portable
/// sleep event, and the idle timer in the UI covers the case in practice: a
/// machine that wakes after more than the auto-lock interval finds the vault
/// already locked, because the timer is compared against wall-clock time rather
/// than counted in ticks.
#[cfg(desktop)]
fn install_desktop_lock_triggers<R: Runtime>(app: &AppHandle<R>) {
    use tauri::{Emitter, WindowEvent};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            let _ = handle.emit(EVENT_LOCK_REQUESTED, ());
        }
    });
}
