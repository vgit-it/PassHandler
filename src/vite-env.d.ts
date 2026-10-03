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
  /**
   * Google issues this for the desktop client only — never for Android — and
   * its token endpoint requires it be sent despite the desktop client being a
   * PKCE public client. See `src-tauri/src/oauth.rs`'s module docs.
   */
  readonly VITE_GOOGLE_CLIENT_SECRET_DESKTOP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `package.json`'s version, injected by `vite.config.ts`'s `define`. */
declare const __APP_VERSION__: string;
