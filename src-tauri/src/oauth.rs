//! Google OAuth 2.0 with PKCE.
//!
//! Vault treats itself as a public client — PKCE is what actually
//! secures the exchange — but Google's Cloud Console issues a "client secret"
//! for Desktop-app clients regardless, and its token endpoint rejects a
//! request that omits it (`invalid_request: client_secret is missing`), even
//! though the official docs list the field as optional for installed apps.
//! So it is sent, but not treated as confidential: it is build-time
//! configuration exactly like the client ID, not something requiring its own
//! protection — a value compiled into a binary handed to a few people is not
//! a secret either way. Android clients are never issued one at all, and none
//! is sent for that flow.
//!
//! The entire flow runs in Rust. Consent opens in the *system browser*, never in
//! our webview — so Google's page cannot script our origin, and our Content
//! Security Policy stays at `default-src 'self'` with no Google domains in it.
//! The refresh token goes from the token endpoint straight into OS secure
//! storage and is never returned across the IPC boundary; the access token
//! never leaves this process either.
//!
//! The only scope requested is `drive.appdata`, which Google classes as
//! non-sensitive and which confines the app to its own hidden folder. It cannot
//! see, and cannot ask to see, anything else in the user's Drive.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::oneshot;

use tauri_plugin_vault::{
    SecretSlot, SecureStoreDeleteRequest, SecureStoreGetRequest, SecureStoreSetRequest, VaultExt,
};

use crate::error::{Error, Result};

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

/// Android redirect path, appended to the reversed-client-ID scheme.
#[cfg(mobile)]
const MOBILE_REDIRECT_PATH: &str = ":/oauth2redirect";

/// Google's Android OAuth clients do not accept a loopback redirect, and they
/// do not accept the package name as a scheme either. The redirect must use the
/// *reversed client ID*: `123-abc.apps.googleusercontent.com` becomes
/// `com.googleusercontent.apps.123-abc`.
///
/// This is derived rather than hard-coded because the client ID is build-time
/// configuration — see docs/google-oauth-setup.md, which also gives the
/// matching `intent-filter` that has to go into the Android manifest.
#[cfg(mobile)]
fn mobile_redirect_uri(client_id: &str) -> String {
    let suffix = ".apps.googleusercontent.com";
    let id = client_id.strip_suffix(suffix).unwrap_or(client_id);
    format!("com.googleusercontent.apps.{id}{MOBILE_REDIRECT_PATH}")
}

/// How long to wait for the user to finish at Google before giving up. Long
/// enough to find a password manager and a phone, short enough that a forgotten
/// browser tab does not pin a listener open forever.
const CONSENT_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct OauthState {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    client_id: Option<String>,
    /// Only ever set for the desktop client — see the module docs. Android
    /// clients have no secret, and none is sent for that flow.
    client_secret: Option<String>,
    /// Access token and its expiry. Memory only — a restart re-derives it from
    /// the refresh token in secure storage.
    access_token: Option<String>,
    expires_at: Option<u64>,
    /// Set while a consent round-trip is outstanding.
    pending: Option<Pending>,
}

struct Pending {
    /// Echoed back by Google and compared on the way in. A callback carrying a
    /// different value is either stale or forged; either way it gets no code
    /// exchange.
    state: String,
    redirect_uri: String,
    sender: Option<oneshot::Sender<std::result::Result<String, Error>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveStatus {
    /// Configured means a client ID is present. Without one the app is
    /// local-only, and the UI says so rather than offering a button that fails.
    pub configured: bool,
    pub connected: bool,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_urlsafe(bytes: usize) -> Result<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|_| Error::Internal)?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf))
}

fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

// ---------------------------------------------------------------- commands

/// Supply the platform's OAuth client ID, and its client secret if it has one.
///
/// Called once at startup by the renderer, which picks between the desktop and
/// Android client from build-time configuration. Passing an empty string for
/// either is how an unconfigured build, or a client with no secret, reports
/// itself — see the module docs for why the desktop client needs one at all.
#[tauri::command]
pub async fn drive_configure<R: Runtime>(
    app: AppHandle<R>,
    client_id: String,
    client_secret: String,
) -> Result<()> {
    let state = app.state::<OauthState>();
    let mut inner = state.inner.lock().map_err(|_| Error::Internal)?;
    inner.client_id = if client_id.trim().is_empty() {
        None
    } else {
        Some(client_id)
    };
    inner.client_secret = if client_secret.trim().is_empty() {
        None
    } else {
        Some(client_secret)
    };
    Ok(())
}

#[tauri::command]
pub async fn drive_status<R: Runtime>(app: AppHandle<R>) -> Result<DriveStatus> {
    let configured = {
        let state = app.state::<OauthState>();
        let inner = state.inner.lock().map_err(|_| Error::Internal)?;
        inner.client_id.is_some()
    };

    let connected = configured && stored_refresh_token(&app).await?.is_some();
    Ok(DriveStatus {
        configured,
        connected,
    })
}

#[tauri::command]
pub async fn drive_connect<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    let (client_id, client_secret) = {
        let state = app.state::<OauthState>();
        let inner = state.inner.lock().map_err(|_| Error::Internal)?;
        (
            inner.client_id.clone().ok_or(Error::NotConfigured)?,
            inner.client_secret.clone(),
        )
    };

    let verifier = random_urlsafe(64)?;
    let csrf_state = random_urlsafe(24)?;
    let (tx, rx) = oneshot::channel();

    // Desktop listens on an ephemeral loopback port; Android is called back
    // through a custom scheme handled by the activity.
    #[cfg(desktop)]
    let redirect_uri = {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| Error::Io)?;
        let port = listener.local_addr().map_err(|_| Error::Io)?.port();
        spawn_loopback_listener(app.clone(), listener);
        format!("http://127.0.0.1:{port}")
    };

    #[cfg(mobile)]
    let redirect_uri = mobile_redirect_uri(&client_id);

    {
        let state = app.state::<OauthState>();
        let mut inner = state.inner.lock().map_err(|_| Error::Internal)?;
        inner.pending = Some(Pending {
            state: csrf_state.clone(),
            redirect_uri: redirect_uri.clone(),
            sender: Some(tx),
        });
    }

    let auth_url = format!(
        "{AUTH_ENDPOINT}?client_id={}&redirect_uri={}&response_type=code&scope={}\
         &code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(SCOPE),
        urlencoding::encode(&challenge_for(&verifier)),
        urlencoding::encode(&csrf_state),
    );

    // The free `tauri_plugin_opener::open_url` function always shells out
    // (`xdg-open`/`open`/`start`), which only exists on desktop — it fails
    // silently on Android (no browser opens, no visible error) because
    // there's no shell to spawn there. `app.opener().open_url(...)`, via the
    // `OpenerExt` trait, is the platform-dispatched version: desktop still
    // shells out, but mobile goes through the native Kotlin/Swift `open`
    // command instead, which is what actually launches the consent screen.
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|_| Error::Internal)?;

    let code = match tokio::time::timeout(CONSENT_TIMEOUT, rx).await {
        Ok(Ok(Ok(code))) => code,
        Ok(Ok(Err(e))) => {
            clear_pending(&app);
            return Err(e);
        }
        // Sender dropped, or the wait timed out.
        _ => {
            clear_pending(&app);
            return Err(Error::Unauthorized);
        }
    };

    let redirect_uri = {
        let state = app.state::<OauthState>();
        let inner = state.inner.lock().map_err(|_| Error::Internal)?;
        inner
            .pending
            .as_ref()
            .map(|p| p.redirect_uri.clone())
            .unwrap_or(redirect_uri)
    };

    let tokens = exchange_code(
        &app,
        &client_id,
        client_secret.as_deref(),
        &code,
        &verifier,
        &redirect_uri,
    )
    .await?;
    clear_pending(&app);

    // Without a refresh token the connection dies at the first access-token
    // expiry, so treat its absence as a failed connect rather than storing a
    // session that will silently stop working.
    let refresh = tokens.refresh_token.ok_or_else(|| {
        eprintln!("[oauth] token exchange succeeded but no refresh_token was returned");
        Error::Unauthorized
    })?;
    store_refresh_token(&app, &refresh).await?;
    cache_access_token(&app, tokens.access_token, tokens.expires_in)?;

    Ok(())
}

/// Called by the Android deep-link handler with the full callback URL.
#[tauri::command]
pub async fn drive_complete_auth<R: Runtime>(app: AppHandle<R>, url: String) -> Result<()> {
    deliver_callback(&app, &url);
    Ok(())
}

#[tauri::command]
pub async fn drive_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<()> {
    // Revoke first so the grant disappears from the user's Google account, not
    // just from this device. A failure here must not prevent local cleanup.
    if let Ok(Some(token)) = stored_refresh_token(&app).await {
        let client = crate::http_client(&app)?;
        let _ = client
            .post(REVOKE_ENDPOINT)
            .form(&[("token", token.as_str())])
            .send()
            .await;
    }

    {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            app.vault().secure_store_delete(SecureStoreDeleteRequest {
                slot: SecretSlot::DriveRefreshToken,
            })
        })
        .await
        .map_err(|_| Error::Internal)??;
    }

    let state = app.state::<OauthState>();
    let mut inner = state.inner.lock().map_err(|_| Error::Internal)?;
    inner.access_token = None;
    inner.expires_at = None;
    Ok(())
}

// ------------------------------------------------------------- token access

/// A valid access token, refreshing it if the cached one is spent.
///
/// Returned only to other Rust modules. It never crosses into the renderer.
pub async fn access_token<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    {
        let state = app.state::<OauthState>();
        let inner = state.inner.lock().map_err(|_| Error::Internal)?;
        // 60 seconds of slack so a token cannot expire between this check and
        // the request that uses it.
        if let (Some(token), Some(expiry)) = (&inner.access_token, inner.expires_at) {
            if expiry > now_secs() + 60 {
                return Ok(token.clone());
            }
        }
    }

    let (client_id, client_secret) = {
        let state = app.state::<OauthState>();
        let inner = state.inner.lock().map_err(|_| Error::Internal)?;
        (
            inner.client_id.clone().ok_or(Error::NotConfigured)?,
            inner.client_secret.clone(),
        )
    };

    let refresh = stored_refresh_token(app).await?.ok_or(Error::Unauthorized)?;

    let mut form = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ];
    // See the module docs: only the desktop client has one, and only it needs
    // to send it — Google's token endpoint rejects the request without it.
    if let Some(secret) = client_secret.as_deref() {
        form.push(("client_secret", secret));
    }

    let response: TokenResponse = crate::http_client(app)?
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| {
            // An invalid_grant means the user revoked access, or the consent
            // screen is still in Testing mode and the token aged out after
            // seven days. Both need a fresh connect, not a retry.
            if e.status() == Some(reqwest::StatusCode::BAD_REQUEST)
                || e.status() == Some(reqwest::StatusCode::UNAUTHORIZED)
            {
                Error::Unauthorized
            } else {
                Error::Network
            }
        })?
        .json()
        .await?;

    cache_access_token(app, response.access_token.clone(), response.expires_in)?;

    // Google may hand back a rotated refresh token. Persist it or the next
    // refresh fails.
    if let Some(new_refresh) = response.refresh_token {
        store_refresh_token(app, &new_refresh).await?;
    }

    Ok(response.access_token)
}

async fn exchange_code<R: Runtime>(
    app: &AppHandle<R>,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse> {
    let mut form = vec![
        ("client_id", client_id),
        ("code", code),
        ("code_verifier", verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ];
    // See the module docs: only the desktop client has one, and only it needs
    // to send it — Google's token endpoint rejects the request without it.
    if let Some(secret) = client_secret {
        form.push(("client_secret", secret));
    }

    let response = crate::http_client(app)?
        .post(TOKEN_ENDPOINT)
        .form(&form)
        .send()
        .await?;

    if !response.status().is_success() {
        // Temporary diagnostics: errors crossing the IPC boundary are coarse
        // by design (see docs/SECURITY.md), so print Google's actual reason
        // to this terminal rather than the renderer. Safe to leave in during
        // setup — it never touches vault contents — but strip it back out
        // once Drive sync is confirmed working.
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        eprintln!("[oauth] token exchange failed: HTTP {status} — {body}");
        return Err(Error::Unauthorized);
    }

    Ok(response.json().await?)
}

fn cache_access_token<R: Runtime>(
    app: &AppHandle<R>,
    token: String,
    expires_in: Option<u64>,
) -> Result<()> {
    let state = app.state::<OauthState>();
    let mut inner = state.inner.lock().map_err(|_| Error::Internal)?;
    inner.access_token = Some(token);
    inner.expires_at = Some(now_secs() + expires_in.unwrap_or(3600));
    Ok(())
}

// `secure_store_*` on the `Vault` extension trait are plain synchronous
// calls into an OS API — Windows Credential Manager here, the Android
// Keystore via a blocking JNI round-trip on mobile — never bounded by
// anything this crate controls. `stored_refresh_token` in particular runs on
// *every* startup, unconditionally, via `drive_status`: called directly
// rather than through the IPC-dispatched `secure_store_get` command, it
// bypassed the `spawn_blocking` wrapper added there for exactly this
// scenario. Left uncovered, it can still starve the same worker-thread pool
// that serves the WebView its own UI — the app-won't-open bug this whole
// investigation has been chasing. Wrapping it here, at the source, is the
// fix; `spawn_blocking`ing every *caller* individually would be easy to miss
// one of.
async fn store_refresh_token<R: Runtime>(app: &AppHandle<R>, token: &str) -> Result<()> {
    let app = app.clone();
    let token = token.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        app.vault()
            .secure_store_set(SecureStoreSetRequest {
                slot: SecretSlot::DriveRefreshToken,
                value: token,
            })
            .map_err(Into::into)
    })
    .await
    .map_err(|_| Error::Internal)?
}

async fn stored_refresh_token<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let response = app.vault().secure_store_get(SecureStoreGetRequest {
            slot: SecretSlot::DriveRefreshToken,
            reason: None,
        })?;
        Ok(response.value)
    })
    .await
    .map_err(|_| Error::Internal)?
}

fn clear_pending<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<OauthState>() {
        if let Ok(mut inner) = state.inner.lock() {
            inner.pending = None;
        }
    }
}

/// Resolve an outstanding consent round-trip from a redirect URL.
///
/// Shared by the desktop loopback listener and the Android deep-link handler,
/// so the `state` check that defends against a forged callback happens exactly
/// once, in one place.
pub fn deliver_callback<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let Some(state) = app.try_state::<OauthState>() else {
        return;
    };
    let Ok(mut inner) = state.inner.lock() else {
        return;
    };
    let Some(pending) = inner.pending.as_mut() else {
        return;
    };
    let Some(sender) = pending.sender.take() else {
        return;
    };

    let mut code = None;
    let mut returned_state = None;
    let mut error = None;

    if let Ok(parsed) = url::Url::parse(url) {
        for (key, value) in parsed.query_pairs() {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => returned_state = Some(value.into_owned()),
                "error" => error = Some(value.into_owned()),
                _ => {}
            }
        }
    }

    let outcome = if error.is_some() {
        Err(Error::Unauthorized)
    } else if returned_state.as_deref() != Some(pending.state.as_str()) {
        // Either a stale callback or a forged one. Neither gets a code exchange.
        Err(Error::Unauthorized)
    } else {
        code.ok_or(Error::Unauthorized)
    };

    let _ = sender.send(outcome);
}

// ------------------------------------------------------- desktop loopback

#[cfg(desktop)]
fn spawn_loopback_listener<R: Runtime>(app: AppHandle<R>, listener: tokio::net::TcpListener) {
    tauri::async_runtime::spawn(async move {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // One request, then the socket closes. The listener exists purely to
        // catch a single redirect from the browser.
        let accept = tokio::time::timeout(CONSENT_TIMEOUT, listener.accept()).await;
        let Ok(Ok((mut stream, _))) = accept else {
            return;
        };

        let mut buf = [0u8; 4096];
        let Ok(n) = stream.read(&mut buf).await else {
            return;
        };

        let request = String::from_utf8_lossy(&buf[..n]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");

        let body = concat!(
            "<!doctype html><html><head><meta charset=\"utf-8\">",
            "<title>Vault</title></head>",
            "<body style=\"font-family:system-ui;background:#0b0d10;color:#e2e8f0;",
            "display:flex;align-items:center;justify-content:center;height:100vh\">",
            "<p>You can close this tab and return to Vault.</p></body></html>"
        );

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.shutdown().await;

        deliver_callback(&app, &format!("http://127.0.0.1{target}"));
    });
}
