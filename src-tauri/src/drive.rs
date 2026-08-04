//! Google Drive `appDataFolder` client.
//!
//! Only the encrypted `.kdbx` blob is ever transferred. Google receives no key,
//! no password and no plaintext, and the `drive.appdata` scope means the app
//! physically cannot reach any other part of the user's Drive.
//!
//! This module does transport only. It reports revisions and moves bytes; it
//! never decides what to do about a revision mismatch. That decision — pull,
//! merge, retry, mark dirty — belongs to the sync engine in TypeScript, where
//! it can be tested without a network.
//!
//! ## The concurrency caveat
//!
//! The Drive API has no conditional write: there is no way to say "replace this
//! file only if its revision is still X" and have the server reject a stale
//! write atomically. Dropbox has this; Drive does not. So the protocol is
//! check-then-write-then-verify, and the verify step is the one that matters —
//! it is how a concurrent writer is detected after the fact. `upload` returns
//! the resulting revision precisely so the caller can check it.

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::error::{Error, Result};
use crate::oauth;

const FILES_ENDPOINT: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_ENDPOINT: &str = "https://www.googleapis.com/upload/drive/v3/files";

/// Metadata the sync engine reasons about.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    /// Absent only for file types Drive does not version. A binary blob always
    /// has one, so the sync engine treats `None` as a reason to distrust the
    /// response rather than as a normal state.
    #[serde(default)]
    pub head_revision_id: Option<String>,
    #[serde(default)]
    pub modified_time: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
}

pub fn vault_file_name(vault_id: &str) -> String {
    format!("vault-{vault_id}.kdbx")
}

async fn authorized<R: Runtime>(
    app: &AppHandle<R>,
    request: reqwest::RequestBuilder,
) -> Result<reqwest::RequestBuilder> {
    let token = oauth::access_token(app).await?;
    Ok(request.bearer_auth(token))
}

fn check_status(response: &reqwest::Response) -> Result<()> {
    match response.status() {
        s if s.is_success() => Ok(()),
        reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
            Err(Error::Unauthorized)
        }
        reqwest::StatusCode::NOT_FOUND => Err(Error::NotFound),
        _ => Err(Error::Network),
    }
}

/// Locate this vault's file in `appDataFolder`, if it has ever been uploaded.
#[tauri::command]
pub async fn drive_find_file<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
) -> Result<Option<DriveFile>> {
    let name = vault_file_name(&vault_id);
    let query = format!("name = '{}' and trashed = false", name.replace('\'', "\\'"));

    let request = crate::http_client(&app)?.get(FILES_ENDPOINT).query(&[
        ("spaces", "appDataFolder"),
        ("q", query.as_str()),
        ("fields", "files(id,name,headRevisionId,modifiedTime)"),
        ("pageSize", "10"),
    ]);

    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;

    let list: FileList = response.json().await?;
    Ok(list.files.into_iter().next())
}

/// Current metadata for a known file. This is the revision check that must run
/// immediately before an upload, and again immediately after it.
#[tauri::command]
pub async fn drive_get_metadata<R: Runtime>(
    app: AppHandle<R>,
    file_id: String,
) -> Result<DriveFile> {
    let request = crate::http_client(&app)?
        .get(format!("{FILES_ENDPOINT}/{file_id}"))
        .query(&[("fields", "id,name,headRevisionId,modifiedTime")]);

    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;
    Ok(response.json().await?)
}

/// Download the encrypted vault, base64-encoded for the IPC hop.
#[tauri::command]
pub async fn drive_download<R: Runtime>(app: AppHandle<R>, file_id: String) -> Result<String> {
    let request = crate::http_client(&app)?
        .get(format!("{FILES_ENDPOINT}/{file_id}"))
        .query(&[("alt", "media")]);

    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;

    let bytes = response.bytes().await?;
    if bytes.is_empty() {
        // An empty body is not a vault. Surfacing this as a transport failure
        // keeps the sync engine from trying to parse nothing and concluding the
        // remote is corrupt.
        return Err(Error::Network);
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Create the vault file in `appDataFolder`.
///
/// `appDataFolder` is a reserved parent alias — the folder is hidden from the
/// user's Drive UI and is deleted along with the app's data if they revoke it.
#[tauri::command]
pub async fn drive_create<R: Runtime>(
    app: AppHandle<R>,
    vault_id: String,
    contents_b64: String,
) -> Result<DriveFile> {
    let bytes = decode_body(&contents_b64)?;

    let metadata = serde_json::json!({
        "name": vault_file_name(&vault_id),
        "parents": ["appDataFolder"],
    });

    let form = reqwest::multipart::Form::new()
        .part(
            "metadata",
            reqwest::multipart::Part::text(metadata.to_string())
                .mime_str("application/json; charset=UTF-8")
                .map_err(|_| Error::Internal)?,
        )
        .part(
            "file",
            reqwest::multipart::Part::bytes(bytes)
                .mime_str("application/octet-stream")
                .map_err(|_| Error::Internal)?,
        );

    let request = crate::http_client(&app)?
        .post(UPLOAD_ENDPOINT)
        .query(&[
            ("uploadType", "multipart"),
            ("fields", "id,name,headRevisionId,modifiedTime"),
        ])
        .multipart(form);

    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;
    Ok(response.json().await?)
}

/// Replace the contents of an existing file, returning the revision the upload
/// produced.
///
/// The caller must compare that revision against a fresh metadata read: Drive
/// will happily accept a write that clobbers another device's, and the returned
/// revision is the only evidence of what actually happened.
#[tauri::command]
pub async fn drive_update<R: Runtime>(
    app: AppHandle<R>,
    file_id: String,
    contents_b64: String,
) -> Result<DriveFile> {
    let bytes = decode_body(&contents_b64)?;

    let request = crate::http_client(&app)?
        .patch(format!("{UPLOAD_ENDPOINT}/{file_id}"))
        .query(&[
            ("uploadType", "media"),
            ("fields", "id,name,headRevisionId,modifiedTime"),
        ])
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(bytes);

    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;
    Ok(response.json().await?)
}

fn decode_body(contents_b64: &str) -> Result<Vec<u8>> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_b64.as_bytes())
        .map_err(|_| Error::InvalidArgument)?;

    if bytes.is_empty() {
        return Err(Error::InvalidArgument);
    }
    Ok(bytes)
}
