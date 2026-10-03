use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Vault<R>> {
    Ok(Vault {
        app: app.clone(),
        #[cfg(target_os = "windows")]
        captured_foreground: std::sync::Mutex::new(None),
    })
}

pub struct Vault<R: Runtime> {
    app: AppHandle<R>,
    /// The window that had OS focus the instant the manual-fill hotkey fired,
    /// captured before showing/focusing our own window can steal it. Written
    /// by `capture_foreground_target`, called directly from the hotkey
    /// handler in the main crate's `lib.rs`; read back by `type_credentials`
    /// once the user has picked an entry. See `docs/MANUAL-FILL-DESIGN.md`.
    #[cfg(target_os = "windows")]
    captured_foreground: std::sync::Mutex<Option<isize>>,
}

impl<R: Runtime> Vault<R> {
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
            .app
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

    // ------------------------------------------------------------ keyboard

    /// Android-only: Windows fills through the manual-fill hotkey, not a
    /// keyboard of its own, so there is nothing to turn on here.
    pub fn keyboard_status(&self) -> Result<KeyboardStatusResponse> {
        Ok(KeyboardStatusResponse {
            available: false,
            enabled: false,
        })
    }

    pub fn open_keyboard_settings(&self) -> Result<()> {
        Err(Error::Unavailable)
    }

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
        self.app
            .clipboard()
            .write_text(payload.text)
            .map_err(|_| Error::Platform)
    }

    pub fn clipboard_clear_if_matches(
        &self,
        payload: ClipboardClearRequest,
    ) -> Result<ClipboardClearResponse> {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        let current = self.app.clipboard().read_text().unwrap_or_default();
        if current != payload.expected {
            // Something else was copied in the meantime. That content belongs
            // to the user and must not be destroyed.
            return Ok(ClipboardClearResponse { cleared: false });
        }

        self.app
            .clipboard()
            .write_text(String::new())
            .map_err(|_| Error::Platform)?;
        Ok(ClipboardClearResponse { cleared: true })
    }

    /// No-op on desktop. Windows does not restrict clipboard reads from an
    /// unfocused window the way Android restricts them from a backgrounded
    /// app, so `clipboard_clear_if_matches` above already clears reliably
    /// here — the JS-side countdown timer that calls it is enough. This
    /// command exists purely so `useClipboard.ts` can call it unconditionally
    /// without branching on platform.
    pub fn clipboard_schedule_clear(&self, _payload: ClipboardScheduleClearRequest) -> Result<()> {
        Ok(())
    }

    pub fn clipboard_cancel_scheduled_clear(&self) -> Result<()> {
        Ok(())
    }

    // --------------------------------------------------------------- export

    #[cfg(target_os = "windows")]
    pub fn export_vault(&self, payload: ExportVaultRequest) -> Result<ExportOutcome> {
        use base64::Engine;

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(payload.contents_b64.as_bytes())
            .map_err(|_| Error::InvalidArgument)?;

        let chosen = rfd::FileDialog::new()
            .set_title("Save a copy of your vault")
            .set_file_name(&payload.suggested_name)
            .add_filter("KeePass database", &["kdbx"])
            .save_file();

        let Some(path) = chosen else {
            return Ok(ExportOutcome::Cancelled);
        };

        std::fs::write(&path, &bytes).map_err(|_| Error::Storage)?;

        Ok(ExportOutcome::Saved {
            path: path.display().to_string(),
        })
    }

    #[cfg(not(target_os = "windows"))]
    pub fn export_vault(&self, _payload: ExportVaultRequest) -> Result<ExportOutcome> {
        // Linux is a type-checking target only, same as `verify_user_presence`
        // above. Fail closed: no dialog backend means no export, never a
        // silent no-op that looks like success.
        Err(Error::Unavailable)
    }

    // --------------------------------------------------------------- import

    #[cfg(target_os = "windows")]
    pub fn import_vault(&self) -> Result<ImportOutcome> {
        use base64::Engine;

        let chosen = rfd::FileDialog::new()
            .set_title("Choose a vault to restore")
            .add_filter("KeePass database", &["kdbx"])
            .pick_file();

        let Some(path) = chosen else {
            return Ok(ImportOutcome::Cancelled);
        };

        let bytes = std::fs::read(&path).map_err(|_| Error::Storage)?;
        Ok(ImportOutcome::Picked {
            data_b64: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }

    #[cfg(not(target_os = "windows"))]
    pub fn import_vault(&self) -> Result<ImportOutcome> {
        // Linux is a type-checking target only, same as `export_vault` above.
        Err(Error::Unavailable)
    }

    // -------------------------------------------------------------- autotype

    /// Stash the window that currently has OS focus, before showing or
    /// focusing our own window can steal it. Called directly (not through
    /// IPC — there is no renderer state to carry it) from the global-shortcut
    /// handler in the main crate, synchronously, as the very first thing it
    /// does. See `docs/MANUAL-FILL-DESIGN.md`.
    #[cfg(target_os = "windows")]
    pub fn capture_foreground_target(&self) {
        let hwnd = unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
        let mut slot = self
            .captured_foreground
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = Some(hwnd.0 as isize);
    }

    /// Restore focus to the window captured by `capture_foreground_target`,
    /// then type `payload.text` into it as synthetic Unicode keystrokes. One
    /// call fills one field — the picker in the renderer has a separate
    /// button per field (username, password) rather than one action that
    /// types both with a Tab in between, so there is nothing here that needs
    /// to know which field it's typing into. The clipboard is never touched
    /// — see `docs/MANUAL-FILL-DESIGN.md` for why this exists.
    #[cfg(target_os = "windows")]
    pub fn type_text(&self, payload: TypeTextRequest) -> Result<()> {
        autotype::type_text(&self.captured_foreground, &payload.text)
    }

    /// Linux is a type-checking target only, same as the other Windows-only
    /// methods above. Fail closed: nothing types anywhere.
    #[cfg(not(target_os = "windows"))]
    pub fn type_text(&self, _payload: TypeTextRequest) -> Result<()> {
        Err(Error::Unavailable)
    }

    /// A single Tab key press into the window `capture_foreground_target`
    /// captured — see `type_text`'s own doc for the same foreground-restore
    /// dance. Used by the picker to move focus to a form's next field right
    /// after a fill — see `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then Tab"
    /// section for why, and for the heuristic (no way to inspect what field
    /// Tab actually landed on) this picker uses to decide whether to also
    /// auto-fill a password there.
    #[cfg(target_os = "windows")]
    pub fn press_tab(&self) -> Result<()> {
        autotype::press_tab(&self.captured_foreground)
    }

    /// Linux is a type-checking target only, same as `type_text` above.
    #[cfg(not(target_os = "windows"))]
    pub fn press_tab(&self) -> Result<()> {
        Err(Error::Unavailable)
    }

    /// Best-effort, real check of whether the currently-focused UI element
    /// is a password field, via Windows UI Automation's `IsPassword`
    /// property — see `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then Tab"
    /// section, "the option not taken" subsection, for why this was
    /// originally skipped in favor of a pure heuristic, and what changed:
    /// this reads exactly the one property this feature needs, not the
    /// wider "read arbitrary UI element properties system-wide" capability
    /// that subsection declined to build. Called right after `press_tab`,
    /// from the same renderer flow — see `VaultScreen.tsx`'s
    /// `tabThenMaybeFillPassword` — so "currently focused" means "whatever
    /// Tab just landed on" in practice.
    #[cfg(target_os = "windows")]
    pub fn focused_field_is_password(&self) -> Result<FocusedFieldPasswordResponse> {
        Ok(FocusedFieldPasswordResponse {
            is_password: ui_automation::focused_element_is_password(),
        })
    }

    /// Linux is a type-checking target only, same as `type_text` above.
    #[cfg(not(target_os = "windows"))]
    pub fn focused_field_is_password(&self) -> Result<FocusedFieldPasswordResponse> {
        Err(Error::Unavailable)
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

/// Manual-fill's actual keystroke synthesis. See `docs/MANUAL-FILL-DESIGN.md`.
///
/// `SendInput` with `KEYEVENTF_UNICODE` bypasses the active keyboard layout
/// entirely — every code unit is delivered as itself, not as a virtual-key
/// code that has to exist on some layout. That is what makes this safe for
/// arbitrary generated passwords, which routinely contain characters no
/// physical layout can type directly.
#[cfg(target_os = "windows")]
mod autotype {
    use std::sync::Mutex;
    use std::thread;
    use std::time::Duration;

    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_TAB,
    };
    use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

    use crate::{Error, Result};

    /// One field's worth of text, typed into whatever has focus in the
    /// restored target window. No Tab, no assumption about what else is on
    /// the form — the picker calls this once per button press, once for
    /// username and, separately, once for password.
    pub fn type_text(target: &Mutex<Option<isize>>, text: &str) -> Result<()> {
        restore_foreground(target)?;

        // The target window needs a moment to actually finish taking focus
        // back before it reliably receives synthetic input — sending
        // immediately after `SetForegroundWindow` returns has been observed
        // elsewhere to drop the first keystroke or two.
        thread::sleep(Duration::from_millis(80));

        type_unicode(text)
    }

    /// One Tab key press — real `VK_TAB`, not `KEYEVENTF_UNICODE` like
    /// `type_text` above, since this needs to reach the target's normal
    /// keyboard-navigation handling rather than deliver a literal character.
    /// Same foreground-restore-then-settle dance as `type_text`, since this
    /// is called as its own separate command, not chained onto a `type_text`
    /// call inside one blocking task — see `press_tab`'s own doc.
    pub fn press_tab(target: &Mutex<Option<isize>>) -> Result<()> {
        restore_foreground(target)?;
        thread::sleep(Duration::from_millis(80));
        send_virtual_key(VIRTUAL_KEY(VK_TAB.0))
    }

    fn restore_foreground(target: &Mutex<Option<isize>>) -> Result<()> {
        let raw = target
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .ok_or(Error::Unavailable)?;

        // SAFETY: `raw` was produced by `GetForegroundWindow` in
        // `capture_foreground_target` and is only ever reinterpreted here as
        // the same handle value, never dereferenced.
        let ok = unsafe { SetForegroundWindow(HWND(raw as *mut core::ffi::c_void)) };
        if !ok.as_bool() {
            // Windows restricts which processes may steal foreground focus,
            // and the target window may simply have closed in the meantime.
            // Fail closed rather than typing into whatever now happens to
            // have focus instead.
            return Err(Error::Platform);
        }
        Ok(())
    }

    fn type_unicode(text: &str) -> Result<()> {
        for unit in text.encode_utf16() {
            send_unicode_unit(unit)?;
        }
        Ok(())
    }

    /// One UTF-16 code unit, pressed then released.
    fn send_unicode_unit(unit: u16) -> Result<()> {
        let down = keybd_input(unit, KEYEVENTF_UNICODE);
        let up = keybd_input(unit, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        send_inputs(&[down, up])
    }

    /// One real virtual-key press then release — no `KEYEVENTF_UNICODE`, so
    /// `wVk` (not `wScan`) is what identifies the key. Only ever called with
    /// `VK_TAB` today; kept general rather than hardcoding Tab into
    /// `keybd_input` itself, since that function's whole shape is built
    /// around `KEYEVENTF_UNICODE` scan-code delivery, a genuinely different
    /// case from a named virtual key.
    fn send_virtual_key(vk: VIRTUAL_KEY) -> Result<()> {
        let down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let up = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        send_inputs(&[down, up])
    }

    fn keybd_input(scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    // No virtual-key code — KEYEVENTF_UNICODE means `wScan`
                    // alone identifies the character.
                    wVk: VIRTUAL_KEY(0),
                    wScan: scan,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn send_inputs(inputs: &[INPUT]) -> Result<()> {
        let sent = unsafe { SendInput(inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent as usize != inputs.len() {
            return Err(Error::Platform);
        }
        Ok(())
    }
}

/// Real password-field detection via Windows UI Automation — see
/// `focused_field_is_password`'s own doc above for the "why this, not the
/// wider UIA read `MANUAL-FILL-DESIGN.md` originally declined" reasoning.
/// Every type and function used here (`CoInitializeEx`, `CoCreateInstance`,
/// `CUIAutomation`, `IUIAutomation`, `IUIAutomationElement`,
/// `UIA_IsPasswordPropertyId`, `VARIANT`'s generated union layout) was
/// checked against the `windows` crate's own generated documentation for
/// `0.58` and Microsoft's UI Automation reference before being used — the
/// same discipline `docs/MANUAL-FILL-DESIGN.md` used for the original
/// `SendInput` code. It compiles against MSVC; whether it reports password
/// fields correctly has to be tried against real forms on a real machine.
#[cfg(target_os = "windows")]
mod ui_automation {
    use std::thread;
    use std::time::Duration;

    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_BOOL;
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, UIA_IsPasswordPropertyId,
    };

    /// `None` on any failure along the way — an unsupported control, a COM
    /// failure, or simply no focused element to ask about. See
    /// `focused_field_is_password`'s own doc for why the caller must treat
    /// `None` as "couldn't tell," never as a confident "no."
    pub fn focused_element_is_password() -> Option<bool> {
        // A short settle delay on the theory that focus needs a moment to
        // actually land after `press_tab`'s own Tab keystroke reaches the
        // target — the same kind of settle `type_text`/`press_tab` already
        // sleep for after restoring foreground, above. Whether this exact
        // duration is right (or needed at all) can only really be tuned by
        // trying it against real forms on a real machine.
        thread::sleep(Duration::from_millis(60));

        // COM must be initialized on this thread before any of the calls
        // below. This runs on one of Tokio's blocking-pool threads (see
        // `commands.rs`'s `blocking` helper) — not assumed to already be
        // initialized, since which physical thread that pool hands out
        // isn't something this crate controls. Calling `CoInitializeEx`
        // more than once on the same thread is itself harmless (it just
        // bumps a reference count); `RPC_E_CHANGED_MODE` — already
        // initialized in a different threading model by something else on
        // this same thread — is treated as "fine, proceed" rather than a
        // hard failure, since apartment threading is a preference here, not
        // something any call below actually depends on.
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if hr.is_err() && hr != RPC_E_CHANGED_MODE {
            return None;
        }

        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok()?;

        let element = unsafe { automation.GetFocusedElement() }.ok()?;
        let value = unsafe { element.GetCurrentPropertyValue(UIA_IsPasswordPropertyId) }.ok()?;

        variant_as_bool(&value)
    }

    /// `UIA_IsPasswordPropertyId` always answers as `VT_BOOL`. From `windows`
    /// 0.58 on, `VARIANT` is `windows::core::VARIANT` — an owning wrapper,
    /// no longer the raw struct in `Win32::System::Variant` — so the raw
    /// layout is reached through `as_raw()` (`vt` tags which arm of the
    /// inner union is live; `boolVal` is a classic COM `VARIANT_BOOL` — `-1`
    /// for true, `0` for false). Not the wrapper's `TryFrom<&VARIANT> for
    /// bool`: that goes through `VariantToBoolean`, which coerces `VT_EMPTY`
    /// to `false` — a confident "no" where this must answer "couldn't tell".
    fn variant_as_bool(value: &windows::core::VARIANT) -> Option<bool> {
        let inner = unsafe { &value.as_raw().Anonymous.Anonymous };
        if inner.vt != VT_BOOL.0 {
            return None;
        }
        let raw = unsafe { inner.Anonymous.boolVal };
        Some(raw != 0)
    }
}
