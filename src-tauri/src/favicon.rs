//! Best-effort favicon fetching for entry rows.
//!
//! Fetches go straight to the site the entry points at — never a third-party
//! favicon service — because a third-party service would learn every domain
//! in the user's vault just from icon requests, which is exactly the kind of
//! leak this app otherwise goes out of its way to avoid (see `drive.rs`'s
//! module docs on what Google itself is allowed to see).
//!
//! This module is deliberately isolated: every command here returns `Ok(_)`
//! even on failure (a missing icon, a timeout, a malformed page), because a
//! decorative icon is never worth surfacing an error for, let alone one that
//! could interrupt unlocking or listing entries. Nothing else in the app calls
//! into this module, and this module calls into nothing else's state beyond
//! the shared HTTP client and its own cache file — so it cannot break any
//! other feature, and no other feature can break it.
//!
//! No HTML-parsing crate is pulled in for this. The one thing that needs
//! finding — a `<link rel="icon" ...>` tag's `href` — is small enough to hand
//! -roll, and the app's binary size is already a live concern (see the
//! `Cargo.toml` release profile).

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use url::Url;

use crate::error::Result;

// v2: bumped after a real favicon was cached at just under the old 2MB cap
// and then reliably crashed the Android WebView's renderer process on every
// single launch — served straight from this file, with no network involved,
// so nothing short of a new filename could stop it recurring. A real favicon
// is at most a few tens of KB; anything near the old cap was never a
// legitimate icon in the first place.
const CACHE_FILE: &str = "favicon-cache-v2.json";
const CACHE_TTL_SECS: i64 = 30 * 24 * 60 * 60; // 30 days, including cached misses.
const MAX_BODY_BYTES: usize = 200 * 1024;
// Base64 expands bytes by ~4/3. Checked against cached entries too, not just
// fresh downloads, so a bad entry can never be served regardless of how it
// got there.
const MAX_BASE64_LEN: usize = (MAX_BODY_BYTES * 4) / 3 + 4;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaviconResponse {
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    fetched_at: i64,
    /// `None` records a confirmed miss, so a site with no icon is not
    /// re-fetched on every list render.
    icon: Option<FaviconResponse>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Cache(std::collections::HashMap<String, CacheEntry>);

/// The favicon cache, held in memory for the life of the app and mirrored to
/// disk in the background.
///
/// Earlier versions re-read and re-wrote the *entire* cache file, from disk,
/// synchronously, on every single `fetch_favicon` call — including one for
/// every row on screen, fired concurrently the moment the entry list mounts.
/// On a vault with more than a handful of entries that meant dozens of
/// concurrent synchronous `std::fs` calls landing on Tauri's async worker
/// threads at once. Those threads are the same pool that answers the
/// WebView's IPC requests (every command invocation on Android round-trips
/// through the custom protocol handler); enough of them blocked on disk I/O
/// at the same moment starved that dispatch entirely, and the in-flight
/// request timed out waiting on the response channel — which is what
/// produced the "Webpage not available" / blank-screen launches, not a
/// WebView renderer crash. Keeping the cache in memory means a lookup is a
/// `HashMap` read with no I/O at all, and the only disk access left is a
/// fire-and-forget write on Tokio's dedicated blocking pool, which never
/// competes with the async workers for a thread.
pub struct FaviconCache(Mutex<Cache>);

impl FaviconCache {
    /// Reads the cache file once, at startup. Meant to be called from the
    /// `setup` hook, before the webview starts making requests — a single
    /// blocking read here is normal Tauri `setup` usage and costs nothing
    /// once, unlike the same read repeated per-entry, per-render.
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let cache = cache_path(app)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self(Mutex::new(cache))
    }
}

fn cache_path<R: Runtime>(app: &AppHandle<R>) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(CACHE_FILE))
}

/// Writes a snapshot of the cache to disk on Tokio's blocking-task pool —
/// never the async worker pool the IPC dispatch relies on — and is not
/// awaited by the caller. Best-effort and not atomic: a lost or corrupted
/// write just means a few icons are re-fetched next launch, never anything a
/// user could notice as data loss, and never something worth making a
/// command wait on.
fn save_cache_in_background<R: Runtime>(app: &AppHandle<R>, cache: Cache) {
    let Some(path) = cache_path(app) else { return };
    tauri::async_runtime::spawn_blocking(move || {
        if let Ok(raw) = serde_json::to_string(&cache) {
            let _ = std::fs::write(&path, raw);
        }
    });
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Normalise an entry's URL down to `scheme://host[:port]` — the cache key,
/// and the base every relative icon `href` resolves against.
fn origin_of(raw: &str) -> Option<Url> {
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = Url::parse(&candidate).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    if url.host_str().is_none() {
        return None;
    }
    let origin = url.origin().ascii_serialization();
    Url::parse(&origin).ok()
}

/// Fetch the favicon for the site an entry points at.
///
/// Always returns `Ok` — a `None` payload means "no icon found or the
/// request failed", never a hard error. Callers should treat this exactly
/// like any other optional decoration.
#[tauri::command]
pub async fn fetch_favicon<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<Option<FaviconResponse>> {
    let Some(origin) = origin_of(&url) else {
        return Ok(None);
    };
    let key = origin.as_str().to_string();

    {
        // Scoped so the (synchronous, never held across an `.await`) lock is
        // dropped before any network I/O starts.
        let cache = app.state::<FaviconCache>();
        let cache = cache.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = cache.0.get(&key) {
            let fresh = now() - entry.fetched_at < CACHE_TTL_SECS;
            let sane = entry
                .icon
                .as_ref()
                .is_none_or(|icon| icon.data_base64.len() <= MAX_BASE64_LEN);
            if fresh && sane {
                return Ok(entry.icon.clone());
            }
            // Stale or oversized (e.g. cached before MAX_BASE64_LEN existed)
            // — fall through and re-fetch under today's rules rather than
            // trusting whatever is on disk.
        }
    }

    let icon = fetch_uncached(&app, &origin).await;

    let snapshot = {
        let cache = app.state::<FaviconCache>();
        let mut cache = cache.0.lock().unwrap_or_else(|e| e.into_inner());
        cache.0.insert(
            key,
            CacheEntry {
                fetched_at: now(),
                icon: icon.clone(),
            },
        );
        cache.clone()
    };
    save_cache_in_background(&app, snapshot);

    Ok(icon)
}

async fn fetch_uncached<R: Runtime>(app: &AppHandle<R>, origin: &Url) -> Option<FaviconResponse> {
    let client = crate::http_client(app).ok()?;

    // 1. Look at the page itself for a declared icon — the common case, and
    //    the one that finds high-resolution or SVG icons a guessed path would
    //    miss.
    if let Ok(response) = client
        .get(origin.as_str())
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
    {
        if response.status().is_success() {
            if let Ok(body) = read_capped(response).await {
                if let Ok(html) = String::from_utf8(body) {
                    if let Some(href) = find_icon_href(&html) {
                        if let Ok(icon_url) = origin.join(&href) {
                            if let Some(icon) = download_icon(&client, icon_url.as_str()).await {
                                return Some(icon);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Fall back to the well-known default path.
    let fallback = origin.join("/favicon.ico").ok()?;
    download_icon(&client, fallback.as_str()).await
}

async fn read_capped(response: reqwest::Response) -> std::result::Result<Vec<u8>, ()> {
    let mut body = Vec::new();
    let mut stream = response;
    while let Ok(Some(chunk)) = stream.chunk().await {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            break;
        }
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_BODY_BYTES {
            break;
        }
    }
    Ok(body)
}

async fn download_icon(client: &reqwest::Client, icon_url: &str) -> Option<FaviconResponse> {
    let response = client.get(icon_url).timeout(FETCH_TIMEOUT).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }

    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or(v).trim().to_string())
        .filter(|m| m.starts_with("image/"))
        .unwrap_or_else(|| guess_mime(icon_url));

    let bytes = read_capped(response).await.ok()?;
    if bytes.is_empty() {
        return None;
    }

    use base64::Engine;
    Some(FaviconResponse {
        mime,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

fn guess_mime(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else {
        // .ico and anything unrecognised — browsers accept this for <img src>.
        "image/x-icon".to_string()
    }
}

/// Scan for the first `<link rel="icon" ...>` (or `shortcut icon`, or
/// `apple-touch-icon`) and return its `href`, hand-rolled rather than via a
/// full HTML parser — this only ever needs one attribute off one kind of tag.
fn find_icon_href(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut search_from = 0;

    // Prefer a standard/shortcut icon over an apple-touch-icon if both exist,
    // by scanning for `<link` tags in document order and checking each one's
    // `rel` attribute rather than searching for `rel="icon"` as a substring,
    // which would also match inside an unrelated attribute value.
    while let Some(rel_pos) = lower[search_from..].find("<link") {
        let tag_start = search_from + rel_pos;
        let tag_end = lower[tag_start..]
            .find('>')
            .map(|i| tag_start + i)
            .unwrap_or(lower.len());
        let tag = &html[tag_start..tag_end.min(html.len())];
        let tag_lower = &lower[tag_start..tag_end.min(lower.len())];

        search_from = tag_end.max(tag_start + 1);

        let Some(rel) = extract_attr(tag_lower, "rel") else {
            continue;
        };
        let is_icon = rel
            .split_whitespace()
            .any(|token| matches!(token, "icon" | "shortcut" | "apple-touch-icon"));
        if !is_icon {
            continue;
        }

        if let Some(href) = extract_attr(tag, "href") {
            if !href.trim().is_empty() {
                return Some(href.trim().to_string());
            }
        }
    }

    None
}

/// Extract `name="value"` (or `name='value'`) from a single tag's source.
/// `haystack` and the attribute name are expected to already be lowercase
/// when matching case-insensitively; the returned slice preserves original
/// casing when called on non-lowered `tag` text (used for `href`).
fn extract_attr(haystack: &str, name: &str) -> Option<String> {
    let needle_lower = haystack.to_ascii_lowercase();
    let pat = format!("{name}=");
    let pos = needle_lower.find(&pat)?;
    let rest = &haystack[pos + pat.len()..];
    let mut chars = rest.chars();
    match chars.next()? {
        quote @ ('"' | '\'') => {
            let value_start = pos + pat.len() + 1;
            let end_rel = rest[1..].find(quote)?;
            Some(haystack[value_start..value_start + end_rel].to_string())
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_of_normalises_scheme_and_drops_path() {
        let origin = origin_of("https://example.com/login?x=1").unwrap();
        assert_eq!(origin.as_str(), "https://example.com/");
    }

    #[test]
    fn origin_of_defaults_bare_host_to_https() {
        let origin = origin_of("example.com").unwrap();
        assert_eq!(origin.as_str(), "https://example.com/");
    }

    #[test]
    fn origin_of_rejects_non_http_schemes() {
        assert!(origin_of("ftp://example.com").is_none());
    }

    #[test]
    fn finds_standard_icon_link() {
        let html = r#"<html><head><link rel="icon" href="/favicon.png"></head></html>"#;
        assert_eq!(find_icon_href(html), Some("/favicon.png".to_string()));
    }

    #[test]
    fn finds_shortcut_icon_case_insensitively() {
        let html = r#"<LINK REL="Shortcut Icon" HREF="/x.ico">"#;
        assert_eq!(find_icon_href(html), Some("/x.ico".to_string()));
    }

    #[test]
    fn ignores_unrelated_link_tags() {
        let html = r#"<link rel="stylesheet" href="/style.css">"#;
        assert_eq!(find_icon_href(html), None);
    }

    #[test]
    fn returns_none_when_no_link_tag_present() {
        assert_eq!(find_icon_href("<html><body>hi</body></html>"), None);
    }
}
