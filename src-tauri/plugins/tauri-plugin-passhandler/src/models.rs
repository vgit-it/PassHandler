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

pub const SERVICE_NAME: &str = "com.passhandler.app";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreSetRequest {
    pub slot: SecretSlot,
    /// Base64 for binary key material, plain UTF-8 for tokens. The plugin does
    /// not interpret it.
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreGetRequest {
    pub slot: SecretSlot,
    /// Shown in the biometric prompt when the slot requires user presence.
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreDeleteRequest {
    pub slot: SecretSlot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStoreGetResponse {
    /// `None` when the slot is empty. Distinguishing "no value stored" from
    /// "you were denied" matters to the UI: the first means offer to set
    /// biometrics up, the second means fall back to the master password.
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricStatusResponse {
    /// Hardware present and at least one credential enrolled.
    pub available: bool,
    /// Short, non-actionable reason when `available` is false, for the UI to
    /// explain itself ("no biometrics enrolled" vs "no sensor").
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BiometricAuthenticateRequest {
    pub reason: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureRequest {
    pub blocked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardWriteRequest {
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardClearRequest {
    /// Cleared only if the clipboard still holds exactly this. Anything the
    /// user copied afterwards is theirs and must survive.
    pub expected: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardClearResponse {
    pub cleared: bool,
}
