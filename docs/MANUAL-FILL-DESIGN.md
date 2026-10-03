# Manual fill — design

The feature: from any text field, in any app, invoke Vault on demand,
pick an entry, have the value land directly in that field. No clipboard at
any point. This document scopes both platforms as two separate phases with
a real decision point between them — see "Phasing" at the bottom. It is
architecture, not a finished, verified implementation: the Windows half is
small enough to mostly verify in the sandbox ahead of time; the Android half
has one open question that needs an answer from the real project before any
code gets written against it.

**Status:** both halves have now been applied to the codebase. See each
section's own "Verification checklist" before trusting either the way
`EXPORT-VAULT-DESIGN.md`'s equivalent section can be trusted — neither got
the same level of sandbox verification the export feature did, and Android
got none at all: this sandbox has no Kotlin/Android toolchain, so nothing
below has ever been compiled, let alone run on a device.

This is a revision of the first pass at this design. The first version built
more than either platform actually needs — see "What changed from the first
draft" at the end if you want the reasoning, not just the result.

## The one decision everything else follows from

`SECURITY.md` is specific: decryption happens exactly once, in the webview,
via `kdbxweb`. Rust and Kotlin only ever move ciphertext. Both trigger
mechanisms below are native code that needs an actual plaintext value at the
moment of fill — the question this design has to answer is how that happens
without opening a second decrypt path.

The answer: it doesn't. Both platforms require the main window's webview to
already be running and already unlocked. Native code never decrypts
anything and never caches a password. If the app isn't open and unlocked,
the manual-fill entry point fails closed — Windows brings the main window
forward to the normal unlock screen; Android shows "Open Vault to
unlock" with a tap that does the same. This is a real usability cost (you
can't fill into some other app without Vault already unlocked
somewhere), but it's what keeps this from being a new crypto surface. It
also means the exposure window is exactly the one that already exists —
the normal auto-lock idle timer — not a new one.

## Windows

Windows needs no bridge, no second window, and no request/reply mechanism
at all. The reason: the trigger (a global hotkey) and the thing that has to
answer it (the main window's JS, holding the unlocked vault) are already
the same process. There's nothing to hand off to — the hotkey handler can
just use the window that's already there.

### The process just needs to be running — which minimizing already does

A global hotkey only works while the process that registered it is alive.
No new code makes that true: minimizing the window already keeps
Vault running today, exactly as it is — it's only the X button
(`CloseRequested`) that currently locks the vault and exits. Windows
releases a process's hotkey registration automatically when the process
exits, so there's nothing to clean up either. "The app has to be running"
is just what already happens if the window is minimized rather than closed
— nothing to build for that part.

That means no tray icon, no intercepting `CloseRequested`, no background-
process Settings toggle. The hotkey is registered once at startup and lives
exactly as long as the window does. `SendInput`/`GetForegroundWindow`/focus
restoration all work the same regardless of whether Vault's own
window is minimized, visible, or focused, so nothing about the actual fill
mechanism depends on this either way.

The one thing this trades away is discoverability: someone used to "closing
a window means it's gone" won't expect the hotkey to depend on not having
closed it. Worth one line near wherever the hotkey's configured in
Settings: "Closing the window exits Vault and disables this —
minimize it instead to keep quick-fill available." If that turns out to be
a real point of confusion once this is actually in use, minimize-to-tray is
the natural upgrade — but it's not needed to ship a working first version.

### The hotkey

`tauri-plugin-global-shortcut` (confirmed on crates.io, `2.3.2` as of this
writing) registers the combination `Ctrl+Alt+H` — as built, this is
hardcoded at registration (`fill.rs`'s `Shortcut::new`), not
user-configurable; there is no hotkey field in Settings or its underlying
`Platform`/`prefs.rs` model. Using the official plugin here rather
than hand-rolling `RegisterHotKey` and pumping `WM_HOTKEY` through Tauri's
own event loop is a deliberate choice, not a shortcut taken for
convenience — it's the same bias the rest of this project already has
toward small, trusted crates over hand-rolled OS plumbing (`keyring`
instead of raw Credential Manager calls, `rfd` instead of the raw Save
dialog COM interface).

On trigger, in order:

1. Capture the currently focused window's handle *before* anything else
   steals focus: `GetForegroundWindow()` (`Win32_UI_WindowsAndMessaging`,
   confirmed available on the already-pinned `windows` crate version),
   stash it in a small `Mutex<Option<isize>>` state.
2. Show and focus the main window. If the vault isn't unlocked, that's it —
   the user sees the normal unlock screen, same as opening the app any
   other way. Nothing platform-specific needed for this case; it falls out
   of the existing `phase` state machine for free.
3. If it's already unlocked, emit one event, `fill://enter-pick-mode`.
   `VaultScreen` listens for it and switches into pick mode — the existing
   `EntryList`/search UI, unmodified, with a different `onOpen` handler:
   instead of opening the detail screen, it reads the entry's password via
   the same `readPassword` the copy button already calls, and invokes a new
   command, `type_credentials`.

No new UI component, no second window, no request/reply plumbing. Pick mode
is a prop on screens that already exist, the same way `onAdd`/`onSettings`
already are.

### The actual typing

**Superseded** — this section describes the original single-shot design,
where pick mode called one combined `type_credentials` command. It was
later replaced by the per-field flow in "Update: entry-then-field" below,
built on two separate commands, `type_text` and `press_tab` (see the
"Windows" section further down) — kept here for the reasoning behind the
settle-delay/foreground-capture mechanics, which carried over unchanged.

```tsx
// VaultScreen.tsx's pick-mode onOpen handler
async function fillIntoTarget(entry: VaultEntry) {
  const password = readPassword(entry.id);
  if (!password) { setPickMode(false); return; }
  try {
    await platform.typeCredentials(entry.username, password);
    void platform.minimizeMainWindow(); // only on success — see below
  } catch {
    // fail quiet; window stays up so the user can copy manually instead
  } finally {
    setPickMode(false);
  }
}
```

(As built: `minimizeMainWindow` only runs after a successful fill, not in a
`finally` alongside it — if `type_credentials` fails, e.g. because the
target window closed in the meantime, leaving the window open is more
useful than hiding it, since the person still needs to get the password
into that field somehow.)

New plugin command, Windows-only, same shape as every other native-only
command in `tauri-plugin-vault`:

```rust
// desktop.rs, cfg(target_os = "windows")
pub fn type_credentials(&self, payload: TypeCredentialsRequest) -> Result<()> {
    restore_foreground(self.captured_target())?; // SetForegroundWindow on the
                                                   // handle captured in step 1
    std::thread::sleep(Duration::from_millis(80)); // let focus actually land
    type_unicode(&payload.username)?; // SendInput, KEYEVENTF_UNICODE — works
    send_key(VK_TAB)?;                // for any character set, not just
    type_unicode(&payload.password)?; // US-QWERTY
    Ok(())
    // No trailing Enter by default. Auto-submitting a form the user hasn't
    // reviewed is the wrong default for a first version.
}
```

Needs `Win32_UI_Input_KeyboardAndMouse` added to the `windows` crate's
feature list in the plugin's `Cargo.toml` (confirmed available at the
pinned version, next to the ones already there for Windows Hello). As
built, `Win32_UI_WindowsAndMessaging` is also needed there, for
`GetForegroundWindow`/`SetForegroundWindow`.

### Verification checklist

Everything above except the Rust in `desktop.rs`'s `autotype` module and
`fill.rs` is ordinary, non-`cfg(windows)` code, and was verified the same
way the export feature was: `cargo check`/`clippy`/`test` and `npm run
typecheck`/`lint`/`test`/`build`, all clean.

The `cfg(target_os = "windows")` code — the actual `SendInput` call, the
`tauri-plugin-global-shortcut` wiring, `GetForegroundWindow`/
`SetForegroundWindow` — **could not be compiled or type-checked at all**
in this sandbox. `rustup target add x86_64-pc-windows-gnu` fails here:
`static.rust-lang.org`, where the Rust std library for that target is
hosted, is not reachable from this sandbox's network allowlist (only
package registries like crates.io are). This is a real gap from how the
export feature shipped, where the equivalent Windows-only code was fully
`cargo check`ed before it ever reached a Windows machine.

Every Win32 type and function signature used (`SendInput`, `INPUT`,
`INPUT_0`, `KEYBDINPUT`, `KEYBD_EVENT_FLAGS`, `HWND`,
`GetForegroundWindow`, `SetForegroundWindow`) was cross-checked against
`docs.rs`/the `windows` crate's own generated documentation for `0.58`
before being used, and the `tauri-plugin-global-shortcut` API
(`Builder`, `GlobalShortcutExt`, `on_shortcut`, `Shortcut::new`,
`ShortcutState`) was similarly checked against its own docs rather than
guessed from memory. That is meaningfully more confidence than "untested
code," but it is not the same as a real compile, and the very first
build on the real machine is where a typo, a wrong feature flag, or a
subtly wrong signature would actually surface. Build there before relying
on this.

### Update: entry-then-field, matching the Android picker

The original Windows pick mode put fill directly on the search-result row
— `EntryList`'s `Row`, in pick mode, grew a small "Username"/"Password"
button pair beside the title instead of the normal chevron-and-open
button. That predates entry type expansion; once a row's fillable fields
stopped being a fixed pair, this stopped scaling the same way it stopped
scaling on Android (see "Entry type expansion" above) — a Card or a WiFi
entry has a different field set than a Login, and there's no room for a
per-type button strip on a list row.

The fix carries the same shape over from Android: pick mode's rows are now
just rows — tapping (or pressing Enter on the highlighted one) selects an
entry into a new screen, `PickEntryDetail`, rather than filling anything
directly. That screen lists every `fillable` field on the entry (the same
`EntryField[]` `EntryDetail` already renders, reusing its `FieldRow`
component with a new `onFill` action alongside the existing reveal/copy
ones), each with its own Fill button and, for a sensitive field, its own
Show/Hide toggle with the same 10-second auto-hide `EntryDetail`'s reveal
already has. `VaultScreen` tracks which entry (if any) pick mode has
drilled into (`pickEntryId`) the same way it already tracks which screen
(`view`) is showing; Esc and the Cancel button both back out one level at
a time — out of the field list first, then out of pick mode entirely —
mirroring the Android IME's own `showingDetail`/search relationship.

`fillField` (`VaultScreen`'s `type_text`-calling helper) took the
same generalization `WebViewBridge.readField` already went through on the
Android side: it now takes the actual `EntryField` that was picked, not a
hardcoded `'username' | 'password'` literal, and resolves its value the
same way `PickEntryDetail`/`EntryDetail` already do — `field.value`
directly for a non-sensitive field, `readField(entry.id, field.key)` for a
sensitive one fetched at the moment Fill is pressed, never earlier.

## Android

### The trigger: a custom keyboard, not Autofill

A new `InputMethodService`, `VaultIme`, declared as a service in
`AndroidManifest.xml` (inserted by `npm run android:sync-ime` from tracked
`src-tauri/android-ime/manifest-fragments.xml`; see "Source tracking" below).
`onCreateInputView()`/`onStartInputView()` return a native Kotlin view — a
plain scrollable list, not a WebView and not a QWERTY layout — showing
whichever the bridge below returns: the entry list, or a message to open
and unlock Vault first if nothing came back.

No search box in v1 — a real, deliberate simplification, not an oversight.
Typing into an IME's own popup, from the IME itself, is a well-known
awkward case (the IME already owns the "keyboard" role; giving it a second,
separate text field to type into has real UX and focus-handling wrinkles).
A plain scrollable list is enough to ship a working first version; search
can be added later once the basic flow is proven, the same reasoning this
document already applies to field-type detection below.

**Superseded by a later revision** (see "Entry type expansion" below and
the Windows section's own "Update" subsection): a row is no longer where
fill happens. Tapping a search result selects it and switches the keypad's
results region to that entry's own detail view — title plus one row per
fillable field, each with a "Fill" action and, for a sensitive field, its
own Show/Hide toggle — rather than putting fill targets on the result row
itself.
Guessing wrong with no visible reason why is worse than one extra, obvious
tap. Field-type detection is a reasonable thing to add later, once the
basic flow is proven — not a v1 requirement.

After `commitText()`, call `switchToPreviousInputMethod()` so the normal
keyboard comes back on its own. That method was only added in API 28, one
level above this app's `minSdkVersion` of 26 — calling it unguarded would
crash with `NoSuchMethodError` on Android 8.0/8.1. There is no public,
silent equivalent for those two versions; the fallback there is
`InputMethodManager.showInputMethodPicker()`, the system's own picker
dialog — the person chooses their normal keyboard once, rather than Pass
Handler silently failing to switch back at all.

### The bridge: no JNI needed

The open question this document originally flagged — does anything already
keep a reachable reference to the running `WebView`, letting the IME skip
straight to `evaluateJavascript` instead of hand-written JNI — is answered.
`WryActivity.kt` (auto-generated, `DO NOT MODIFY`) has exactly the hook:

```kotlin
abstract class WryActivity : AppCompatActivity() {
    private lateinit var mWebView: RustWebView
    open fun onWebViewCreate(webView: WebView) { }
    fun setWebView(webView: RustWebView) {
        mWebView = webView
        ...
        onWebViewCreate(webView)
    }
    ...
}
```

`onWebViewCreate` is called once, right after the webview is created, and
is a public, `open` extension point clearly meant for exactly this —
`mWebView` itself is `private`, unreachable from outside `WryActivity`, but
this override is the sanctioned way in. `tauri android init` generates
`MainActivity.kt` as a bare `class MainActivity : TauriActivity()` stub;
this app's real version (this override, the `enableEdgeToEdge()` system-bar
setup, the "Unlock Vault" launch handling below) lives in tracked
`src-tauri/android-ime/java/com/passhandler/app/MainActivity.kt` and
`npm run android:sync-ime` copies it over the stub. Edit it there, never
under `gen/`.

That drops the entire JNI fallback and the `fill_bridge.rs`
event/command/`oneshot`-channel mechanism the first two drafts of this
document scoped — none of it is needed. The whole bridge is two small,
new Kotlin files plus one small addition to a third:

**`WebViewBridge.kt`** (new) — a process-wide singleton holding a
`WeakReference<WebView>` (weak, not strong: this object outlives any one
Activity, and a strong reference would keep a destroyed Activity's webview
— and everything it holds — alive for the rest of the process's life).
`attach`/`detach` are called from `MainActivity`; `listEntries` and
`readField` are called from `VaultIme`, each via
`webView.evaluateJavascript(script, callback)` against two functions the
webview exposes on `window`. (`readField(entryId, key)` generalises what
was originally `readPassword(entryId)`, once the entry type expansion work
gave a row more than one possible sensitive field to fill — see that
section below. `readIcon(entryId)`, for the result rows' favicons, came
later still — see "Result-row icons".)

```kotlin
fun listEntries(callback: (List<FillEntry>) -> Unit) {
    val webView = webViewRef?.get() ?: return callback(emptyList())
    webView.post {
        webView.evaluateJavascript(
            "window.__vaultFill && window.__vaultFill.listEntries()"
        ) { raw -> callback(parseEntries(raw)) }
    }
}
```

**`MainActivity.kt`** (edited) — the one new override:

```kotlin
override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webViewForFill = webView
    WebViewBridge.attach(webView)
}
```

**`VaultIme.kt`** (new) — the `InputMethodService` described above,
talking only to `WebViewBridge`.

**`store.tsx`** (edited) — installs `window.__vaultFill` only while
`phase === 'unlocked'`, mirroring exactly how `onLockRequested` and
`onOauthCallback` already register while the app is alive:

```tsx
useEffect(() => {
  if (!platform.isAndroid || phase !== 'unlocked') return;

  window.__vaultFill = {
    listEntries: () =>
      (vaultRef.current?.listEntries() ?? []).map((entry) => ({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        fields: entry.fields,
      })),
    readField: (id, key) => vaultRef.current?.readField(id, key) ?? null,
  };

  return () => { delete window.__vaultFill; };
}, [platform.isAndroid, phase]);
```

(Updated for entry type expansion — see that section below. `fields` is the
same `EntryField[]` `VaultEntry` already carries; a sensitive field's value
is `''` here exactly like it is everywhere else on the list model.)

This is what makes "fails closed if not unlocked" true on Android, the same
way it falls out for free on Windows: nothing installs the bridge function
unless the vault is actually unlocked, so `evaluateJavascript` calling a
`window.__vaultFill` that doesn't exist just gets back JS
`undefined` — which Android's WebView reports to the callback as the
string `"null"` — and `WebViewBridge` treats that identically to "the app
isn't even running." One code path handles every "can't fill right now"
reason.

Sensitive values are still fetched one at a time, only once a specific
field is actually picked — `readField` is never called as part of listing
entries, same principle as the Windows side and the copy-password button
before either of them.

### CSP

The app's CSP (`script-src 'self' 'wasm-unsafe-eval'`, `capabilities/`
default) does not apply here. `evaluateJavascript` is native-layer script
injection — closer to typing into DevTools console than to the page
loading a `<script>` tag — and CSP's `script-src` only governs the latter.
This isn't guesswork: a university thesis on retrofitting CSP onto
Cordova/WebView apps studies this exact pattern (native code calling
`evaluateJavascript`/`loadUrl('javascript:...')` against a CSP-protected
WebView) and confirms it explicitly — native-to-WebView injection sits
outside the page's own CSP enforcement, by design, which is exactly why
that thesis's whole premise is that CSP alone can't stop a *malicious*
native layer from doing this. Not device-verified — nothing on this
platform could be, see the checklist below — but backed by more than
assumption.

### Picker UI: search and the on-screen keyboard

`VaultIme`'s view is dark-themed (a top bar, a scrollable results region,
the search box and the on-screen keyboard below), built to roughly match a
mockup the user supplied rather than default widget styling — see the
file's own comments for the exact colors and spacing.

**One height for every screen.** Everything above the system's bottom inset
is `BODY_HEIGHT_DP` (492dp) tall on every screen — search, entry detail,
create, locked and loading — so the host app never re-lays out its page as
the user moves between them. The results region takes whatever each screen
leaves (layout weight 1): about 196dp on search (a section label plus three
rows), more on detail and create, where the keypad hides. Below the body, a
spacer keeps room for the system's own navigation controls
(`withBottomInset`): the navigation-bar inset
(`WindowInsets.Type.navigationBars()`), but never less than
`BOTTOM_CLEARANCE_DP` (48dp). The floor matters with gesture navigation.
The reported inset there is only ~16–24dp, but while a keyboard is up
Android draws its hide-keyboard and switch-keyboard buttons in a 48dp
strip, which then overlapped the keypad's bottom row. The spacer adds
height under the body rather than taking it from the body, so the whole
keyboard is taller by that amount and its content sits higher; nothing
inside changes size. A same-app reopen keeps showing the previous view until the entries
arrive instead of flashing a loading view; a first show or a show in a
different app shows a full-height "Loading…".

**Top bar.** A "Lock" pill (padlock plus label), **"Filling into
Netflix"** centered (the calling app's name — it confirms the target before
any fill and says what "Recent"/"Suggested" are relative to; the
home-screen wordmark, `ic_home_logo.xml`, when the name isn't known), and a
"Clear" pill. Both pills
are 40dp gradient pills matching the main app's home-header buttons, with
2dp of the 44dp bar showing above and below each — 40dp is the IME's own
touch-target floor, an IME-only exception to the app's 44px (see
`ime-ux-redesign-proposal.md`'s "Touch targets"). Clear reads the field's
whole text before wiping it and turns into **Undo** for 5 seconds; Undo
types the text back (held in memory only, dropped on timeout, focus change
or dismiss — see `SECURITY.md`). There is no handle/grip bar between the
results region and the search box (one was removed — it looked draggable
and did nothing).

**Locked.** The same top bar with only the wordmark, then "Vault is locked.
Unlock it to fill passwords.", a primary **Unlock Vault**, and a secondary
**Use other keyboard** so a locked vault never leaves the user stuck.

**Result rows.** Each row is about 52dp: the entry's icon (next section),
its title, and a one-line subtitle — a port of `EntryList.tsx`'s
`rowSubtitle` (a Login's username, else its email; any other type's first
non-sensitive single-line value, skipping date fields, which arrive as bare
fill digits). A Login with a username or email *and* a password also gets a
one-tap **Fill** chip: it fills the password if a password field is
focused, otherwise the username (or email), whose "Fill, then Tab" then
fills the password. What an empty query shows, and "No matches", are in
`QUICK-FILL-RANKING-DESIGN.md`.

**Search box and keypad.** The search box is a 40dp field in a 52dp row,
with a ✕ that clears the whole query. Keys are 40dp tall (the IME's floor)
with 6dp between rows. Backspace deletes on press and repeats while held
(after 400ms, every 60ms). The 123 layer has a symbol row, `@ . - _ / & '`,
under the digits, so an email, "t-mobile" or "at&t" can be searched. The
keypad's last row is a **globe** key (switch to the next keyboard; hold for
the system picker; hidden when the system already shows its own switch
button, per `shouldOfferSwitchingToNextInputMethod`), "space", and a
**+** key that starts a new entry, with a faint coral tint that hints at
the coral create panel (`IME-CONTROLS-REFINEMENT-PLAN.md` "The + key"; no
key is strongly coloured). Globe, backspace and + are vector glyphs, not text characters, and
every key has a spoken label.

**Entry detail.** The header shows the entry's icon, title, and "Login ·
paul@example.com" (type plus the row subtitle); it isn't a back control —
the keypad's **Back to results** is (it keeps the query). The fields sit in
one rounded card, like the app's entry detail. Fields you'd actually fill
come first — for a Login, username, email, password — and the URL, Notes
and any multi-line field sit behind **More fields (N)**, the card's last row
(`splitDetailFields`). Row layout is below ("Detail-view field rows") and
in `IME-DETAIL-CREATE-VISUAL-PASS.md`.

### Result-row icons

Each search/recents row shows the same icon the app's own entry list
(`EntrySiteIcon`, `EntryList.tsx`) shows for that entry: a Login's site
favicon when one is available, otherwise the neutral plate carrying the
entry type's glyph — the globe for a Login, `ic_type_*.xml` (a 1:1
transcription of `entryTypeIcons.tsx`'s set) for every other type
(`VaultKeyboardView.buildAvatar`).

The IME still never touches the network. Favicons come over the bridge:
`window.__vaultFill.readIcon(id)` (`store.tsx`) looks up the entry's URL and
answers from a per-unlock cache filled by `platform.fetchFavicon` — the same
direct-from-the-site, Rust-cached path the entry list uses, so no new
fetching behavior exists. It answers `ready` (base64 bytes), `pending`
(fetch in flight), or `none` (not a Login, no URL, site icons off in
Settings, fetch failed, no icon). Design points:

- **Asked per row, not bundled into `listEntries`.** `listEntries` is
  re-polled every two seconds while the picker is open; resending every
  icon's bytes on each poll would dwarf the list itself. Kotlin keeps
  decoded bitmaps keyed by entry id + URL, cleared when the view goes
  LOCKED.
- **No retry loop.** A `pending` answer is simply re-asked on the next
  auto-refresh re-render; a `ready` one is swapped into the row in place if
  it's still on screen.
- **Pre-warmed at unlock.** When the bridge is installed (the page is in the
  foreground then), it starts `fetchFavicon` for every Login with a URL.
  `readIcon` can be called while the page is fully backgrounded, and whether
  an IPC round trip started from that state ever resolves isn't something to
  depend on; the on-demand path only covers entries added after unlock.
- **`readIcon` doesn't count as activity** (`enforceAutoLockOnBridgeCall(false)`,
  same as `listEntries`) — the IME calls it on its own while rendering.
- **What can't show.** Anything `BitmapFactory` can't decode (SVG favicons)
  settles to the plate, like `EntrySiteIcon`'s `onError`. Plate and favicon
  share one shape — a 32dp rounded square with a 7dp radius, the app's
  Android peg scaled down — so the two read as one component; the favicon
  has no plate behind it. Turning site icons off in Settings stops new icons immediately, but
  bitmaps the keyboard already decoded stay until the next lock.

### Per-app sessions, type labels, focused-field tracking, screen capture

- **Search sessions are per calling app.** Reopening the keyboard in the
  same app resumes the query, open entry and scroll position; opening it in
  a different app starts an empty search. An in-progress account-creation
  draft survives either way. See `QUICK-FILL-RANKING-DESIGN.md`'s "Session
  persistence".
- **Type labels come over the bridge.** `listEntries` sends each entry's
  `typeLabel` (the registry's display name, "Secure Note") next to `type`
  (the id, "secureNote"); the detail header shows the label. The registry
  lives only on the JS side, so Kotlin never derives a label from the id.
- **The keyboard knows whether the focused field is a password field.**
  `VaultIme.onStartInput` passes every focus change's `EditorInfo` to
  `VaultKeyboardView.onEditorInfoChanged`, which records
  `focusedFieldIsPassword` (via `isPasswordInputType`) before handling the
  post-Tab password check. The account-creation panel uses it to decide
  what it may type into the page — see `ACCOUNT-CREATION-DESIGN.md`'s
  "Revision: writing into the page safely, and confirming a discard".
- **The keyboard window is `FLAG_SECURE`** — see `SECURITY.md`'s "Screen
  capture on Android".

Search is local-only: it filters the same entry list `WebViewBridge.
listEntries` already fetched on show, by title or any non-sensitive,
non-multiline field value (see "Entry type expansion" below — originally
title/username substring only), no extra bridge round trip per keystroke.
It's typed via a small on-screen
keyboard `VaultIme` draws itself (letters, a "123"/"ABC" toggle for
digits, space, backspace) rather than a real `EditText` — Android has no
notion of "the keyboard for typing into my own keyboard's UI": a second
IME can't be summoned while this one is already the active input method,
so a real text field here would just sit unresponsive to taps. This was a
deliberate, discussed trade-off, not an oversight.

### Open Vault to unlock, from the locked-state link

When `WebViewBridge` has nothing to offer — Vault isn't running,
or it is but the vault's locked — the picker's message becomes a tappable
"Unlock Vault" link. Tapping it starts `MainActivity` with
an `EXTRA_LAUNCHED_FROM_FILL` intent extra, and once the vault unlocks,
`MainActivity` backgrounds itself (`moveTaskToBack(true)`) so the user
lands back in whatever app they were filling into — the same as if they'd
switched apps by hand, minus the switching.

This is scoped tightly to that one entry point: ordinary launches (the
launcher icon, the OAuth redirect) never set the extra, so they never
auto-background. `MainActivity` is `launchMode="singleTask"`, so a
relaunch while it's already running arrives via `onNewIntent`, not
`onCreate` — both are wired to the same handler.

There's deliberately no channel from the webview announcing "the vault
just unlocked" — that would mean the page calling into native code, which
nothing in this design does (see `WebViewBridge`'s own doc). Instead
`MainActivity` polls the
same `listEntries` question `VaultIme` already asks, every 500ms,
until it gets a non-empty answer or 3 minutes pass (in case the user
wanders off instead of unlocking, so this doesn't poll forever in the
background).

#### Launch flag for the web side

The web page needs to know an unlock came from this link, so it can skip the
unlock reveal animation (`vault-visual-language-spec.md` §5.1) — the app is
about to background itself, so the reveal would play to nobody. Implemented
in `MainActivity.kt` (`setFillLaunchFlag`) and `store.tsx`
(`consumeFillLaunch`, `playUnlockReveal`):

- **Set:** on every unlock poll, `MainActivity` also evaluates
  `window.__vaultLaunchContext = 'fill'` in the webview. Repeating it each
  poll covers a cold start, where the page isn't loaded yet when the intent
  arrives. A fingerprint unlock completed within the first poll interval
  could miss it; the only consequence is the reveal playing in the
  background, so that's accepted.
- **Consume:** `store.tsx` reads the flag at the moment of a successful
  unlock (password or biometric) and deletes it — one flag, one unlock.
  Once the poll then sees the vault unlocked, `MainActivity` deletes it
  again (that same poll had re-set it) before backgrounding.
- **Clear:** a launch *without* the extra (launcher icon, OAuth redirect)
  cancels any pending unlock wait and deletes the flag, and so does the
  3-minute poll timeout. Otherwise "open from the IME, walk away, later open
  normally and unlock" would wrongly skip the reveal — and, before the
  cancel existed, the still-running poll would also have hidden the app
  after that later, unrelated unlock.

This is the one place native code pushes a value into the page rather than
asking it a question. It's deliberately harmless: the flag can only suppress
an animation, never unlock, read or change anything, so a spoofed value has
nothing to gain. Keep it that way — nothing security-relevant may ever key
off `__vaultLaunchContext`.

### Entry type expansion: field-driven fill buttons

Originally every row had exactly two fill buttons, hardcoded: Username and
Password. Once `entry-type-expansion-spec.md` landed on the app side (a
`VaultEntry` is now `{ id, type, title, fields: EntryField[] }`, not a fixed
five-field shape — see the project's conflict-analysis doc), fill grew one
target per fillable field instead, labelled with the field's own label: a
Login still gets Username/Password, but a Card gets Number/Expiry/CVV/Name
on card, a WiFi entry gets SSID/Password, and so on.

A later revision moved those targets off the search-result row entirely —
selecting a result now opens that entry's own detail view (mirroring
`EntryDetail` on the app side), and *that* is where each field's Fill (and,
for a sensitive field, Show/Hide) lives, one row per field. The reasoning:
once a type can have four-plus fields, a per-row strip of fill buttons
stops being "one extra, obvious tap" and starts being a horizontally
scrolling row of small targets — the same problem a detail view with one
field per line doesn't have. Search now answers "which entry", detail
answers "which field", where before both questions were being asked in one
row.

Two decisions worth recording here rather than only in the code:

- **Field order isn't decided by the IME.** `Vault.listEntries()` already
  builds each entry's `fields` array in the right order — template fields
  in registry order, then custom fields in add-order — so `VaultIme`
  just renders what it's given; there's no second ordering rule to keep in
  sync with `entryTypes.ts`.
- **A row stays a fixed height by scrolling, not wrapping.** `ROW_HEIGHT_DP`
  is a hard constant the rest of the layout (the scrollable list's total
  height, in particular) depends on. Rather than let a four-field row grow
  taller than a two-field one, the fill-button strip sits in a
  `HorizontalScrollView` — a Card's four buttons take the same vertical
  space as a Login's two, just scrolled instead of stacked.

**Detail-view field rows — current layout and fill feedback** (later
revisions, on top of the two decisions above; spec in
`IME-DETAIL-CREATE-VISUAL-PASS.md`). Each `buildDetailFieldRow` is a card
row at least 60dp tall: an 11sp upper-case label and the value (16sp
medium; monospace for a sensitive value, "••••••••" until shown; "Not set"
when empty) on the left, and on the right the eye (show/hide, sensitive
fields only) and a fixed-width **Fill** pill (`detailFillButton`, 84dp), so
every row's Fill lines up in one column. A revealed value's label adds
"· hides in Ns". Card Number and Expiry add a two-way **mode switch**
under their Fill, right-aligned with it (`IME-CONTROLS-REFINEMENT-PLAN.md` item 2). It
changes what Fill types, so it looks like a setting (an outline with the
chosen half lightly filled), not like Fill:
- Card Number, **Whole · 4 parts**: Whole types all 16 digits; in 4 parts,
  each tap types the next 4-digit group and Fill reads "Fill 1/4" …
  "Fill 4/4".
- Expiry, **MM/YY · YY/MM**: the order Fill types the digits in.

An empty value has no Fill and no switch.

Tapping Fill disables it and flashes it green "Filled!" with a check glyph,
keeping its pill shape (`markFilled`); the value commits after `FILL_FEEDBACK_DELAY_MS`, then
the results area re-renders. `markFilled` also reverts its own chip after
`FILLED_REVERT_MS` (1.5s), so no ordinary Fill path leaves a chip stuck
disabled. The one row that needed more than that — Card Number's terminal
"Filled", which sits on a rebuilt button `markFilled` never touches — is
covered in `docs/ime-layout-v2-and-grab-design.md`'s "Card Number's
chunked-fill treatment".

This is a *scoped* increment, not the full `quick-fill-search-improvements.
md` design — no tap-to-expand chip row, no sticky single-expanded-entry
state, no chunked fields (a card number split into four tap targets) or
long-press format variants, no frecency ranking, and no session persistence
across picker opens. Those are still open — see the project's
conflict-analysis doc's "What's still open" list. What changed here is
narrower and self-contained: every field on every type is now individually
fillable, which it wasn't before.

(Auto-lock-extension during a multi-field fill *was* on that deferred list
at this point — it's since been built, as a side effect of fixing an
auto-lock bug rather than as its own feature. See "Bug found after
shipping" at the end of this document.)

`WebViewBridge.readField(entryId, key, callback)` replaced
`readPassword(entryId, callback)` — see the "The bridge" section above —
generalising the same fetch-on-demand principle to any sensitive field, not
just the one Login always had.

### Verification checklist

Nothing in this section was compiled, let alone run. Unlike the Windows
half — where at least the non-`cfg(windows)` code got real `cargo
check`/`clippy`/`test` runs — this sandbox has no Kotlin compiler and no
Android SDK at all, and there is no `gen/android` project here to build
against in the first place (it's gitignored and only exists on the real
machine). The one part of this change that lives outside `gen/android` —
`store.tsx`'s `window.__vaultFill` effect — did get the full
`npm run typecheck`/`lint`/`test`/`build` pass, clean.

For the Kotlin: every new API used (`WryActivity.onWebViewCreate`,
`WeakReference`, `WebView.evaluateJavascript`/`.post`, `org.json.JSONTokener`,
`InputMethodService.onCreateInputView`/`onStartInputView`/
`currentInputConnection`/`switchToPreviousInputMethod`,
`InputMethodManager.showInputMethodPicker`, `Activity.moveTaskToBack`,
`Handler.postDelayed`/`removeCallbacksAndMessages`) was checked against
Android's own reference docs for its exact signature and, where relevant,
its minimum API level, rather than written from memory. Braces and parens
in every new/edited file were also machine-counted as a balance sanity
check (a compiler substitute, not a compiler). That's real diligence, but
it is not the same as a build. The first Android Studio build on the real
project — and, separately, actually enabling the keyboard on a device and
trying it, including the search/keyboard UI and the open-to-unlock flow —
is where anything wrong here would actually surface. Do both before
relying on this.

## Risk and what's actually novel here

Windows: one new command, ordinary Win32 APIs (`SendInput`,
`GetForegroundWindow`) with decades of prior art (this is what KeePass's
Auto-Type has done since the mid-2000s). Real risk was always UX tuning —
the delay between restoring focus and typing, whether some target apps
reject synthetic input — not architecture risk.

Android: the bridge itself turned out to be the easy part, once
`WryActivity.onWebViewCreate` was confirmed reachable — see "The bridge: no
JNI needed" above. What a Linux sandbox genuinely cannot de-risk is
everything downstream of that: `InputMethodService` lifecycle quirks across
OEM skins, Samsung-Keyboard-style "some manufacturers restrict third-party
IME behavior" edge cases, and the CSP question (addressed above with real
evidence, but still not device-tested). Those are device-only unknowns no
amount of reading generated files resolves.

## Phasing

Both halves are now built. What's left is what the "Verification checklist"
sections on both call for: a real Windows build, and a real Android Studio
build followed by actually enabling and trying the keyboard on a device —
neither of which this environment can do.

## Source tracking

`src-tauri/gen/android/` is gitignored and regenerated from scratch by
`tauri android init` (CI does this on every run). Every hand-authored or
hand-edited Android file therefore lives in tracked `src-tauri/android-ime/`
and `npm run android:sync-ime` (`scripts/sync-android-ime.js`) copies it into
`gen/android`:

- every `.kt` file — the IME, `WebViewBridge`, the quick-fill ranking, the
  preview activity, and `MainActivity.kt` (which replaces the generated stub);
- the drawables and `res/xml/method.xml`;
- the launcher icon, every `res/mipmap-*` density plus the adaptive-icon
  XML — `android init` writes Tauri's default logo there otherwise;
- `res/values/colors.xml` and both `res/values{,-night}/themes.xml` (the
  `home_background` window/system-bar color `MainActivity` depends on);
- the IME service and preview-activity manifest blocks
  (`manifest-fragments.xml`, inserted idempotently);
- the Google Drive OAuth redirect `intent-filter` on `MainActivity`, generated
  from `VITE_GOOGLE_CLIENT_ID_ANDROID` rather than copied, since its scheme is
  each developer's own client ID — see `docs/google-oauth-setup.md`.

If you hand-edit any other file under `gen/android/`, move it into
`src-tauri/android-ime/` and add it to the sync script in the same change —
otherwise the next `android init` silently reverts it.

## What changed from the first draft

The first version gave Windows its own borderless picker window and routed
it through a `fill_bridge` mechanism scoped for both platforms. That solved
a problem Windows doesn't actually have: the hotkey handler and the vault
are already in the same process, so there was never anything to hand off
to. Cutting the second window removed an entire subsystem — window creation
and teardown, `#/picker` routing in `App.tsx`, a picker-specific command
layer.

The Android side also had a decision presented as settled in that first
draft — hand-written JNI — that was really a decision made under missing
information, not a considered best option. The second draft gated it
explicitly on reading two files the session couldn't reach yet; once they
were readable, the answer turned out to be the better one: `WryActivity`
already exposes a public `onWebViewCreate` override built for exactly this,
so the JNI path, and the entire `fill_bridge.rs`
event/command/`oneshot`-channel mechanism built to support it, were never
needed at all. What shipped is two new Kotlin files and one new override in
a third, talking to the webview through the same `evaluateJavascript` API
any Cordova-style native bridge uses.

A second pass cut the tray icon entirely. The draft before this one assumed
the process needed to survive the window being *closed*, and built a tray
icon plus a hijacked `CloseRequested` handler to arrange that. But
minimizing the window already keeps the process running, with no code
changes at all — the only thing that was ever making the process exit was
the X button. Requiring "minimized, not closed" instead of "closed is fine
too" costs one sentence of UI copy and removes a tray icon, a window-event
override, and a Settings toggle that all existed to solve a problem that
didn't need solving.

## Bug found after shipping: the vault never actually locked for an IME-only session

Reported as "if I dismiss the IME and open it after a while, it's still
unlocked (even after the auto-unlock period)."

**Root cause.** Auto-lock enforcement lived in exactly two places in
`store.tsx`, and both structurally depend on this app's own page: a
1-second `setInterval` that checks elapsed idle time (throttled or
suspended outright while the page is backgrounded — ordinary Android
behavior for a hidden WebView's JS timers, not a bug in either), and a
`visibilitychange` listener that re-checks the same elapsed time, but only
the instant the page becomes visible again, i.e. only when `MainActivity`
itself is foregrounded. Neither one is ever reached by a session where the
user unlocks the vault once and then only ever interacts with it through
the IME — opening the keyboard, filling a field, dismissing it, again
later — without ever bringing the main app back to the foreground.
`window.__vaultFill` and `window.__vaultCreate` themselves had
no idle check of their own; they just answered directly from whatever
`vaultRef.current`/`phase` still held, however stale. So the vault stayed
reported as unlocked indefinitely for that usage pattern, no matter how
long the true idle gap was — not because the timeout was computed wrong,
but because nothing was ever checking it.

**The fix.** `VaultIme.kt` calls every bridge function through
`WebViewBridge.kt`'s `evaluateJavascript`, which — unlike `setInterval`/
`visibilitychange` — runs synchronously on demand regardless of whether the
page is hidden. That makes each bridge call the one reliable point left to
enforce the same idle timeout. `store.tsx` now has a single
`enforceAutoLockOnBridgeCall` callback that every function on
`window.__vaultFill` and `window.__vaultCreate` calls first — except
`__vaultFill.lock` itself, a bare pass-through to `lock()` with no
pre-check, since locking needs no auto-lock decision of its own — if
the configured `autoLockMinutes` has already elapsed since the last
recorded activity, it calls `lock()` (which, as it already did for every
other lock trigger, finalizes any in-progress account-creation draft before
clearing the vault) and the calling function returns its "nothing to give
you" value (`[]`, `null`, or `false` as appropriate) instead of touching
`vaultRef.current`; otherwise, by default, it calls `noteActivity()`, so
the call itself counts as activity — the same "returning within the grace
period resets the clock" rule the `visibilitychange` handler already
applied to foregrounding, now covering IME-driven activity too.

`listEntries` and `readIcon` are the two functions that opt out of that
second half, via `enforceAutoLockOnBridgeCall(false)` (`readIcon` because the
IME calls it on its own while rendering rows — see "Result-row icons"; the
rest of this paragraph is about `listEntries`) — each still enforces the lock, just
doesn't extend the session on the non-expired path. The reason is
`VaultKeyboardView.kt`'s `autoRefreshRunnable`, which already
re-calls `listEntries` every two seconds for as long as the picker is on
screen — precisely so a relock elsewhere gets noticed and rendered promptly
(see that function's own doc comment, pre-dating this fix). Counting that
poll as activity would have meant simply leaving the keyboard open, doing
nothing at all, kept the vault unlocked forever — the same bug this fix
exists to close, just relocated rather than actually fixed. `listEntries`
is also how the picker's first, genuine open reaches the bridge, and from
inside `store.tsx` that call is indistinguishable from a later poll — the
distinction only exists on the Kotlin side, which this fix doesn't touch —
so treating none of them as activity is the conservative reading. Every
other bridge function (`readField`, and everything on
`window.__vaultCreate`) is unambiguously a deliberate action and
keeps the default.

That default is also what finished the "no auto-lock-extension during a
multi-field fill" item this document used to list as deferred (see "What
changed from the first draft" above) — filling several fields back-to-back
through the picker now keeps resetting the idle clock exactly like
interacting with the main app would, as a direct consequence of this fix
rather than as separate work.

No new automated test covers this directly — `store.tsx` is a React
context/provider and this project has no component-test harness (every
existing test in `tests/` exercises pure functions or `Vault` directly), so
verification here is `npm run typecheck`/`lint`/`test`/`build`, all clean,
plus the reasoning above. The Android half — like the rest of this
document's Android section — has not been compiled or run on a device in
this sandbox.

## Fill, then Tab: auto-advance and password follow-up

Requested directly: fill a field from the picker, and the picker should
advance the target form itself — Tab to the next field — rather than
leaving the user to tab there by hand. And if that next field turns out to
be a password field and the entry being filled has one, fill that too,
without a second Fill tap.

Windows does the Tab half on every ordinary fill. Android skips it after a
password or after the entry's last field (see "Android" below); otherwise
an ordinary fill (never a draft-pick fill on Android) is immediately
followed by a single Tab key press into the same target field the value was
just typed into. Whether the second half — the password follow-up — actually happens,
and how it's decided, is where the two platforms genuinely diverge, because
of a capability gap between them that was a real decision point, not an
oversight:

- **Android knows.** An `InputMethodService` is told the newly-focused
  field's real `EditorInfo` — including `inputType`, which says outright
  whether a field is a password variant — every time focus moves within the
  app it's attached to. So Android's version is an actual check: Tab, wait
  for the next `EditorInfo`, look at it, fill the password only if it
  really is one.
- **Windows doesn't.** Nothing in this app talks to Windows' accessibility
  layer (UI Automation) — `SendInput`-based keystroke synthesis, this
  feature's whole mechanism since the top of this document, has no way to
  ask "what control has focus now, and is it a password box." Adding that
  would mean a materially larger native capability (reading UI element
  properties system-wide, in whatever process happens to have focus) for
  one heuristic improvement, which was weighed and declined — see the
  option that was **not** taken, below. So Windows' version is a guess: Tab,
  then fill the password unconditionally whenever the entry has one,
  betting on the near-universal Username → Tab → Password form shape.
  Wrong often enough to matter would mean a password lands in the wrong
  visible field on an unusual form — accepted as the cost of not taking on
  UI Automation for this.

### Windows

`type_text`'s own `SendInput`/`KEYEVENTF_UNICODE` path (see "Windows" above)
delivers literal characters, which is exactly wrong for Tab — a real
`VK_TAB` virtual-key press is what a target's own keyboard-navigation
handling actually listens for. So this is a second, minimal native command,
`press_tab`, alongside `type_text` rather than folded into it: same
`capture_foreground_target`-restore-then-settle dance
(`autotype::restore_foreground`, the same 80ms settle sleep), a new
`send_virtual_key(VK_TAB)` helper next to the existing
`send_unicode_unit`/`keybd_input` ones. Exposed to the renderer as
`platform.pressTab()`, a `Promise<void>` with no payload, next to
`typeText` on the `Platform` interface — `PickEntryDetail.tsx` never calls
it directly; `VaultScreen.tsx`'s `tabThenMaybeFillPassword` is the only
caller, run right after `fillField`'s own `typeText` succeeds:

1. `platform.pressTab()` — always, unconditionally.
2. Look for a fillable field on the entry with `key === 'password'` (the
   same convention `vault.ts` already uses to special-case Login's
   password, not a new concept). None → done.
3. Found one → read its value (`readField` for a sensitive field, same as
   any other fill) and, if non-empty, `platform.typeText(password)` — the
   exact same primitive an explicit Password-row Fill tap already uses, so
   there is nothing new here from the target app's perspective.

The whole thing is wrapped in its own `try`/`catch` that swallows errors
quietly, deliberately separate from `fillField`'s own error handling: by
the time `tabThenMaybeFillPassword` runs, the field the user actually asked
to fill has already succeeded, so a Tab or follow-up-type failure (the
target window closed in the gap, focus not restorable) shouldn't leave the
picker sitting open over a fill that, from the user's perspective, already
worked — it just quietly skips the bonus step. `fillField` still only
minimizes the window on the *primary* fill's success, unchanged from
before this feature.

**The option not taken: real detection via Windows UI Automation.** UI
Automation's `LegacyIAccessible` bridge (or, for a native Win32 edit
control specifically, just reading its `ES_PASSWORD` style bit) can tell a
caller whether the currently focused element really is a password field —
this is genuinely how the Android half of this same feature works, and how
a "proper" Windows implementation would too. It was weighed against the
heuristic above and declined for this pass: it's a new COM interface this
app has never touched, a permission surface substantially bigger than
"synthesize keystrokes into the window that already had focus" (reading
arbitrary UI element properties from whatever process happens to be
focused, system-wide), and — like every other Windows-native piece of this
document — unverifiable in this sandbox, which has no Windows machine to
try it on. The heuristic was accepted instead, explicitly, as the smaller
and immediately shippable option; revisiting this is exactly the kind of
thing that would need a real Windows testing pass to justify, not another
blind implementation.

### Android

The Tab side needed one new capability `VaultIme.kt` didn't have:
sending a real key event into `currentInputConnection`, the same way a
hardware keyboard would. `sendTabKeyEvent()` does exactly that —
`KEYCODE_TAB` down then up via `InputConnection.sendKeyEvent` — wired
through `VaultKeyboardView`'s existing callback-injection pattern as
a new `onSendTab` constructor parameter, same shape as `onCommitText`/
`onClearField` above it.

The password-detection side needed a second new capability: learning the
*newly*-focused field's `EditorInfo` without the picker's own view being
torn down and rebuilt. `onStartInputView` — the callback this class already
overrode — does not fire again for a plain focus change to a different
field in the same app while the keyboard stays visible; only a real,
separate `InputMethodService` callback, `onStartInput(EditorInfo,
Boolean)`, fires for that. `VaultIme` now overrides it too, forwarding
every call straight to a new `VaultKeyboardView.onEditorInfoChanged`
— a no-op there whenever nothing is currently waiting on one.

`VaultKeyboardView`'s side of the mechanism, all in `finishFill`'s
ordinary-fill branch (never the draft-pick branch — tabbing away from
whatever field the account-creation flow is actively targeting there would
be surprising, not helpful, so that flow is deliberately untouched):

1. `armPostFillTabAndPasswordCheck(entry, field)` does nothing when the
   field just filled was a password (the focused field is a password field,
   or `field.key == "password"`) or was the entry's last field in the
   detail view's display order — the next thing is usually the form's
   submit button, and Tab would move focus somewhere unrelated ("Remember
   me", "Forgot password?"). Otherwise it calls `onSendTab()`, then — only
   if this entry has a fillable field keyed `"password"` — arms
   `pendingPostFillPasswordEntry = entry` and schedules
   `clearPendingPostFillPasswordRunnable` (`POST_FILL_TAB_TIMEOUT_MS`,
   1.5s) as a backstop in case the signal below never arrives. It runs for
   a fill from the detail view and from a result row's one-tap Fill alike.
2. The *next* `onEditorInfoChanged(info)` call consumes that arming
   unconditionally (whether or not `info` turns out to be a password field
   — an unrelated later focus change must never wrongly retrigger this),
   and, only if `isPasswordInputType(info)` says yes, reads and commits
   this entry's password exactly like an explicit Fill tap would — and, if
   that entry's detail view is showing, flashes the Password row's Fill chip
   "Filled!" (`autoFilledFieldKey`) so the second fill doesn't go unnoticed.
3. `isPasswordInputType` checks `EditorInfo.inputType` against both the
   text-class password variations (`TYPE_TEXT_VARIATION_PASSWORD`,
   `_WEB_PASSWORD`, `_VISIBLE_PASSWORD` — a field shown unmasked by choice
   is still the password field) and the number-class one
   (`TYPE_NUMBER_VARIATION_PASSWORD`, for a PIN-style password field).

`pendingPostFillPasswordEntry` is also reset in `stop()` (the picker being
dismissed) — `uiHandler.removeCallbacksAndMessages(null)` there already
cancels the pending timeout Runnable, but doesn't reset the field it
guards, so that line does it directly. `VaultImePreviewActivity.kt`
got the matching `onSendTab = { toast(...) }` addition its `EntrySource`
already requires from every other callback here.

**Known limitation, disclosed rather than solved:** `onEditorInfoChanged`
being called is the actual "focus moved" signal, but nothing here confirms
Tab is what caused it — a coincidental, unrelated focus change inside the
1.5-second arm window (rare, but not impossible) could in principle trigger
a password fill that wasn't really wanted at that moment. Narrower than it
sounds in practice: it needs a focus change *and* that new field to
specifically be password-typed *and* to land inside a 1.5-second window
that only opens right after the user tapped Fill. Judged not worth chasing
further for this pass — the same "clear field" affordance this keyboard
already has undoes a wrong fill either way.

### Verification

JS/TS side (Windows): `npm run typecheck`, `npm run lint`, `npm run test`
(156 tests, unchanged — nothing here is unit-testable pure logic, so no new
test was added), `npm run build` all pass clean. Rust side (Windows):
`cargo check`, `cargo clippy --all-targets` (two pre-existing warnings in
`favicon.rs`, unrelated to this change, no new ones), and `cargo test` (8
tests, unchanged) all pass clean — this sandbox does have a Rust toolchain,
so the non-`cfg(windows)` structure (command registration, the Linux
fallback stubs, the permission/ACL schemas regenerated by `build.rs`'s
`tauri_plugin::Builder`) is real, compiler-verified coverage; the actual
`cfg(target_os = "windows")` `SendInput`/`VK_TAB` code is not compiled here
and has not run on a device. Kotlin side (Android): no compiler or Android
SDK in this sandbox, as with every other Kotlin change in this document —
verified by reading every changed/new API
(`InputConnection.sendKeyEvent`, `KeyEvent`'s 5-arg constructor,
`InputMethodService.onStartInput`, every `InputType` constant used) against
Android's own reference docs, and by machine-counting braces/parens/
brackets across all three changed Kotlin files as a balance sanity check (a
compiler substitute, not a compiler). A real build and an on-device try —
across a form with a genuine Username → Password shape and something
unusual, on both platforms — is still the actual verification step.

## Filling a masked field: `monthYear`/`date` fields type bare digits

**Bug report:** filling a Card's Expiry (or any `dataType: 'date'` field)
into a real website's expiry/date input came out wrong on fields that
auto-insert their own separator as the user types (the near-universal
pattern for a card-expiry `MM/YY` input) — the field ended up as
concatenated digits with no `/` at all, not the intended `MM/YY`.

**Root cause, two layers:**

1. **A real, separate bug.** `monthYear`/`date` storage is ISO
   (`YYYY-MM` / `YYYY-MM-DD` — see `card-expiry-derived-date.md` and
   `dateFormat.ts`'s own doc comment), displayed as `MM/YY` /
   `DD/MM/YYYY`. `VaultScreen.fillField` (Windows) and the
   `window.__vaultFill` bridge (Android) were both typing
   `field.value` straight through — the *raw stored ISO string*, dashes
   and all, never the display form. This was already wrong regardless of
   any masking on the target field. On the desktop side this was invisible
   because `FieldRow`'s own display branch (`monthYearIsoToDisplay`/
   `isoToDisplay`) already converts correctly for *showing* the value — only
   the *fill* path skipped that conversion. Android has no such display
   conversion at all: `VaultKeyboardView`'s field rows show
   `field.value` verbatim too, so this also meant the in-IME picker showed
   raw ISO (`2027-08`) instead of `08/27`.
2. **The masking collision itself.** Neither platform can read back what a
   target field currently holds — Windows has no accessibility API wired
   up (see the "Fill, then Tab" section above), and the Android IME's
   `InputConnection` is never queried for the field's current content
   either. So even typing the *correct* display string (`08/27`) character
   by character is typing blind: a target field that inserts its own `/`
   after two digits ends up with a doubled or misplaced separator, since
   Vault has no way to know one was just auto-inserted.

**Fix:** a target field masked this way virtually always formats from bare
digits, not from a string that already contains the separator — so
`fillFormat.ts`'s `toFillText(dataType, raw)` converts a `monthYear`/`date`
field's raw ISO value to its bare-digit form (`MMYY` /
`DDMMYYYY`, via the already-existing `isoToMonthYearDigits`/`isoToDigits`,
plus a new `monthYearIsoToFillDigits` that adds
`monthYearIsoToDisplay`'s legacy-free-text fallback) before it's typed. A
masked field formats the digits itself, correctly, with no collision. An
unmasked plain-text field just shows the bare digits with no separator —
visibly wrong, but a user notices and retypes it by hand; nowhere near as
bad as a silently corrupted value. Every other `dataType` passes through
`toFillText` unchanged.

Applied at both fill entry points: `VaultScreen.fillField` (Windows, plus
the sensitive-field `readField` branch — moot in practice, since a custom
field's `dataType` is constrained to `'text'` the moment it's marked
sensitive, and `monthYear` is never offered outside the Card template's own
built-in Expiry field, so a sensitive `monthYear`/`date` field cannot exist
today) and `window.__vaultFill.listEntries()` (Android — transforms
each non-sensitive field's `value` before it ever reaches
`VaultKeyboardView.kt`, which has no formatting logic of its own and
just commits whatever value it's handed). The Kotlin side needed no changes
at all — it was already correctly "dumb," just committing whatever value
the bridge handed it.

### Verification

`npm run typecheck`, `npm run lint`, `npm run test` (164 tests, up from 156
— new `tests/fillFormat.test.ts` plus a `monthYearIsoToFillDigits` suite
added to `tests/monthYearFormat.test.ts`), and `npm run build` all pass
clean. Pure TS logic (`fillFormat.ts`, the `monthYearFormat.ts` addition)
plus two small, compiler-checked call-site changes — no Kotlin or Rust
touched, so this is fully compiler-verified in this sandbox, same footprint
as `card-expiry-derived-date.md`. An on-device try against a real masked
card-expiry input is still the actual end-to-end verification step.

### Follow-up, after an on-device try: `commitText` is a bulk edit, not a keystroke

The on-device try above surfaced the real remaining problem: the digits
went in with no separator at all, on a field that does auto-format as the
user types. "The Kotlin side needed no changes at all" (just above) was
wrong — it needed exactly one.

`VaultKeyboardView.finishFill` was calling `onCommitText(text)` once
with the whole string — `commitText("0827", 1)` is a single
`InputConnection` edit that replaces the field's content in one shot. To a
target field's masking logic, that doesn't look like someone typing four
digits; it looks like one paste. Whatever's watching for "two digits typed,
insert a `/`" — a `TextWatcher` on a native `EditText`, an `input`
listener on a web `<input>` — fires once for the whole bulk change, not
once per digit, so it never gets the chance to react incrementally the way
it's built to.

**Fix:** `commitCharByChar(text, onDone)` (new) commits one character at a
time — a separate `commitText` call per digit, `CHAR_BY_CHAR_COMMIT_INTERVAL_MS`
(40ms) apart via `uiHandler.postDelayed`, each one now a genuinely distinct
edit the target's formatter sees on its own. `finishFill` picks this over
the single bulk `onCommitText(text)` call only when `dataType` is
`monthYear` or `date` — the two types `fillFormat.ts` already reduces to
bare digits (see above) specifically so there's no separator of ours to
collide with whatever the target inserts as each digit lands. Every other
field (passwords, usernames, notes, …) keeps the original one-shot commit
— there's no masking concern there, and committing 20+ characters one at a
time for no reason would just make an ordinary fill visibly slower.

The rest of what used to run immediately after `onCommitText` — the
draft-field write, or the ordinary-fill re-render and "Fill, then Tab"
chain (`armPostFillTabAndPasswordCheck`) — is now behind an `afterCommit`
lambda `finishFill` runs once the *last* character has actually landed,
not the first. Getting this ordering right matters specifically for "Fill,
then Tab": sending Tab before all four-to-eight digits have actually
committed would move focus out of the field mid-fill.

`field.dataType` needed to reach `finishFill` to make the choice — it was
already parsed onto `FillField` (`WebViewBridge.kt`, unrelated to this fix)
but `finishFill`'s own signature didn't carry it through; both call sites
in `performFill` (the sensitive and non-sensitive branches) now pass
`field.dataType` alongside the value they already had in hand. (Short-lived
— the very next section below drops the `dataType` gating entirely in
favor of a length cap, so this parameter didn't survive long.)

#### Verification

No compiler or Android SDK in this sandbox, same as every other Kotlin
change in this document — verified by reading `InputConnection.commitText`
and `Handler.postDelayed` against Android's own reference docs, and by
machine-counting braces/parens/brackets across the changed file as a
balance sanity check (a compiler substitute, not a compiler). An on-device
try against the same masked card-expiry field that surfaced this is the
actual verification step — this is a direct follow-up to one, not a
first try.

### Generalised to every field, capped by length

Liked the char-by-char fill enough on the Expiry field to ask for it
everywhere — "Is there any potential issue you foresee?" before doing it.
The honest answer had three parts, in order of how much they actually
mattered:

1. **Length.** A generated password can be up to 64 characters
   (`crypto/generator.ts`'s `MAX_LENGTH`); a Note or an SSH key body can run
   into the hundreds or thousands. At `CHAR_BY_CHAR_COMMIT_INTERVAL_MS`
   (40ms) per character, uncapped, a long password takes 2+ seconds and a
   long SSH key takes tens of seconds — reads as hung, not fast.
2. **Interruption mid-fill.** A longer commit sequence means more real time
   for something to interrupt it partway — the app backgrounding, the
   vault auto-locking, the picker being dismissed — potentially leaving a
   half-typed secret sitting in the field. Turned out to already be mostly
   covered: `stop()` already calls
   `uiHandler.removeCallbacksAndMessages(null)`, and `commitCharByChar`'s
   own chained `postDelayed` calls run on that same `uiHandler`, so any of
   those events already kills an in-flight sequence outright. Documented,
   not newly built.
3. **Per-keystroke overhead.** Each character is its own `InputConnection`
   IPC round-trip to the target app. Negligible for four digits; a longer
   field means more round-trips, and an app that runs logic on every input
   event (fraud-detection hooks are the obvious example) could visibly
   stutter, or in principle flag a perfectly uniform 40ms cadence as
   bot-like. Judged acceptable given the length cap below already keeps
   the round-trip count bounded.

Only the first was worth actually designing around — resolved by
`CHAR_BY_CHAR_MAX_LENGTH` (32): `finishFill`'s choice between
`commitCharByChar` and the original single `onCommitText(text)` call is now
`text.length <= CHAR_BY_CHAR_MAX_LENGTH`, not `dataType`. Comfortably above
any real password/username/CVV/expiry/date value, deliberately below the
generator's own 64-character ceiling — a generated password at the top of
that range is exactly the case the cap exists to fall back for. Notes and
SSH keys, effectively unbounded in length, always take the fast bulk path.
`commitCharByChar` no longer has any `monthYear`/`date` special-casing at
all — every field under the cap gets the same treatment, since the
underlying question ("does this look like real typing to whatever's
watching the target field") turned out not to be specific to dates.
`field.dataType` was dropped from `finishFill`'s signature again, since the
length check doesn't need it.

The one gap disclosed rather than solved: focus moving to a *different*
field without the picker itself stopping (`stop()` never runs) isn't
caught by the `uiHandler` cleanup above. Narrow in practice, and the same
kind of accepted edge case `armPostFillTabAndPasswordCheck`'s own doc
already discloses for an unrelated reason.

#### Verification

Same footprint and same caveat as the section above — no compiler or
Android SDK in this sandbox; verified by reading the changed APIs against
Android's own reference docs and by machine-counting braces/parens/
brackets across the changed file as a balance sanity check. An on-device
try — a long generated password, a short one, and a multi-line Note, on
top of the masked-expiry-field case both earlier sections already called
for — is still the actual verification step.

## Bug report: Vault's own keyboard showing over its own app's fields

Reported while creating an entry from inside the app itself: typing into
`EntryEditor`'s own fields (Title, a custom field, …) should always get the
device's normal keyboard — there is nothing in the vault's own UI to fill
*from* itself, so Vault's own fill-picker keyboard showing up there
is never correct.

`VaultIme.onStartInputView` already has exactly this self-detection:
`EditorInfo.packageName == packageName` (comparing the focused field's
owning app against Vault's own) bails out to
`switchToPreviousKeyboard()` before the fill picker is ever built or shown
— written specifically so the master password field (and, per its own
doc comment, "a plain text field" generically) never goes through this
IME's `commitText` path. That part of the mechanism was already correct
and needed no change.

What it called, though, `switchToPreviousInputMethod()`, was called
without checking its own return value. That method reports whether it
actually found a genuinely *different* previous input method to switch
to — and depends on the system's own IME-switch history, which is empty
in a perfectly ordinary case: someone enables Vault's keyboard in
Settings and starts using it right away, never having manually switched to
any other keyboard first on that device. When that call quietly returns
`false`, nothing happens — from the user's side, indistinguishable from
the self-detection never having fired at all. Vault's own keyboard
just stays up over its own fields either way.

**Fix:** `switchToPreviousKeyboard()` now checks that return value, and
falls back to a new `switchToAnyOtherEnabledKeyboard()` when it's `false`
— picks the first *other* enabled input method (any keyboard the user has
actually turned on, not specifically their system default) via
`InputMethodManager.getEnabledInputMethodList()`, and switches straight to
it with `switchInputMethod(id)` — the same permission-free mechanism the
currently active IME is always allowed to call on itself, just naming a
specific target instead of relying on history. `showInputMethodPicker()`
remains the last-resort fallback if somehow nothing else is enabled at
all.

This doesn't touch the pre-P (`Build.VERSION_CODES.P`) branch — API < 28
never had `switchToPreviousInputMethod()` to begin with, so it already
went straight to `showInputMethodPicker()`, which has no equivalent
"did this actually work" gap to close.

**Open question this doesn't resolve:** if the on-device symptom persists
after this, the next thing to check isn't this switch-back logic at all —
it's whether the self-detection's `EditorInfo.packageName` comparison is
even matching in the first place (a WebView-hosted `<input>`'s
`EditorInfo.packageName` should reliably report the hosting app, but "should
reliably" isn't "verified on this app's actual WebView/Android version
combination"). No changes made speculatively against that possibility
without on-device evidence it's the actual cause — logged here so it's the
first thing to rule in or out if the fallback above isn't the whole fix.

#### Verification

No compiler or Android SDK in this sandbox, same as every other Kotlin
change in this document — verified by reading `InputMethodService`'s
`switchToPreviousInputMethod`/`switchInputMethod` and
`InputMethodManager.getEnabledInputMethodList`/`InputMethodInfo` against
Android's own reference docs, and by machine-counting braces/parens/
brackets across the changed file as a balance sanity check. An on-device
try — create an entry from inside the app and confirm the normal keyboard
appears throughout, on a device where Vault's keyboard was enabled
and used with no other keyboard ever manually switched to first — is the
actual verification step, and the one that will settle the open question
above.
