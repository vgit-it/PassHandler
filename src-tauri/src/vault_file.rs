//! Local vault storage.
//!
//! The local `.kdbx` is a cache of the synced vault, not a document the user
//! manages. It lives in the app data directory on Windows and in the app's
//! private sandbox on Android, and the user never chooses its path.
//!
//! Every write is atomic. A password vault that is half-written is a password
//! vault that is gone, so the original file is never opened for truncation:
//! new bytes go to a temporary file in the same directory, are flushed to the
//! platform, and only then replace the original by rename.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{Error, Result};

const VAULT_FILE: &str = "vault.kdbx";
const BACKUP_FILE: &str = "vault.kdbx.bak";
const TEMP_FILE: &str = "vault.kdbx.tmp";

/// One rolling backup per session, taken before the first write.
///
/// Per session rather than per write: the point is to survive a bad save or a
/// bad merge within this run, and a backup rewritten on every keystroke would
/// be overwritten with the same damage before the user noticed.
#[derive(Default)]
pub struct BackupState {
    taken: AtomicBool,
}

fn app_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|_| Error::Io)?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn vault_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(app_dir(app)?.join(VAULT_FILE))
}

#[tauri::command]
pub async fn vault_exists<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    Ok(vault_path(&app)?.is_file())
}

/// Returns the encrypted `.kdbx` bytes, base64-encoded for the IPC hop.
///
/// This is ciphertext throughout. Decryption happens in the renderer, in
/// memory, and the result is never handed back here.
#[tauri::command]
pub async fn vault_read<R: Runtime>(app: AppHandle<R>) -> Result<String> {
    let path = vault_path(&app)?;
    let bytes = fs::read(&path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn vault_write<R: Runtime>(app: AppHandle<R>, contents_b64: String) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_b64.as_bytes())
        .map_err(|_| Error::InvalidArgument)?;

    if bytes.is_empty() {
        // Refuse to write an empty vault. Whatever produced this, replacing a
        // real vault with nothing is never the right answer.
        return Err(Error::InvalidArgument);
    }

    let path = vault_path(&app)?;
    let state = app.state::<BackupState>();

    if !state.taken.swap(true, Ordering::SeqCst) && path.is_file() {
        let backup = path.with_file_name(BACKUP_FILE);
        // A failed backup must not block the save: the user's edit is the thing
        // we actually owe them, and the atomic write below already guarantees
        // the old file survives if the new one cannot be written.
        let _ = fs::copy(&path, &backup);
    }

    write_atomic(&path, &bytes)
}

/// Write `bytes` to `path` such that `path` always contains either the complete
/// old contents or the complete new contents, never a mixture.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or(Error::Io)?;
    let temp = path.with_file_name(TEMP_FILE);

    {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        // Durability before visibility. Without this the rename can land while
        // the data is still only in the page cache, and a power loss leaves a
        // correctly-named file full of zeroes.
        file.sync_all()?;
    }

    // On Windows this maps to MoveFileEx with MOVEFILE_REPLACE_EXISTING, so it
    // overwrites; on Unix rename(2) is atomic within a filesystem. The temp
    // file is created in the same directory precisely so this holds.
    fs::rename(&temp, path)?;

    // Persist the directory entry itself, so the rename survives a crash.
    // Windows has no directory handle to sync and returns an error here, which
    // is expected and ignored.
    if let Ok(dir_handle) = fs::File::open(dir) {
        let _ = dir_handle.sync_all();
    }

    Ok(())
}

/// Restore the rolling backup over the live vault.
///
/// Offered in Settings as a manual recovery step. It is never automatic: only
/// the user knows whether the current file or the backup is the one they want.
#[tauri::command]
pub async fn vault_restore_backup<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let path = vault_path(&app)?;
    let backup = path.with_file_name(BACKUP_FILE);

    if !backup.is_file() {
        return Err(Error::NotFound);
    }

    let bytes = fs::read(&backup)?;
    write_atomic(&path, &bytes)
}

#[tauri::command]
pub async fn vault_backup_exists<R: Runtime>(app: AppHandle<R>) -> Result<bool> {
    Ok(vault_path(&app)?.with_file_name(BACKUP_FILE).is_file())
}

/// Delete the local vault and its backup.
///
/// Used only when the user explicitly disconnects and resets the app. Sync
/// never calls this — "the remote is missing" is not a reason to destroy the
/// only copy of someone's passwords.
#[tauri::command]
pub async fn vault_delete_local<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let path = vault_path(&app)?;
    for candidate in [
        path.clone(),
        path.with_file_name(BACKUP_FILE),
        path.with_file_name(TEMP_FILE),
    ] {
        if candidate.is_file() {
            fs::remove_file(&candidate)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_existing_contents() {
        let dir = std::env::temp_dir().join(format!("ph-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(VAULT_FILE);

        write_atomic(&path, b"first").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"first");

        write_atomic(&path, b"second-and-longer").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second-and-longer");

        // The temporary file must not be left behind.
        assert!(!path.with_file_name(TEMP_FILE).exists());

        fs::remove_dir_all(&dir).ok();
    }
}
