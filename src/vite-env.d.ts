/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * OAuth client IDs, injected at build time from `.env`.
   *
   * Both are optional. With neither set the app builds and runs local-only, and
   * Settings says Drive is not configured rather than offering a button that
   * fails. See docs/google-oauth-setup.md.
   */
  readonly VITE_GOOGLE_CLIENT_ID_DESKTOP?: string;
  readonly VITE_GOOGLE_CLIENT_ID_ANDROID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
