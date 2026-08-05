#!/usr/bin/env bash
#
# Gradle emits release APKs unsigned — Tauri's generated `app/build.gradle.kts`
# declares no `signingConfig` for the release build type — so signing is a
# separate step here rather than something the build does for us.
#
# Signing with `apksigner` rather than wiring a `signingConfig` into Gradle is
# deliberate: `src-tauri/gen/` is generated and gitignored, so every CI run
# would have to patch a file it had just created. This keeps the keystore in a
# single place, out of the workspace, and shredded when the step ends.
#
# With no keystore configured the APKs are still produced, just unsigned and
# named so. Unsigned APKs cannot be installed; see docs/DISTRIBUTION.md.

set -euo pipefail

# Set by Actions. Defaulted so the script can be run by hand without failing
# under `set -u`.
: "${GITHUB_STEP_SUMMARY:=/dev/null}"
: "${RUNNER_TEMP:=${TMPDIR:-/tmp}}"

apk_dir="src-tauri/gen/android/app/build/outputs/apk"
dist="dist"
mkdir -p "$dist"

version=$(node -p "require('./src-tauri/tauri.conf.json').version")

# zipalign and apksigner both live in build-tools. Take the newest installed
# rather than pinning a version the runner image may move on from.
build_tools=$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
if [ -z "$build_tools" ]; then
  echo "no Android build-tools found under $ANDROID_HOME" >&2
  exit 1
fi

keystore=""
if [ -n "${KEYSTORE_BASE64:-}" ]; then
  # $RUNNER_TEMP, never the workspace: nothing here can be swept into an
  # artifact upload by a path glob.
  keystore="$RUNNER_TEMP/release.jks"
  printf '%s' "$KEYSTORE_BASE64" | base64 --decode > "$keystore"

  if [ -z "${KEY_ALIAS:-}" ]; then
    echo "ANDROID_KEYSTORE_BASE64 is set but ANDROID_KEY_ALIAS is not" >&2
    exit 1
  fi
  # keytool writes PKCS12 by default, where the key password must equal the
  # store password, so a separate key password is optional.
  : "${KEY_PASSWORD:=${KEYSTORE_PASSWORD:-}}"
  export KEY_PASSWORD
fi

# Trap rather than a trailing `rm`: a mid-script failure must not leave the
# decoded keystore behind for a later step to pick up.
cleanup() {
  [ -n "$keystore" ] && shred -u "$keystore" 2>/dev/null || true
  rm -f "$RUNNER_TEMP"/*-aligned.apk
}
trap cleanup EXIT

# The Gradle flavour is named after the Rust arch; users match their device
# against the Android ABI, so the filenames use the ABI.
abi_for() {
  case "$1" in
    aarch64) echo arm64-v8a ;;
    armv7) echo armeabi-v7a ;;
    i686) echo x86 ;;
    x86_64) echo x86_64 ;;
    *) echo "$1" ;;
  esac
}

{
  echo "## Android"
  echo
} >> "$GITHUB_STEP_SUMMARY"

shopt -s nullglob
found=0

for apk in "$apk_dir"/*/release/*.apk; do
  found=1
  flavor=$(basename "$(dirname "$(dirname "$apk")")")
  abi=$(abi_for "$flavor")
  aligned="$RUNNER_TEMP/$flavor-aligned.apk"

  "$build_tools/zipalign" -p -f 4 "$apk" "$aligned"

  if [ -n "$keystore" ]; then
    target="$dist/PassHandler-$version-$abi.apk"
    "$build_tools/apksigner" sign \
      --ks "$keystore" \
      --ks-pass env:KEYSTORE_PASSWORD \
      --ks-key-alias "$KEY_ALIAS" \
      --key-pass env:KEY_PASSWORD \
      --out "$target" \
      "$aligned"
  else
    target="$dist/PassHandler-$version-$abi-unsigned.apk"
    cp "$aligned" "$target"
  fi

  echo "- \`$(basename "$target")\` — $(du -h "$target" | cut -f1)" >> "$GITHUB_STEP_SUMMARY"
done

if [ "$found" != 1 ]; then
  echo "no APKs found under $apk_dir" >&2
  exit 1
fi

if [ -n "$keystore" ]; then
  # Every APK is signed with the same key, so one is representative. The
  # certificate's SHA-1 is what a Google OAuth client is registered against, and
  # it differs from the debug key's. It is public — it ships inside every APK —
  # so printing it here leaks nothing.
  signed=("$dist"/*.apk)
  sha1=$("$build_tools/apksigner" verify --print-certs "${signed[0]}" |
    grep -i "SHA-1 digest" || true)
  {
    echo
    echo "Signing certificate — register this SHA-1 as the Android OAuth client's"
    echo "fingerprint (docs/google-oauth-setup.md):"
    echo
    echo '```'
    echo "${sha1:-could not read certificate}"
    echo '```'
  } >> "$GITHUB_STEP_SUMMARY"
else
  {
    echo
    echo "> **Unsigned.** No \`ANDROID_KEYSTORE_BASE64\` secret is configured, so"
    echo "> these APKs cannot be installed as they are. See docs/DISTRIBUTION.md."
  } >> "$GITHUB_STEP_SUMMARY"
fi
