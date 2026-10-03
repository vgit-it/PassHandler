// Copies the hand-authored Android IME source (`src-tauri/android-ime/`,
// tracked in git) into `src-tauri/gen/android/` (gitignored, rebuilt by
// `tauri android init`, and otherwise has no way to know this code exists).
//
// Why this exists: `src-tauri/gen/android/` is gitignored and regenerated
// from scratch by `tauri android init` (a fresh clone, a new machine, and CI
// on every run — see `ci.yml`), so any hand-written file that lives only
// there is silently discarded. See `docs/MANUAL-FILL-DESIGN.md`'s "Source
// tracking" section for the full list of what this carries.
//
// Everything hand-edited under `gen/android/` belongs here, not just the
// IME itself: `MainActivity.kt` (the IME's "Unlock Vault" launch handling,
// the `WebViewBridge` attach, system bar colors, the Force Dark opt-out) and
// the theme resources it depends on (`colors.xml`'s `home_background`, both
// `themes.xml` variants). Those four used to exist only in `gen/` — a fresh
// `android init` (CI, a new machine) replaced them with Tauri's stock
// versions, and `VaultIme.kt` references `MainActivity.EXTRA_LAUNCHED_FROM_FILL`,
// which the stock activity doesn't have. If you hand-edit any other file
// under `gen/android/`, move it here and add it below in the same change.
//
// Run this after `tauri android init` (first time, or any time `gen/` was
// deleted and recreated) and before building/running the Android app. Safe
// to re-run — file copies just overwrite, and the manifest patch checks its
// own marker comments before inserting anything twice.
//
// It also generates the Google Drive OAuth redirect intent-filter on
// `MainActivity` (`docs/google-oauth-setup.md`). That one is not copied from
// a tracked file: its scheme is the reversed Android OAuth client ID, which
// differs per developer and between the debug and release clients, so it is
// derived from `VITE_GOOGLE_CLIENT_ID_ANDROID` on every run.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(repoRoot, 'src-tauri', 'android-ime');
const genDir = join(repoRoot, 'src-tauri', 'gen', 'android');
const appMain = join(genDir, 'app', 'src', 'main');

function fail(message) {
  console.error(`[sync-android-ime] ${message}`);
  process.exit(1);
}

if (!existsSync(genDir)) {
  fail(
    `${genDir} does not exist yet. Run \`npm run tauri android init\` first, then re-run this script.`,
  );
}

function copyInto(fileName, fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  copyFileSync(join(fromDir, fileName), join(toDir, fileName));
  console.log(`[sync-android-ime] copied ${fileName}`);
}

const javaFiles = [
  // Replaces the stock `class MainActivity : TauriActivity()` that
  // `android init` generates — see this file's header for why.
  'MainActivity.kt',
  'VaultIme.kt',
  'VaultKeyboardView.kt',
  'VaultImePreviewActivity.kt',
  'WebViewBridge.kt',
  'QuickFillRanking.kt',
  'QuickFillUsage.kt',
];
const javaFrom = join(sourceDir, 'java', 'com', 'passhandler', 'app');
const javaTo = join(appMain, 'java', 'com', 'passhandler', 'app');
for (const file of javaFiles) copyInto(file, javaFrom, javaTo);

const drawableFiles = [
  'ic_lock.xml',
  'ic_globe.xml',
  'ic_vault_logo.xml',
  'ic_home_logo.xml',
  // Control glyphs, in place of text characters (✕ ✓ + ⌫) whose look
  // varies by device font.
  'ic_close.xml',
  'ic_check.xml',
  'ic_plus.xml',
  'ic_backspace.xml',
  'ic_eye.xml',
  'ic_eye_off.xml',
  'ic_keyboard.xml',
  'ic_chevron_down.xml',
  // Entry-type glyphs for the IME's result-row icons — see
  // `VaultKeyboardView.entryTypeIconRes`.
  'ic_type_address.xml',
  'ic_type_backup_codes.xml',
  'ic_type_bank.xml',
  'ic_type_card.xml',
  'ic_type_identity.xml',
  'ic_type_insurance.xml',
  'ic_type_license_key.xml',
  'ic_type_loyalty.xml',
  'ic_type_phone.xml',
  'ic_type_secure_note.xml',
  'ic_type_security_qa.xml',
  'ic_type_ssh_key.xml',
  'ic_type_vehicle.xml',
  'ic_type_wifi.xml',
];
const drawableFrom = join(sourceDir, 'res', 'drawable');
const drawableTo = join(appMain, 'res', 'drawable');
for (const file of drawableFiles) copyInto(file, drawableFrom, drawableTo);

copyInto('method.xml', join(sourceDir, 'res', 'xml'), join(appMain, 'res', 'xml'));

// Overwrite the generated theme resources: `home_background` (colors.xml) is
// what `MainActivity.kt` paints the system bars with and what both theme
// variants use as the native window background. Both `values/` and
// `values-night/` themes are needed — a device in dark mode resolves its
// window theme from the night variant only.
copyInto('colors.xml', join(sourceDir, 'res', 'values'), join(appMain, 'res', 'values'));
copyInto('themes.xml', join(sourceDir, 'res', 'values'), join(appMain, 'res', 'values'));
copyInto('themes.xml', join(sourceDir, 'res', 'values-night'), join(appMain, 'res', 'values-night'));

// --- AndroidManifest.xml: insert each fragment block (by its own
// `<!-- sync-marker: NAME -->` comment) right before `</application>`,
// skipping any marker already present so a re-run changes nothing.
const fragmentsPath = join(sourceDir, 'manifest-fragments.xml');
const fragmentsRaw = readFileSync(fragmentsPath, 'utf8');

// Splits on the marker comment lines, pairing each marker with the block of
// XML that follows it up to the next marker (or the closing </fragments>
// tag). A small, deliberately non-general parser — this file's own format
// is fixed and hand-authored, not arbitrary XML, so a real XML parser would
// be more machinery than the problem needs.
const markerPattern = /<!--\s*sync-marker:\s*([\w-]+)\s*-->/g;
const fragments = [];
let match;
let lastIndex = -1;
let lastName = null;
while ((match = markerPattern.exec(fragmentsRaw))) {
  if (lastName !== null) {
    fragments.push({ name: lastName, markerText: fragmentsRaw.slice(lastIndex, match.index) });
  }
  lastName = match[1];
  lastIndex = match.index;
}
if (lastName !== null) {
  const tail = fragmentsRaw.slice(lastIndex, fragmentsRaw.indexOf('</fragments>'));
  fragments.push({ name: lastName, markerText: tail });
}
if (fragments.length === 0) fail(`No sync-marker blocks found in ${fragmentsPath}.`);

const manifestPath = join(appMain, 'AndroidManifest.xml');
let manifest = readFileSync(manifestPath, 'utf8');

let inserted = 0;
for (const fragment of fragments) {
  const marker = `sync-marker: ${fragment.name}`;
  if (manifest.includes(marker)) {
    console.log(`[sync-android-ime] ${fragment.name} already present, skipping`);
    continue;
  }
  const block = fragment.markerText.trimEnd();
  const closingTag = '</application>';
  const idx = manifest.lastIndexOf(closingTag);
  if (idx === -1) fail(`${manifestPath} has no </application> closing tag.`);
  manifest = `${manifest.slice(0, idx)}\n${block}\n\n    ${manifest.slice(idx)}`;
  inserted++;
  console.log(`[sync-android-ime] inserted ${fragment.name}`);
}

// --- AndroidManifest.xml: the OAuth redirect intent-filter, inside
// `MainActivity`'s own <activity> element. Unlike the fragments above it is
// rewritten on every run rather than skipped once present, so a changed
// client ID (debug → release, or a new client) can never leave a stale
// redirect scheme behind.

// Same precedence as Vite: a variable already in the environment (how
// `release.yml` could pass it) wins over `.env`.
function readAndroidClientId() {
  const fromEnv = process.env.VITE_GOOGLE_CLIENT_ID_ANDROID;
  if (fromEnv !== undefined) return fromEnv.trim();
  const envPath = join(repoRoot, '.env');
  if (!existsSync(envPath)) return '';
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*VITE_GOOGLE_CLIENT_ID_ANDROID\s*=/.test(l));
  if (!line) return '';
  return line
    .slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
}

const oauthBegin = '<!-- sync-marker: oauth-redirect -->';
const oauthEnd = '<!-- /sync-marker: oauth-redirect -->';
const before = manifest;
const oldBlock = new RegExp(`[ \\t]*${oauthBegin}[\\s\\S]*?${oauthEnd}\\r?\\n?`);
manifest = manifest.replace(oldBlock, '');

const clientSuffix = '.apps.googleusercontent.com';
const clientId = readAndroidClientId();
if (!clientId) {
  console.log(
    '[sync-android-ime] no VITE_GOOGLE_CLIENT_ID_ANDROID — no OAuth redirect, Drive stays off on Android',
  );
} else {
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    fail(`VITE_GOOGLE_CLIENT_ID_ANDROID does not look like a Google OAuth client ID: ${clientId}`);
  }
  const scheme = `com.googleusercontent.apps.${clientId.slice(0, -clientSuffix.length)}`;

  // A filter added by hand (the manual step this replaced) is left alone if
  // it already carries this scheme. One for a different client would be a
  // second redirect target in the app, so that stops the sync instead.
  const existing = [...manifest.matchAll(/android:scheme="(com\.googleusercontent\.apps\.[^"]+)"/g)].map(
    (m) => m[1],
  );
  const foreign = existing.filter((s) => s !== scheme);
  if (foreign.length > 0) {
    fail(
      `${manifestPath} already has a hand-added OAuth redirect for ${foreign.join(', ')}, ` +
        `which is not the configured client (${scheme}). Delete that <intent-filter> and re-run.`,
    );
  }

  if (existing.length > 0) {
    console.log('[sync-android-ime] oauth-redirect already present (added by hand), skipping');
  } else {
    const activityAt = manifest.indexOf('android:name=".MainActivity"');
    if (activityAt === -1) fail(`${manifestPath} has no .MainActivity <activity> element.`);
    const closeAt = manifest.indexOf('</activity>', activityAt);
    if (closeAt === -1) fail(`${manifestPath}: .MainActivity has no </activity> closing tag.`);
    const block = [
      `    ${oauthBegin}`,
      '            <!-- Google Drive sign-in redirect: the reversed Android OAuth',
      '                 client ID. Generated from VITE_GOOGLE_CLIENT_ID_ANDROID by',
      '                 scripts/sync-android-ime.js; re-run it after changing that. -->',
      '            <intent-filter>',
      '                <action android:name="android.intent.action.VIEW" />',
      '                <category android:name="android.intent.category.DEFAULT" />',
      '                <category android:name="android.intent.category.BROWSABLE" />',
      `                <data android:scheme="${scheme}" />`,
      '            </intent-filter>',
      `            ${oauthEnd}`,
      '        ',
    ].join('\n');
    manifest = `${manifest.slice(0, closeAt)}${block}${manifest.slice(closeAt)}`;
    console.log(`[sync-android-ime] inserted oauth-redirect (${scheme})`);
  }
}

if (inserted > 0 || manifest !== before) writeFileSync(manifestPath, manifest);

console.log('[sync-android-ime] done.');
