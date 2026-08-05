use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

/// Coarse, deliberately uninformative errors.
///
/// Two rules drive this enum. First, nothing derived from vault contents or
/// credentials may appear in a message that crosses into the renderer, because
/// that is where messages become console output and crash reports. Second, the
/// unlock path must not distinguish a wrong password from a corrupt file — so
/// the vault layer collapses both into one outcome and this type gives it
/// nothing finer to work with.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io")]
    Io,

    #[error("not-found")]
    NotFound,

    #[error("network")]
    Network,

    #[error("unauthorized")]
    Unauthorized,

    #[error("not-configured")]
    NotConfigured,

    #[error("conflict")]
    Conflict,

    #[error("invalid-argument")]
    InvalidArgument,

    #[error("internal")]
    Internal,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => Error::NotFound,
            _ => Error::Io,
        }
    }
}

impl From<reqwest::Error> for Error {
    fn from(_: reqwest::Error) -> Self {
        Error::Network
    }
}

impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Error::Internal
    }
}

impl From<tauri_plugin_passhandler::Error> for Error {
    fn from(e: tauri_plugin_passhandler::Error) -> Self {
        match e {
            tauri_plugin_passhandler::Error::NotFound => Error::NotFound,
            tauri_plugin_passhandler::Error::Denied => Error::Unauthorized,
            tauri_plugin_passhandler::Error::InvalidArgument => Error::InvalidArgument,
            _ => Error::Internal,
        }
    }
}
