use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

/// Errors crossing the IPC boundary are deliberately coarse.
///
/// A precise message here would be a way to learn things about the vault or the
/// user's credential store from the renderer, and error strings have a habit of
/// ending up in logs. Callers get a category, not a diagnosis.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("unavailable")]
    Unavailable,

    #[error("not found")]
    NotFound,

    #[error("denied")]
    Denied,

    #[error("storage failure")]
    Storage,

    #[error("invalid argument")]
    InvalidArgument,

    #[error("platform failure")]
    Platform,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[cfg(mobile)]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(_: tauri::plugin::mobile::PluginInvokeError) -> Self {
        Error::Platform
    }
}
