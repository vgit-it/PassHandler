//! Non-secret application state, persisted as JSON in the app data directory.
//!
//! Two files, deliberately kept out of the webview's storage so that the rule
//! "no vault-derived data in `localStorage`/`sessionStorage`/IndexedDB" has no
//! exceptions to reason about:
//!
//! * `settings.json` — auto-lock timeout, clipboard duration, biometric toggle.
//! * `sync-state.json` — Drive file id, last known revision, dirty flag, last
//!   sync time, and the `kdbxweb` edit state.
//!
//! The edit state is a map of entry UUIDs to modification timestamps. It has to
//! survive a restart or merge silently loses deletions, and it contains no
//! field values — no titles, no usernames, no passwords.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{Error, Result};
use crate::fill::HotkeyCombo;

const SETTINGS_FILE: &str = "settings.json";
const SYNC_STATE_FILE: &str = "sync-state.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Minutes of idleness before the vault locks. `None` means never.
    pub auto_lock_minutes: Option<u32>,
    /// Seconds before a copied password is cleared from the clipboard.
    pub clipboard_clear_seconds: u32,
    pub biometric_unlock_enabled: bool,
    pub onboarding_complete: bool,
    /// Whether entry rows fetch and show the site's favicon.
    ///
    /// Defaulted explicitly (rather than relying on `#[serde(default)]`'s
    /// `bool::default()` of `false`) so existing installs — whose
    /// `settings.json` predates this field and so has no key for it at all —
    /// come back on upgrade with icons on, matching what a fresh install
    /// gets. `read_json` already falls back to `T::default()` on any parse
    /// failure, so this also has to stay a value `serde` can fill in when the
    /// key is simply absent, not just when the whole file is unreadable.
    #[serde(default = "default_true")]
    pub show_site_icons: bool,
    /// Windows only; ignored on Android. Defaulted the same way
    /// `show_site_icons` is above — an existing `settings.json` predating
    /// this field has no key for it at all, and should come back on upgrade
    /// with the same combo this feature originally shipped hardcoded as,
    /// not an empty/invalid one.
    #[serde(default = "HotkeyCombo::default_combo")]
    pub manual_fill_hotkey: HotkeyCombo,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_lock_minutes: Some(5),
            clipboard_clear_seconds: 20,
            biometric_unlock_enabled: false,
            onboarding_complete: false,
            show_site_icons: true,
            manual_fill_hotkey: HotkeyCombo::default_combo(),
        }
    }
}

/// Everything sync needs to know across restarts.
///
/// `last_known_revision` is the change-detection mechanism: Drive offers no
/// server-side precondition on upload, so this local record of "the revision we
/// last agreed with" is what lets us notice that another device wrote.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub drive_file_id: Option<String>,
    pub last_known_revision: Option<String>,
    /// Set on every local mutation, cleared only after a verified upload.
    pub dirty: bool,
    pub last_sync_at: Option<i64>,
    /// `kdbxweb` local edit state, stored verbatim as it was serialised.
    pub edit_state: Option<serde_json::Value>,
    /// Vault UUID, used to build the Drive filename `vault-<uuid>.kdbx`.
    pub vault_id: Option<String>,
}

fn path_for<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|_| Error::Io)?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join(name))
}

fn read_json<R: Runtime, T: Default + for<'de> Deserialize<'de>>(
    app: &AppHandle<R>,
    name: &str,
) -> Result<T> {
    let path = path_for(app, name)?;
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(e.into()),
    }
}

fn write_json<R: Runtime, T: Serialize>(app: &AppHandle<R>, name: &str, value: &T) -> Result<()> {
    let path = path_for(app, name)?;
    let raw = serde_json::to_string_pretty(value)?;

    // Same atomic-replace discipline as the vault, including the fsync before
    // rename that vault_file.rs has and this used to skip. Without it, a write
    // this small survives an ordinary process kill (the dirty page sits in the
    // OS cache and a later read still sees it) but is not guaranteed to survive
    // one that comes with the device under enough memory pressure to matter —
    // which is exactly when Android is most likely to kill this app. Losing
    // `onboarding_complete` mid-write is what sends a fully set-up install back
    // to onboarding; losing `last_known_revision` would force an unnecessary
    // merge. Neither should depend on how lucky the timing was.
    let temp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(raw.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&temp, &path)?;

    if let Some(dir) = path.parent() {
        if let Ok(dir_handle) = fs::File::open(dir) {
            let _ = dir_handle.sync_all();
        }
    }

    Ok(())
}

/// Synchronous read of the same file `settings_load` exposes over IPC — for
/// `fill.rs`, which needs the persisted hotkey combo at startup (before any
/// renderer exists to ask) and again inside `set_manual_fill_hotkey`, itself
/// already an IPC command with nothing to gain from a second async hop into
/// the same tiny, already-fast file read.
pub(crate) fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Settings> {
    read_json(app, SETTINGS_FILE)
}

/// Counterpart to `load`, for the same reason.
pub(crate) fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<()> {
    write_json(app, SETTINGS_FILE, settings)
}

#[tauri::command]
pub async fn settings_load<R: Runtime>(app: AppHandle<R>) -> Result<Settings> {
    read_json(&app, SETTINGS_FILE)
}

#[tauri::command]
pub async fn settings_save<R: Runtime>(app: AppHandle<R>, settings: Settings) -> Result<()> {
    write_json(&app, SETTINGS_FILE, &settings)
}

#[tauri::command]
pub async fn sync_state_load<R: Runtime>(app: AppHandle<R>) -> Result<SyncState> {
    read_json(&app, SYNC_STATE_FILE)
}

#[tauri::command]
pub async fn sync_state_save<R: Runtime>(app: AppHandle<R>, state: SyncState) -> Result<()> {
    write_json(&app, SYNC_STATE_FILE, &state)
}
