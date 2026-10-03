#!/usr/bin/env bash
#
# Writes the Google OAuth client IDs into `.env` for a release build. Vite
# reads them at build time, and `.env` is gitignored, so without this every CI
# build comes out local-only — Drive sync silently absent from the release.
#
# GOOGLE_CLIENT_ID_ANDROID must be the release-key client, not the debug one
# in a developer's local `.env`: Google registers an Android client against
# one signing certificate. See docs/DISTRIBUTION.md, "What a release APK
# contains".
#
# On a `v*` tag a missing value fails the build: a release that ships without
# sync is the thing this exists to prevent. Any other run only warns, so the
# pipeline can still be exercised without the secrets.

set -euo pipefail

# Set by Actions. Defaulted so the script can be run by hand under `set -u`.
: "${GITHUB_STEP_SUMMARY:=/dev/null}"
: "${GITHUB_REF:=}"

names=(GOOGLE_CLIENT_ID_DESKTOP GOOGLE_CLIENT_SECRET_DESKTOP GOOGLE_CLIENT_ID_ANDROID)

missing=()
for name in "${names[@]}"; do
  [ -n "${!name:-}" ] || missing+=("$name")
done

{
  for name in "${names[@]}"; do
    echo "VITE_${name}=${!name:-}"
  done
} > .env

if [ "${#missing[@]}" -eq 0 ]; then
  echo "Google Drive: configured" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

message="Google Drive is not configured — missing repository secrets: ${missing[*]}. This build is local-only."
if [[ "$GITHUB_REF" == refs/tags/v* ]]; then
  echo "::error::$message"
  exit 1
fi
echo "::warning::$message"
echo "> **$message**" >> "$GITHUB_STEP_SUMMARY"
