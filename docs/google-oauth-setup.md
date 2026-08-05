# Setting up Google Drive sync

Sync is optional. With no client IDs configured the app builds and runs
local-only, and Settings says so rather than offering a button that fails.

You need **two** OAuth clients in one Google Cloud project. Google validates a
desktop client by its loopback redirect and an Android client by package name
plus signing-key fingerprint, so one client cannot serve both.

The Android client needs a SHA-1 you can only get *after* the Android toolchain
is set up, so do the desktop half first.

---

## 1. Create the project and consent screen

1. Go to <https://console.cloud.google.com/> and create a project named
   **`pass handler`**.
2. Enable the **Google Drive API** under *APIs & Services → Library*.
3. Configure the **OAuth consent screen**:
   - User type: **External**
   - App name: `Pass Handler`
   - Support and developer contact: your own email
4. On the **Scopes** step, add exactly one scope:

   ```
   https://www.googleapis.com/auth/drive.appdata
   ```

   Google classifies this as **Recommended / Non-sensitive**. It requires no
   verification review, and it confines the app to a hidden folder that only it
   can see — the rest of your Drive is unreachable, by construction rather than
   by promise.

   Do not add any other scope. Adding a broader Drive scope would push the
   project into a verification review it does not otherwise need.

5. Add yourself under **Test users**.

### Publish before handing the app to anyone else

While the consent screen is in **Testing**, refresh tokens expire after **seven
days**, forcing weekly re-authentication. That is fine while you are building.

Before giving the app to other people, press **Publish app** to move it to
Production. This removes the seven-day expiry. It does **not** remove the
unverified-app warning, and it does not require a verification review for the
non-sensitive `drive.appdata` scope.

---

## 2. Desktop client (Windows)

*APIs & Services → Credentials → Create credentials → OAuth client ID*

- Application type: **Desktop app**
- Name: `Pass Handler — Desktop`

Copy the client ID into `.env`:

```dotenv
VITE_GOOGLE_CLIENT_ID_DESKTOP=123456789-abcdefg.apps.googleusercontent.com
```

No client secret is used. Pass Handler is a public client and authenticates with
PKCE — a secret compiled into a binary you hand to three people is not a secret,
and Google's desktop client type expects exactly this.

The app listens on an ephemeral loopback port and opens consent in your **system
browser**, never in the app's own webview.

---

## 3. Android client

### Get the signing fingerprint

The debug keystore is created the first time the Android toolchain runs, so do
this after `npm run tauri android init`:

```bash
# Debug key — created automatically, same on every project on your machine
keytool -list -v \
  -keystore ~/.android/debug.keystore \
  -alias androiddebugkey \
  -storepass android -keypass android
```

On Windows the keystore is at `%USERPROFILE%\.android\debug.keystore`.

Copy the **SHA-1** line.

### Register the client

*Create credentials → OAuth client ID*

- Application type: **Android**
- Package name: `com.passhandler.app`
- SHA-1 certificate fingerprint: the value from above

```dotenv
VITE_GOOGLE_CLIENT_ID_ANDROID=123456789-hijklmn.apps.googleusercontent.com
```

> **Debug and release keys have different fingerprints and need separate
> clients.** Register a second Android client with your release keystore's SHA-1
> before building an APK to hand out, and swap the value in `.env`.

### Add the redirect intent-filter

Google's Android clients accept neither a loopback redirect nor the package name
as a scheme. The redirect must use the **reversed client ID**:

```
123456789-hijklmn.apps.googleusercontent.com
→ com.googleusercontent.apps.123456789-hijklmn:/oauth2redirect
```

The app derives that URL from the configured client ID at runtime, but Android
needs a matching `intent-filter` in the manifest, and the scheme is not known
until you have created the client.

After `npm run tauri android init`, open
`src-tauri/gen/android/app/src/main/AndroidManifest.xml` and add this inside the
existing `<activity android:name=".MainActivity">` element:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <!-- Reversed client ID. Replace with your own. -->
    <data android:scheme="com.googleusercontent.apps.123456789-hijklmn" />
</intent-filter>
```

`src-tauri/gen/` is generated and gitignored, so this edit lives on your machine
and survives ordinary rebuilds. If you ever delete `gen/` and re-run
`android init`, add it again.

---

## 4. Build

```bash
cp .env.example .env    # then fill in both client IDs
npm run tauri dev       # Windows
npm run tauri android dev
```

`.env` is gitignored. The IDs are public-client identifiers rather than secrets,
but they stay out of the repository so that each person who builds the app
points it at their own Google Cloud project.

---

## What you will see, and why it is fine

**"Google hasn't verified this app."** Expected, and permanent. Verification
review exists for sensitive scopes; `drive.appdata` is not one, so there is
nothing to submit. Choose *Advanced* → *Go to Pass Handler*. Onboarding says
this up front so it does not read as a failure.

**A 100-user cap.** Unverified apps are limited to 100 users. For a vault used
by three people this is not a constraint.

---

## What Google can and cannot see

Google receives an encrypted `.kdbx` blob and nothing else. No key, no master
password, no plaintext, no entry titles, no URLs. The file is decrypted only in
memory on your devices.

Google can see that a file exists, how large it is, and when it changed. That is
inherent to storing anything on someone else's computer.

The app makes **no other network requests of any kind** — no telemetry, no
analytics, no remote fonts or assets. The Content Security Policy is
`default-src 'self'` with no remote origins at all, which is possible because
every Drive call is made from the Rust layer rather than the webview.
