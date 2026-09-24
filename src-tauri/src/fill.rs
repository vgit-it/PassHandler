//! Manual fill — the hotkey half. Windows only in what it actually does, but
//! this module compiles on every target (the same "fail closed on other
//! platforms" discipline `tauri-plugin-vault`'s `desktop.rs` already uses)
//! so Settings has one pair of commands to call regardless of platform,
//! rather than needing its own platform branch just to know they exist.
//!
//! A global hotkey shows/focuses the main window and, unconditionally, tells
//! the renderer a fill was requested. There is no bridge and no second
//! window: the hotkey handler and an already-unlocked vault live in the same
//! process, so the handler just reuses the window and UI that are already
//! there. See `docs/MANUAL-FILL-DESIGN.md`.
//!
//! Rust never learns whether the vault is unlocked — that state lives only in
//! the renderer, by design (see this crate's module docs, and
//! `tauri-plugin-vault`'s). The event below fires unconditionally, and
//! that is fine: `VaultScreen` only mounts, and only listens for it, while
//! the vault is unlocked. A hotkey press while locked just shows the lock
//! screen, and the event goes nowhere.
//!
//! ## The hotkey is now user-configurable
//!
//! Originally hardcoded to Ctrl+Alt+H with no Settings UI at all — a real
//! gap next to Android, where the roughly equivalent choice (which keyboard
//! is active) is at least visible and changeable in the OS's own keyboard
//! settings. This doesn't cross the "Rust never learns vault state" line
//! above — a key combination isn't vault state, only which keys wake the
//! renderer up.
//!
//! ## Verification
//!
//! The `Shortcut::new`/`on_shortcut`/`unregister` calls and `Modifiers`'
//! bitflag-style `|`/`empty`/`is_empty` were checked against
//! `tauri-plugin-global-shortcut`'s own docs, matching this file's original
//! (already-shipped) hotkey code as closely as possible for the new pieces
//! this pass adds — re-registration, and comparing two `Shortcut`s for
//! equality (which assumes `Shortcut: PartialEq + Clone`, not directly
//! confirmed against a compiler in this sandbox, same as everywhere else
//! Windows-only code in this project gets built). No Windows toolchain is
//! available here to `cargo check` the `cfg(windows)` half of this file —
//! build and try it on the real machine, same discipline
//! `docs/MANUAL-FILL-DESIGN.md` already documents for the rest of this
//! feature.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::Result;

#[cfg(not(target_os = "windows"))]
use crate::Error;
#[cfg(target_os = "windows")]
use crate::prefs;
#[cfg(target_os = "windows")]
use std::str::FromStr;
#[cfg(target_os = "windows")]
use tauri::Emitter;
#[cfg(target_os = "windows")]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
#[cfg(target_os = "windows")]
use tauri_plugin_vault::VaultExt;

/// Fired right after the hotkey shows/focuses the main window.
/// `VaultScreen` listens for this and switches into pick mode.
pub const EVENT_ENTER_PICK_MODE: &str = "fill://enter-pick-mode";

/// A key combination, described the way the browser's own `KeyboardEvent`
/// already describes it. `code` is a W3C UI Events code string (`"KeyH"`,
/// `"Digit1"`, `"F5"`, …) — exactly what `event.code` gives the renderer —
/// deliberately chosen over a pre-formatted accelerator string ("Ctrl+Alt+H")
/// so there is no separate string grammar to get right on either side of the
/// IPC boundary: it is passed through as-is and parsed on this side with
/// `tauri_plugin_global_shortcut::Code`'s own `FromStr` (re-exported from
/// the `keyboard-types` crate, which is built around this exact code list).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyCombo {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    /// The Windows key.
    pub meta: bool,
    pub code: String,
}

impl HotkeyCombo {
    pub fn default_combo() -> Self {
        Self {
            ctrl: true,
            alt: true,
            shift: false,
            meta: false,
            code: "KeyH".to_string(),
        }
    }
}

impl Default for HotkeyCombo {
    fn default() -> Self {
        Self::default_combo()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub hotkey: HotkeyCombo,
    /// Whether this combo is genuinely registered with the OS right now —
    /// separate from whatever `settings.json` holds, since a combo already
    /// claimed by something else fails to register and must never be shown
    /// as active just because it's what's saved.
    pub registered: bool,
    /// Set only when a `set_manual_fill_hotkey` call itself just failed.
    pub error: Option<String>,
}

/// What's actually registered right now. Managed as app state so the two
/// commands below can read/update it without re-deriving it from
/// `settings.json` on every call — the file holds the persisted wish, this
/// holds the live truth.
struct ManualFillState {
    #[cfg(target_os = "windows")]
    current: Mutex<Option<Shortcut>>,
    hotkey: Mutex<HotkeyCombo>,
    registered: AtomicBool,
}

impl Default for ManualFillState {
    fn default() -> Self {
        Self {
            #[cfg(target_os = "windows")]
            current: Mutex::new(None),
            hotkey: Mutex::new(HotkeyCombo::default_combo()),
            registered: AtomicBool::new(false),
        }
    }
}

/// Registers the manual-fill hotkey and its handler, using whichever combo
/// `settings.json` last recorded as successfully registered (or this
/// module's own hardcoded default, for a fresh install or a settings file
/// predating this feature).
///
/// Never fatal: the combination already being claimed by another app is an
/// expected, unremarkable failure mode on Windows, and manual fill simply
/// stays unavailable — with `manual_fill_hotkey_status` reporting
/// `registered: false` so Settings can say so — rather than blocking the app
/// from starting.
pub fn install<R: Runtime>(app: &AppHandle<R>) {
    app.manage(ManualFillState::default());

    #[cfg(target_os = "windows")]
    {
        let combo = prefs::load(app)
            .map(|s| s.manual_fill_hotkey)
            .unwrap_or_default();

        if let Err(err) = register(app, combo) {
            log::warn!("manual-fill hotkey unavailable: {err}");
        }
    }
}

#[cfg(target_os = "windows")]
fn register<R: Runtime>(
    app: &AppHandle<R>,
    combo: HotkeyCombo,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let shortcut = to_shortcut(&combo)?;
    let handle = app.clone();

    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }

            // Capture before anything below — including showing our own
            // window — can steal focus away from the real target.
            handle.vault().capture_foreground_target();

            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            let _ = handle.emit(EVENT_ENTER_PICK_MODE, ());
        })?;

    let state = app.state::<ManualFillState>();
    *state.current.lock().unwrap_or_else(|p| p.into_inner()) = Some(shortcut);
    *state.hotkey.lock().unwrap_or_else(|p| p.into_inner()) = combo;
    state.registered.store(true, Ordering::SeqCst);
    Ok(())
}

/// Builds the plugin's `Shortcut` from our own platform-neutral
/// `HotkeyCombo`, and rejects a combo with no modifier at all — a bare,
/// unmodified key as a *global* hotkey is both unusual for the OS to grant
/// and a bad idea for an app that types passwords (too easy to trigger by
/// accident while typing normally elsewhere).
#[cfg(target_os = "windows")]
fn to_shortcut(combo: &HotkeyCombo) -> std::result::Result<Shortcut, Box<dyn std::error::Error>> {
    let code = Code::from_str(&combo.code)
        .map_err(|_| format!("unrecognized key: {}", combo.code))?;

    let mut modifiers = Modifiers::empty();
    if combo.ctrl {
        modifiers = modifiers | Modifiers::CONTROL;
    }
    if combo.alt {
        modifiers = modifiers | Modifiers::ALT;
    }
    if combo.shift {
        modifiers = modifiers | Modifiers::SHIFT;
    }
    if combo.meta {
        modifiers = modifiers | Modifiers::SUPER;
    }

    if modifiers.is_empty() {
        return Err("include at least one modifier key (Ctrl, Alt, Shift, or the Windows key)".into());
    }

    Ok(Shortcut::new(Some(modifiers), code))
}

fn status<R: Runtime>(app: &AppHandle<R>, error: Option<String>) -> HotkeyStatus {
    let state = app.state::<ManualFillState>();
    // Built as a local, not the block's own tail expression — a `HotkeyStatus`
    // literal returned directly here borrows `state` (via the `MutexGuard`
    // `.lock()` produces) while also needing `state` itself to be dropped as
    // part of the same block; the borrow checker orders a tail expression's
    // own temporaries *after* the block's locals are dropped, so `state`
    // (owned by this function, not the caller) was found to not live long
    // enough for its own borrow. Binding to `result` first, then returning
    // it as its own statement, drops the `MutexGuard` (and the borrow it
    // holds on `state`) before `state` itself goes out of scope, which is
    // exactly the fix `rustc`'s own suggestion for this shape recommends.
    let result = HotkeyStatus {
        hotkey: state
            .hotkey
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone(),
        registered: state.registered.load(Ordering::SeqCst),
        error,
    };
    result
}

/// Read-only snapshot — what's persisted, and whether it's genuinely live.
#[tauri::command]
pub async fn manual_fill_hotkey_status<R: Runtime>(app: AppHandle<R>) -> Result<HotkeyStatus> {
    Ok(status(&app, None))
}

/// Registers `combo` as the new manual-fill hotkey, replacing whatever was
/// registered before. Only persisted to `settings.json` on a real,
/// successful registration — a rejected combo (already claimed by something
/// else, or with no modifier) leaves the previous one active and unchanged,
/// and is reported back via `HotkeyStatus.error` rather than as a hard IPC
/// failure, so Settings can show the reason inline next to the picker.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn set_manual_fill_hotkey<R: Runtime>(
    app: AppHandle<R>,
    combo: HotkeyCombo,
) -> Result<HotkeyStatus> {
    let shortcut = match to_shortcut(&combo) {
        Ok(s) => s,
        Err(err) => return Ok(status(&app, Some(err.to_string()))),
    };

    let state = app.state::<ManualFillState>();
    let previous = state
        .current
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();

    if previous.as_ref() == Some(&shortcut) {
        // Already exactly this combo — nothing to register.
        return Ok(status(&app, None));
    }

    let handle = app.clone();
    let registration = app
        .global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            handle.vault().capture_foreground_target();
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = handle.emit(EVENT_ENTER_PICK_MODE, ());
        });

    if let Err(err) = registration {
        // The old registration (if any) is left exactly as it was — a
        // failed change must never leave manual fill with no hotkey at all.
        return Ok(status(
            &app,
            Some(format!("That combination is already in use ({err}).")),
        ));
    }

    if let Some(old) = previous {
        // Best-effort: `old` and the new shortcut are already known to
        // differ (the equality short-circuit above), so this is strictly
        // cleanup of a now-orphaned registration, not a race with the one
        // just added.
        let _ = app.global_shortcut().unregister(old);
    }

    *state.current.lock().unwrap_or_else(|p| p.into_inner()) = Some(shortcut);
    *state.hotkey.lock().unwrap_or_else(|p| p.into_inner()) = combo.clone();
    state.registered.store(true, Ordering::SeqCst);

    // Persist only after a real, successful registration — settings.json
    // holds "the combo that actually works," never a wish.
    if let Ok(mut settings) = prefs::load(&app) {
        settings.manual_fill_hotkey = combo;
        let _ = prefs::save(&app, &settings);
    }

    Ok(status(&app, None))
}

/// Every other platform: fail closed, same as every other Windows-only
/// command in this app.
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn set_manual_fill_hotkey<R: Runtime>(
    app: AppHandle<R>,
    _combo: HotkeyCombo,
) -> Result<HotkeyStatus> {
    let _ = app;
    Err(Error::Unavailable)
}
