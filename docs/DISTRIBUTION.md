# Building and distributing

Pass Handler targets **Windows and Android**. macOS and iOS are out of scope.

## Prerequisites

- Node 20+
- Rust 1.77+
- **Windows**: Visual Studio Build Tools with the C++ workload, and the WebView2
  runtime (present on Windows 11 and current Windows 10)
- **Android**: Android Studio, SDK 34, NDK, and `JAVA_HOME` set

```bash
npm install
```

---

## Windows

```bash
npm run tauri dev      # development
npm run tauri build    # produces an NSIS installer and an MSI
```

Output lands in `src-tauri/target/release/bundle/`.

### The SmartScreen warning

Unsigned builds trigger *"Windows protected your PC"*. A code-signing
certificate costs real money annually and is not worth it for three users, so
recipients click through:

1. Click **More info**
2. Click **Run anyway**

Tell people this in advance. An unexpected security warning is exactly the thing
that should make someone stop, so it needs to be expected.

The installer is configured for `currentUser` install mode, so no administrator
prompt appears.

---

## Android

```bash
npm run tauri android init     # once, generates src-tauri/gen/android
npm run tauri android dev      # emulator or attached device
npm run tauri android build --apk
```

`src-tauri/gen/` is generated and gitignored. After running `init` you need to
add the OAuth redirect `intent-filter` — see
[google-oauth-setup.md](./google-oauth-setup.md).

### Signing a release APK

```bash
keytool -genkey -v \
  -keystore pass-handler-release.jks \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -alias pass-handler
```

Point the build at it with `src-tauri/gen/android/keystore.properties`:

```properties
storeFile=/absolute/path/to/pass-handler-release.jks
storePassword=…
keyAlias=pass-handler
keyPassword=…
```

Both the keystore and that file are gitignored.

> ### Back up the release keystore
>
> Somewhere safe and permanent — not only on the machine that built it. If you
> lose it you can never sign an update to the same app identity again.
> Recipients would have to uninstall and reinstall, losing local app data.
>
> Back it up now, before you ship anything.

Remember that the release key's SHA-1 differs from the debug key's, so it needs
its own Android OAuth client.

### Sideloading

No store account, no fees, no review.

1. Send the recipient the APK.
2. They enable installation from unknown sources — Android prompts for this the
   first time, per-app, and it can be turned off again afterwards.
3. They open the APK and install.

---

## Handing the app to someone else

Each person runs a **fully independent vault**. There are no shared accounts, no
user management, and no server of ours anywhere. They connect their own Google
account, or skip sync entirely.

Checklist before you distribute:

- [ ] Consent screen moved from **Testing** to **Production**, or they will be
      re-authenticating every seven days
- [ ] Release-key Android OAuth client registered, and its ID in `.env`
- [ ] Release keystore backed up
- [ ] They know about the SmartScreen click-through (Windows) and the unknown
      sources prompt (Android)
- [ ] They know about the unverified-app screen, and that *Advanced → Continue*
      is the expected path
- [ ] They understand that **the master password cannot be recovered**
