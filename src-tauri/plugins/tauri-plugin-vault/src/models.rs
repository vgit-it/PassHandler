use serde::{Deserialize, Serialize};

/// Named slots in OS secure storage.
///
/// The renderer picks a slot, never a raw key name, so a compromised renderer
/// cannot enumerate or overwrite arbitrary credential-store entries.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SecretSlot {
    /// Google OAuth refresh token. Written and read only by the Rust side in
    /// normal operation; exposed here so Settings can clear it on disconnect.
    DriveRefreshToken,
    /// SHA-256 of the master password — what `kdbxweb` calls the password hash.
    /// Guarded by a biometric prompt. See docs/SECURITY.md for why this, and
    /// not the master password itself, is what gets stored.
    BiometricKeyMaterial,
}

impl SecretSlot {
    pub fn account(self) -> &'static str {
        match self {
            SecretSlot::DriveRefreshToken => "drive-refresh-token",
            SecretSlot::BiometricKeyMaterial => "biometric-key-material",
        }
    }

    /// Whether reading this slot must be preceded by a successful biometric or
    /// device-credential check.
    pub fn requires_user_presence(self) -> bool {
        match self {
            SecretSlot::DriveRefreshToken => false,
            SecretSlot::BiometricKeyMaterial => true,
        }
    }
}

/// Windows Credential Manager target/service name. Deliberately left as the
/// literal `"com.passhandler.app"` — matching `tauri.conf.json`'s own
/// `identifier`, unchanged for the same reason — even after the app's
/// display name became "Vault": this string is a storage key, not a label,
/// and renaming it would silently orphan every credential already stored
/// under the old name (Windows Hello's WebAuthn-descriptor blob and the
/// Google Drive refresh token both live here — see `SecretSlot`). Anyone
/// with an existing entry would just see "not enrolled" with no error to
/// explain why. Change it only as a deliberate migration, never as part of
/// an ordinary rename.
pub const SERVICE_NAME: &str = "com.passhandler.app";

// Every type below derives both halves of serde, which looks redundant if you
// only picture the command layer: requests arrive from the webview, responses
// go back to it, so one direction each would do.
//
// On Android the same structs make a second trip. `run_mobile_plugin` serialises
// the request across the JNI boundary into Kotlin and deserialises what Kotlin
// resolves with, so a request must also be `Serialize` and a response must also
// be `Deserialize`. Dropping either derive compiles on desktop and breaks only
// the Android build.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreSetRequest {
    pub slot: SecretSlot,
    /// Base64 for binary key material, plain UTF-8 for tokens. The plugin does
    /// not interpret it.
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreGetRequest {
    pub slot: SecretSlot,
    /// Shown in the biometric prompt when the slot requires user presence.
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreDeleteRequest {
    pub slot: SecretSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreGetResponse {
    /// `None` when the slot is empty. Distinguishing "no value stored" from
    /// "you were denied" matters to the UI: the first means offer to set
    /// biometrics up, the second means fall back to the master password.
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatusResponse {
    /// Hardware present and at least one credential enrolled.
    pub available: bool,
    /// Short, non-actionable reason when `available` is false, for the UI to
    /// explain itself ("no biometrics enrolled" vs "no sensor").
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricAuthenticateRequest {
    pub reason: String,
}

/// Android's own fill keyboard (`VaultIme`) — whether this platform has one,
/// and whether the person has turned it on in the system's keyboard list.
/// See `docs/ONBOARDING-TIPS-DESIGN.md`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardStatusResponse {
    pub available: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureRequest {
    pub blocked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWriteRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardClearRequest {
    /// Cleared only if the clipboard still holds exactly this. Anything the
    /// user copied afterwards is theirs and must survive.
    pub expected: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardClearResponse {
    pub cleared: bool,
}

/// Android only — see the module docs on `clipboard_schedule_clear` for why
/// this exists alongside `ClipboardClearRequest` rather than replacing it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardScheduleClearRequest {
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportVaultRequest {
    /// The vault's own bytes, base64-encoded for the IPC/JNI hop — same
    /// convention as `SecureStoreSetRequest::value`. Already ciphertext; the
    /// plugin never decodes it as anything but bytes to place somewhere.
    pub contents_b64: String,
    /// A default filename the platform UI may let the user change.
    pub suggested_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ExportOutcome {
    /// Windows only: the exact path the user chose.
    Saved { path: String },
    /// Android only: the share sheet was shown. Android gives the app no
    /// callback for what happens next — same as any other app's Share
    /// action — so this is not a claim the file landed anywhere, only that
    /// the picker was opened.
    Shared,
    /// Windows only: the Save-As dialog was closed without picking a
    /// location.
    Cancelled,
}

/// A request to pick a `.kdbx` file from local storage — no fields, but its
/// own type rather than `()` for the same reason `biometric_status` passes
/// `serde_json::json!({})` on the mobile side: Kotlin resolves an `Invoke`
/// with an object, and an empty request keeps the desktop/mobile call sites
/// symmetric with every other command here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ImportOutcome {
    /// The bytes of the file the user picked, base64-encoded for the
    /// IPC/JNI hop — same convention as `ExportVaultRequest::contents_b64`.
    /// Never validated as a real `.kdbx` file here; that is `kdbxweb`'s job,
    /// once the bytes reach the webview.
    Picked { data_b64: String },
    /// The picker was closed without choosing a file. Not an error — the
    /// same "walked away from the dialog" outcome `ExportOutcome::Cancelled`
    /// already models for the Save-As side.
    Cancelled,
}

/// Windows only — see `docs/MANUAL-FILL-DESIGN.md`. One field's worth of
/// text — a username, or a password — typed directly into whatever window
/// last had OS focus before the manual-fill hotkey fired, via synthetic
/// keystrokes. Never the clipboard, and never both fields in one call: the
/// picker has a separate button per field, so the caller decides which value
/// this is by which button was pressed, not this crate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeTextRequest {
    pub text: String,
}

/// Windows only — see `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then Tab"
/// section. `is_password` is `None` when Windows UI Automation couldn't
/// answer (unsupported control, COM failure, no UIA support on the target —
/// see `desktop.rs`'s `ui_automation` module) — the caller falls back to the
/// old Username→Tab→Password heuristic in that case, never treats `None` as
/// "no."
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusedFieldPasswordResponse {
    pub is_password: Option<bool>,
}
