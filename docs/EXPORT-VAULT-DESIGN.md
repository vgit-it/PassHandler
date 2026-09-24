# One-tap vault export — design

This is the P0 item from `ROADMAP-REVIEW.md`: an explicit "save a copy of your
vault" action, so every friend's durability stops depending on Paul's Drive
setup working. This document doubles as the implementation record — every
section below has now actually been applied to the codebase: `cargo
check`/`clippy`/`test` and `npm run typecheck`/`lint`/`test`/`build` all pass
clean. What's left is the two things nothing in a Linux sandbox can verify —
see "Verification checklist" at the bottom.

## The shape of the decision

`capabilities/default.json` says it outright: no filesystem, shell, process
or HTTP plugin exists in this app, on purpose — every host operation is a
named command in `src-tauri`. Export has to be a new command, not a new
general-purpose plugin, and it has to live partly in `tauri-plugin-vault`
because "show the OS's native save UI" is exactly the kind of thing that plugin
already exists for: no portable implementation, one Rust method with a
Windows body and an Android body.

Windows and Android need genuinely different mechanics, though, not just
different code behind the same idea:

**Windows** gets a native Save-As dialog (via the `rfd` crate) that hands back
a real filesystem path. Once there's a path, writing the file is a single
`fs::write` — no different from any other file operation. Nothing about this
needs Rust to hold the bytes anywhere sensitive; it's a plaintext-ciphertext
copy either way, since `vault.kdbx` on disk is already the encrypted file.

**Android** cannot get a real filesystem path back for an arbitrary save
location — its sandbox only ever hands back a `content://` URI, and only
Kotlin can write through it (via `ContentResolver`). Two ways to get a URI:
a document picker (`ACTION_CREATE_DOCUMENT`) or a share sheet
(`ACTION_SEND`). This design uses the share sheet. It needs no
`ActivityResult` plumbing (fire the intent, don't wait for anything back), and
it covers more of what a friend group would actually want — Drive, email,
Bluetooth, "Save to Files," Nearby Share — where a document picker would only
offer document providers. The cost is that Android never tells the app what
happened after the picker is shown, so the UI has to be honest about that:
"opened the share sheet," not "saved."

Both platforms end up behind one plugin command, `export_vault`, taking the
vault's bytes and a suggested filename, returning an outcome the UI can show
truthfully.

## The filename

`Vault.kdbx`, unconditionally. Not `Vault-vault.kdbx` — the old
`PassHandler-vault.kdbx` pattern needed the `-vault` suffix to say what the
file was, since the app name itself didn't; now that the app *is* named
Vault, repeating the word would just be redundant. No date suffix — that
would need a date/time crate this project doesn't otherwise depend on,
purely to decorate a filename. Both the Windows Save-As dialog and Android's
share targets already handle a repeat save (rename, "Keep both," overwrite
prompt) on their own, so nothing is lost by keeping it static.

## The IPC contract

New type in the plugin, `ExportOutcome` — three states, one per honest
outcome, `Saved`/`Shared` matching the two platforms and `Cancelled` only
reachable on Windows (Android's share sheet never reports a cancel):

```rust
// tauri-plugin-vault/src/models.rs — add alongside the existing structs

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
```

Both structs need both derives even though a naive reading suggests one
direction each — `models.rs`'s existing header comment explains why: the
Android path serialises the request into Kotlin and deserialises what Kotlin
resolves with, so a request must also be `Serialize` and a response must also
be `Deserialize`.

## Rust — desktop (`tauri-plugin-vault/src/desktop.rs`)

`rfd`'s `save_file()` blocks the calling thread showing a native Win32
dialog — potentially for as long as the user takes to pick a folder — which
is exactly the class of call `commands.rs`'s `blocking()` wrapper exists for,
so nothing new is needed there; `export_vault` just has to be another plain
synchronous method like every other one in this file.

`rfd` is Windows-only in `Cargo.toml`, not just Windows-only in behaviour.
Its Linux backend needs GTK (or an XDG portal) at link time, and this
project's Linux target exists purely for `cargo check`/`clippy` on CI without
a Windows machine — see the existing comment above the Linux `keyring`
dependency. Pulling in a GTK dependency there would be a new, unrelated way
for CI to break. So `export_vault` follows the same pattern
`verify_user_presence` already uses: real implementation under
`cfg(target_os = "windows")`, `Err(Error::Unavailable)` everywhere else,
failing closed rather than pretending to work.

```rust
// tauri-plugin-vault/src/desktop.rs — add to impl<R: Runtime> Vault<R>

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
```

`Cargo.toml` addition, Windows-only for the reason above:

```toml
# tauri-plugin-vault/Cargo.toml

[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "3", default-features = false, features = ["windows-native"] }
rfd = { version = "0.17", default-features = false }
base64 = "0.22"
```

(`default-features = false` drops rfd's Linux/Wayland/XDG-portal machinery
entirely — the Windows backend needs none of it, and `cargo add rfd
--target 'cfg(target_os = "windows")' --no-default-features` confirmed no
feature is required for it to resolve. `base64` decodes the vault bytes
before writing them out — not needed on the mobile side, where Kotlin
decodes instead.)

## Rust — mobile (`tauri-plugin-vault/src/mobile.rs`)

A plain forward, same shape as every other mobile command in this file:

```rust
// tauri-plugin-vault/src/mobile.rs — add to impl<R: Runtime> Vault<R>

    pub fn export_vault(&self, payload: ExportVaultRequest) -> Result<ExportOutcome> {
        self.0
            .run_mobile_plugin("exportVault", payload)
            .map_err(Into::into)
    }
```

## Rust — command layer (`tauri-plugin-vault/src/commands.rs`)

Same `blocking()` wrapper as every other command — cheap insurance on
Android, where the call is fast, and the actual reason it exists on Windows:

```rust
// tauri-plugin-vault/src/commands.rs — add near the bottom

#[command]
pub(crate) async fn export_vault<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportVaultRequest,
) -> Result<ExportOutcome> {
    blocking(move || app.vault().export_vault(payload)).await
}
```

## Rust — plugin wiring (`tauri-plugin-vault/src/lib.rs`)

Add `commands::export_vault` to `generate_handler!`, and add `ExportOutcome`
and `ExportVaultRequest` to the `pub use models::{...}` re-export list so the
main crate can name them.

## Rust — build script and permissions

```rust
// tauri-plugin-vault/build.rs — add to COMMANDS
    "export_vault",
```

`permissions/autogenerated/commands/export_vault.toml` is generated by that
build script on the next build — same "Automatically generated - DO NOT EDIT!"
file every other command already has, nothing to write by hand. What does
need a hand edit is the list that turns the generated permission on:

```toml
# tauri-plugin-vault/permissions/default.toml — add to permissions
    "allow-export-vault",
```

No change needed to `capabilities/default.json` or `mobile.json` — both
already grant `vault:default`, which is exactly the list this edit
extends.

## Rust — main crate (`src-tauri/src/vault_file.rs`)

This is the only new command the renderer calls directly. It reads the
already-encrypted bytes straight off disk — the same file `vault_read`
serves — and hands them to the plugin. `Vault`'s own methods are plain
synchronous calls (this session's `store_refresh_token` fix is the reason
that convention exists), so anything outside the plugin's own command layer
that calls them has to wrap the call in `spawn_blocking` itself:

```rust
// src-tauri/src/vault_file.rs

use tauri_plugin_vault::{ExportOutcome, ExportVaultRequest, VaultExt};

const EXPORT_SUGGESTED_NAME: &str = "Vault.kdbx";

/// Save an out-of-band copy of the vault, entirely independent of Drive.
///
/// This never goes through the renderer's own base64 round-trip the way
/// `vault_read`/`vault_write` do — there's no reason for the copy going out
/// the door to pass through JS at all, so it doesn't.
#[tauri::command]
pub async fn vault_export<R: Runtime>(app: AppHandle<R>) -> Result<ExportOutcome> {
    let bytes = fs::read(vault_path(&app)?)?;
    let contents_b64 = base64::engine::general_purpose::STANDARD.encode(bytes);

    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        app.vault().export_vault(ExportVaultRequest {
            contents_b64,
            suggested_name: EXPORT_SUGGESTED_NAME.to_string(),
        })
    })
    .await
    .map_err(|_| Error::Internal)?
    .map_err(Into::into)
}
```

`Error`'s existing `From<tauri_plugin_vault::Error>` impl in
`src-tauri/src/error.rs` already maps the plugin's `Unavailable`/`Storage`/
`InvalidArgument` into the main crate's own error type, so nothing needs to
change there.

Register it in `src-tauri/src/lib.rs`'s `generate_handler!` list, next to the
other `vault_file` commands:

```rust
            vault_file::vault_export,
```

## Kotlin (`tauri-plugin-vault/android/src/main/java/VaultPlugin.kt`)

```kotlin
@InvokeArg
class ExportVaultArgs {
    lateinit var contentsB64: String
    lateinit var suggestedName: String
}
```

```kotlin
    // -------------------------------------------------------------- export

    @Command
    fun exportVault(invoke: Invoke) {
        val args = invoke.parseArgs(ExportVaultArgs::class.java)

        try {
            val bytes = android.util.Base64.decode(args.contentsB64, android.util.Base64.DEFAULT)

            val exportsDir = java.io.File(activity.cacheDir, "exports").apply { mkdirs() }
            val file = java.io.File(exportsDir, args.suggestedName)
            file.writeBytes(bytes)

            val uri = androidx.core.content.FileProvider.getUriForFile(
                activity,
                "com.passhandler.app.fileprovider",
                file,
            )

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/octet-stream"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            activity.runOnUiThread {
                activity.startActivity(Intent.createChooser(shareIntent, "Save a copy of your vault"))
            }

            val result = JSObject()
            result.put("kind", "shared")
            invoke.resolve(result)
        } catch (_: Exception) {
            invoke.reject("platform failure")
        }
    }
```

`androidx.core.content.FileProvider` needs no new Gradle dependency —
`androidx.core.content.ContextCompat` is already used a few lines up in this
same file, and both ship from the same `androidx.core` artifact.

## Android manifest — turns out nothing to do

Before writing this off as another gitignored, survives-rebuild edit (the
same category as the OAuth redirect `intent-filter`), it's worth checking
what's already there: Tauri's own Android template ships a `FileProvider`
in `AndroidManifest.xml` by default —

```xml
<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.fileprovider"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data
        android:name="android.support.FILE_PROVIDER_PATHS"
        android:resource="@xml/file_paths" />
</provider>
```

— backed by a `res/xml/file_paths.xml` that already declares
`<cache-path name="my_cache_images" path="." />`, mapping the *entire* cache
directory (`path="."`) to a shareable URI. `cacheDir/exports/` is already
inside that, so `exportVault`'s `FileProvider.getUriForFile(activity,
"com.passhandler.app.fileprovider", file)` — `${applicationId}` resolves to
`com.passhandler.app` — works with zero manifest changes. No new file, no
edit to an existing one, nothing that needs to survive `android init` being
re-run.

## TypeScript — the port (`src/platform/ports.ts`)

```ts
/** What `Platform.exportVault` resolves to — see docs/EXPORT-VAULT-DESIGN.md. */
export type ExportOutcome =
  | { kind: 'saved'; path: string }
  | { kind: 'shared' }
  | { kind: 'cancelled' };
```

Add to the `Platform` interface, next to `restoreBackup`:

```ts
  /**
   * Save an independent copy of the vault, outside of Drive entirely.
   * Windows shows a native Save-As dialog; Android opens the share sheet.
   * `'shared'` is not a promise the file landed anywhere — Android never
   * reports what happens after the picker opens.
   */
  exportVault(): Promise<ExportOutcome>;
```

## TypeScript — the implementation (`src/platform/tauri.ts`)

`vault_export` is a **main-crate** command (`vault_file.rs`), not a plugin
command — it goes through `call`, not `callPlugin`, so there's no `payload`
wrapper and no `plugin:vault|` prefix. The host reads the vault straight
off disk; nothing needs base64-ing through JS the way `vault_read`/
`vault_write` do:

```ts
    exportVault() {
      return call<ExportOutcome>('vault_export');
    },
```

## TypeScript — the action (`src/app/store.tsx`)

No vault state changes, so this can be a thin forward — but still worth
wrapping in `busy` the same way other slow, blocking host calls are, since
the Windows Save-As dialog can sit open for as long as the user takes:

```tsx
      exportVault: async () => {
        setBusy(true);
        try {
          return await platform.exportVault();
        } finally {
          setBusy(false);
        }
      },
```

Add `exportVault` to the returned context object and to the `useMemo`
dependency array alongside `restoreBackup`.

## UI (`src/ui/screens/Settings.tsx`)

The natural home is the existing `Recovery` section, next to
`RestoreBackup` — both are "get your data out of this app's own storage"
actions. Unlike restore, export is non-destructive, so it needs no confirm
step, just inline feedback on what happened:

```tsx
function ExportVault() {
  const { exportVault, platform } = useApp();
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState(false);

  const run = async () => {
    setError(false);
    setResult(null);
    try {
      setResult(await exportVault());
    } catch {
      setError(true);
    }
  };

  return (
    <Row
      label="Save a copy of your vault"
      hint={
        platform.isAndroid
          ? 'Opens the share sheet — save it to your own cloud, email it to yourself, or send it anywhere else.'
          : 'Choose where to save an encrypted copy of the vault file.'
      }
    >
      <div className="text-right">
        <button className="btn-secondary" onClick={() => void run()}>
          Export
        </button>
        {result?.kind === 'saved' && (
          <p className="mt-1 text-xs text-ok">Saved to {result.path}</p>
        )}
        {error && <p className="mt-1 text-xs text-bad">Could not export the vault.</p>}
      </div>
    </Row>
  );
}
```

Rendered inside the existing `Recovery` section, above or below
`RestoreBackup`.

## Security notes

Nothing here changes the trust model. The bytes leaving the app are the same
ciphertext already on disk — `kdbxweb` never runs on the Rust side, and this
command doesn't touch it either, consistent with `SECURITY.md`'s "the
renderer cannot read a file... every host operation goes through a named
command" and the Tauri-surface section generally. The exported file still
needs the master password to open, so it doesn't reopen the "no recovery"
risk `ROADMAP-REVIEW.md` flags for the vault-creation warning — it's exactly
as recoverable, and exactly as unrecoverable, as the vault already is.

The one new thing worth being explicit about in `SECURITY.md`'s "File safety"
section: on Android, an exported copy sits briefly in the app's cache
directory (`cacheDir/exports/`) before the share target picks it up.
`FLAG_GRANT_READ_URI_PERMISSION` scopes read access to only the app the user
picked, and the file is app-private storage either way — nothing else on the
device can reach it — but it isn't cleaned up automatically today. Worth a
one-line addition wiping `cacheDir/exports/` on next app start, or before
each new export, so repeated exports don't quietly accumulate copies of the
vault outside the one canonical, backed-up location.

## Verification checklist

`cargo check`/`clippy`/`test` across the workspace (both `src-tauri` and the
plugin crate) after the Rust changes, same as every change this session.
`npm run typecheck`/`lint`/`test` after the TypeScript changes. Then two
manual passes, since neither native dialog nor the share sheet can be
exercised by an automated test here: on Windows, export, cancel the dialog
once and confirm `Cancelled` doesn't show as an error, then export for real
and open the resulting file in KeePassXC with the vault's master password to
confirm it round-trips. On Android, export, confirm the share sheet opens
with a sensible set of targets, and send it to something like Drive or email
to confirm the file that arrives opens correctly elsewhere.
