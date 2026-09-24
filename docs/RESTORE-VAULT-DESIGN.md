# Restore vault (from a local file, or from Drive) — design

The feature: in Settings, let the user replace the vault on this device with
the bytes of a `.kdbx` file — either one they pick from local storage, or
one of the files sitting in this app's Drive `appDataFolder`. This sits next
to the existing "Restore from backup" row (same section, same
expand-in-place pattern) but covers a different case: getting a vault onto
a device for the *first* time by hand, or deliberately rolling back to an
older Drive revision — not just undoing this session's own edits.

**Status:** built end to end. The TypeScript side — `ports.ts`'s
`ImportOutcome`/`pickLocalVaultFile`, `sync/types.ts`'s
`DriveClient.listFiles`, `tauri.ts`'s implementations of both,
`tests/support/fakeDrive.ts`'s `FakeDrive.listFiles`, `store.tsx`'s
`restoreVault` action, and `Settings.tsx`'s `RestoreVaultRow` — is verified:
typecheck/lint/83 tests/build all pass. The Rust side —
`drive.rs`'s `drive_list_files` and the plugin crate's `ImportOutcome`/
`import_vault` across `models.rs`/`desktop.rs`/`mobile.rs`/`commands.rs`/
`lib.rs`/`build.rs`/`permissions/default.toml` — and the Kotlin side —
`VaultPlugin.kt`'s `importVault`/`handleImportResult` — are written
but **not compiler-verified**: no Rust or Android toolchain exists in the
sandbox this was built in, so both were checked only by brace/paren
balance-counting and staleness greps, the same caveat every other native
change in this project has carried. A real `cargo build`/`cargo tauri
build` (Windows) and `gradlew assembleDebug` (Android) are the first things
to run against this.

The concrete trigger for this feature, from the user: someone who has never
connected Google Drive on a given device should still be able to get their
vault onto it — AirDrop/USB/email an exported `.kdbx`, then "Restore" it
locally. And for the Drive path, the user must be able to see and choose
among the files present, not have the app silently grab "the latest" (or
worse, an arbitrary unordered "first") on their behalf.

## Why this needs care: the cross-vault-merge hazard

`SyncEngine` (`src/sync/syncEngine.ts`) is a singleton built once per app
session (`store.tsx`'s `engineRef`/`engine()`), and its in-memory `state`
(`driveFileId`, `lastKnownRevision`, `vaultId`, ...) is loaded from disk
exactly once, at startup — never reloaded on unlock. If a restore just
overwrites the local vault file's bytes and lets the app carry on, the very
next automatic `sync()` call (fired from `afterUnlock`) uses the *old*
vault's stale `driveFileId`/`vaultId` to try to merge the *new* vault's
plaintext against whatever's sitting at that old Drive location.

`vault.merge(remoteBytes)` needs the same master-key credentials to open the
remote bytes, so most of the time this fails safely — it surfaces as a
`different-master-password` conflict with nothing written. But if the old
and new vaults happen to share a master password (easily possible — e.g.
restoring an older backup of the *same* vault, or two vaults created by the
same person with their usual password), `merge()` succeeds silently and
splices an unrelated vault's entries into the one just restored.
`pullAndMerge` already writes the merged result to local storage before
anything else could catch this.

**The fix:** a restore must do all of the following, in order, before
control returns to the running app:

1. Write the new bytes to local storage (`platform.local.write`).
2. Persist a clean `EMPTY_SYNC_STATE` (`platform.syncState.save`), so a full
   relaunch starts from nothing.
3. Discard the *already-constructed* `SyncEngine` instance for this running
   session — `engineRef.current = null` in `store.tsx` — so `engine()`'s
   existing lazy-construction check builds a fresh one (whose in-memory
   `state` starts at the class's own `{...EMPTY_SYNC_STATE}` default) the
   next time anything calls it, rather than reusing the stale one.
4. `lock()`, forcing the user back to the Unlock screen to enter the
   restored vault's own master password. This is also the existing
   `RestoreBackupRow` precedent, and it means no new in-Settings
   password-entry UI is needed — the Unlock screen's existing wrong-password
   handling covers a bad restore for free.

One more property that falls out of reuse rather than needing new code:
`platform.local.write()` (`vault_write` in `src-tauri/src/vault_file.rs`)
already takes a rolling one-generation backup of whatever was on disk
*before* the first write of a session. So restoring preserves the
pre-restore vault as `vault.kdbx.bak` for the rest of that session — a free
"undo," via the existing Restore-from-backup row, if the wrong file gets
picked.

## The two sources

### Local file

A native "open file" dialog, filtered to `.kdbx`, returning raw bytes.

- **Windows:** `rfd::FileDialog::pick_file()` (already a dependency, used by
  `export_vault`'s `save_file()` on the same platform), inside the plugin
  crate — mirrors `export_vault`'s existing desktop/mobile split.
- **Android:** `Intent.ACTION_OPEN_DOCUMENT` + `CATEGORY_OPENABLE`, type
  `"*/*"` (kdbx has no registered MIME type, so filtering by name/extension
  instead of `mimeType` is more reliable), dispatched through Tauri's
  `Plugin.startActivityForResult` + a new `@ActivityCallback`. This is new
  territory for this codebase — nothing today launches an activity for a
  result — see "Kotlin: importVault" below.
- **Linux (dev/CI only):** stub returning `Error::Unavailable`, same as
  every other Windows-only dialog command.

No new Rust command is needed to *write* the bytes once picked — that's
`platform.local.write()`, already built.

### Drive

Unlike local-file, this needs a **list**, not just a pick-one-file dialog:
the user chooses among the files present in the app's `appDataFolder`. Today
`drive_find_any_file` (onboarding-only) grabs `list.files.into_iter().next()`
from an *unordered* API response — exactly the "just grabs one" gap this
feature exists to fix. New `drive_list_files` command returns every file,
sorted newest-first (`orderBy=modifiedTime desc`), and the UI lists them by
name + modified date; the user picks one, its bytes are pulled via the
already-built `drive_download`.

In the common case there's exactly one file (`vault-<vaultId>.kdbx`, this
app writes only one per vault it knows about) — but a device that's used
this app for multiple vaults over time, or Drive files left over from a
vault that's since been abandoned, can leave more than one sitting there.
Showing the list rather than assuming is what makes "not just the latest
backup" true even in that single-vault-usually case: the user sees what's
actually there instead of trusting an inference.

## New pieces

### Rust — main crate (`src-tauri/src/drive.rs`, `lib.rs`)

```rust
#[tauri::command]
pub async fn drive_list_files<R: Runtime>(app: AppHandle<R>) -> Result<Vec<DriveFile>> {
    let request = crate::http_client(&app)?.get(FILES_ENDPOINT).query(&[
        ("spaces", "appDataFolder"),
        ("q", "trashed = false"),
        ("orderBy", "modifiedTime desc"),
        ("fields", "files(id,name,headRevisionId,modifiedTime)"),
        ("pageSize", "50"),
    ]);
    let response = authorized(&app, request).await?.send().await?;
    check_status(&response)?;
    let list: FileList = response.json().await?;
    Ok(list.files)
}
```

Registered in `lib.rs`'s `generate_handler!` alongside the other `drive::*`
commands. Reuses the existing `DriveFile`/`FileList` types — no new struct.

### Rust — plugin crate (`tauri-plugin-vault`)

- `models.rs`: `ImportOutcome` (`Picked { data_b64: String } | Cancelled`,
  `Serialize` + `Deserialize` — Android's JNI round-trip needs both, same as
  every other plugin model). A base64 string, not a raw byte vector — that
  round-trips far more efficiently through JNI/serde than a JSON array of
  numbers would.
- `desktop.rs`: `#[cfg(target_os = "windows")]` real impl using
  `rfd::FileDialog::new().set_title("Choose a vault to restore").add_filter("KeePass database", &["kdbx"]).pick_file()`;
  `#[cfg(not(target_os = "windows"))]` stub returning `Error::Unavailable`.
- `mobile.rs`: thin `self.0.run_mobile_plugin("importVault", ())` forward.
- `commands.rs`: wrapped in the existing `blocking()` helper (native file
  dialogs can block indefinitely on user interaction).
- `lib.rs`: added to `invoke_handler(tauri::generate_handler![...])`, model
  re-exported via `pub use models::{..., ImportOutcome}`.
- `build.rs`: `import_vault` added to the `COMMANDS` const.
- `permissions/default.toml`: `allow-import-vault` entry.

No new Cargo dependency — `rfd` is already present for `export_vault`.

### Kotlin (`VaultPlugin.kt`)

```kotlin
@Command
fun importVault(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
    }
    startActivityForResult(invoke, intent, "handleImportResult")
}

@ActivityCallback
fun handleImportResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
        val outcome = JSObject()
        outcome.put("kind", "cancelled")
        invoke.resolve(outcome)
        return
    }
    val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    if (bytes == null) {
        invoke.reject("read-failed")
        return
    }
    val outcome = JSObject()
    outcome.put("kind", "picked")
    // NO_WRAP, not DEFAULT — DEFAULT inserts a newline every 76 chars on
    // encode, which the Rust side's plain `base64::STANDARD.decode` (no
    // line-unwrapping) can't parse. Every other command in this plugin only
    // ever *decodes* Rust-produced base64, so this is the first place that
    // direction has come up.
    outcome.put("dataB64", Base64.encodeToString(bytes, Base64.NO_WRAP))
    invoke.resolve(outcome)
}
```

This is the first command in this plugin to use `startActivityForResult` +
`@ActivityCallback` — every existing async-user-interaction command
(`promptBiometric`) uses its own SDK's callback interface instead. Written
to Tauri v2's documented Android plugin API for this pattern, held with
moderate-to-high but not compiler-verified confidence — same caveat as
every other Kotlin change in this project (no Android toolchain in the
sandbox this was written in; checked only by brace/paren balance-counting
and staleness greps).

### TypeScript

- `src/platform/ports.ts`:
  ```ts
  export type ImportOutcome =
    | { kind: 'picked'; data: ArrayBuffer }
    | { kind: 'cancelled' };
  ```
  `Platform.pickLocalVaultFile(): Promise<ImportOutcome>`.
- `src/sync/types.ts`: `DriveClient.listFiles(): Promise<DriveFileMeta[]>`.
- `src/platform/tauri.ts`: `TauriDriveClient.listFiles()` (calls
  `drive_list_files`, maps `DriveFile[]` to `DriveFileMeta[]`);
  `createTauriPlatform()`'s `pickLocalVaultFile()` (calls the plugin's
  `import_vault`, base64-decodes a `'picked'` result back to `ArrayBuffer`
  via the existing `fromBase64` helper).
- `tests/support/fakeDrive.ts`: `FakeDrive.listFiles()` — returns whatever's
  in its in-memory file map, so `DriveClient` keeps typechecking for tests.

### `store.tsx`

One new action, living inside `AppProvider` (needs direct `engineRef`
access, so it can't be a free function like most actions):

```ts
async function restoreVault(data: ArrayBuffer) {
  await platform.local.write(data);
  await platform.syncState.save(EMPTY_SYNC_STATE);
  engineRef.current = null;
  lock();
}
```

### `Settings.tsx` — `RestoreVaultRow`

Sits in the `Recovery` section, after `RestoreBackupRow`. Expand-in-place,
matching that row's pattern rather than a modal:

1. **Choose source.** "From a file" / "From Google Drive" (the Drive option
   disabled, with a short note, when `!driveConnected` — there's nothing to
   list otherwise).
2. **Pick.**
   - *File:* calls `platform.pickLocalVaultFile()` directly; a `'cancelled'`
     outcome just collapses the row back to step 1, no error shown.
   - *Drive:* calls `platform.drive.listFiles()` on entering this step,
     renders each as name + relative modified time; picking one calls
     `platform.drive.download(fileId)` for its bytes. An empty list shows
     "No vault files found in Drive" instead of a picker.
3. **Confirm.** A destructive-style warning — "Replace the vault on this
   device with «name»? You'll need that file's own master password
   afterwards; the current vault is kept as a one-time backup for this
   session." — then `restoreVault(bytes)` on confirm.

Reaches `platform.pickLocalVaultFile()` / `platform.drive.listFiles()` /
`platform.drive.download()` directly from the component, same as
`ExportVault`'s existing precedent of talking to `platform` without a
store passthrough for pieces that are pure I/O with no vault-state
side effects of their own.

## Verification

Same pattern as every other feature this session: TypeScript changes go
through `npm run typecheck && npm run lint && npm run test && npm run
build`. Rust and Kotlin changes have no compiler available in this sandbox
and are checked only by brace/paren balance-counting and staleness greps —
not a substitute for a real build. First real verification for the native
pieces is a Windows build (`cargo tauri build`) and an Android build
(`gradlew assembleDebug` or Android Studio) against a device/emulator,
exercising both the file picker and the Drive list end to end.
