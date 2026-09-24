/**
 * Build-time replacement for `@xmldom/xmldom`, wired up as an alias in
 * `vite.config.ts`. This module is never used by application code directly —
 * nothing imports it. Vite substitutes it for the real package.
 *
 * Why: kdbxweb's UMD bundle unconditionally `require()`s `@xmldom/xmldom` at
 * import time (it is declared as an external in the UMD header), even though
 * it only actually falls back to it when no native `DOMParser` /
 * `XMLSerializer` global exists — see `createDOMParser` / `createXMLSerializer`
 * in kdbxweb's dist bundle, which check `window.DOMParser` first. The Tauri
 * webview always provides those natively (WebView2 on Windows, the system
 * WebView on Android), so the real package is never actually *used* here —
 * only imported, and that import alone is enough to break the app.
 *
 * `@xmldom/xmldom`'s internal inheritance helper mutates
 * `SomeClass.prototype.constructor` at module-evaluation time. Its base
 * `Node.prototype` is a plain object literal with no own `constructor`, so
 * that mutation resolves through the prototype chain to
 * `Object.prototype.constructor`. `tauri.conf.json` sets
 * `security.freezePrototype: true`, which runs `Object.freeze(Object.prototype)`
 * in the webview at startup, and ES modules always run in strict mode — so
 * that assignment throws a `TypeError` the instant kdbxweb (and therefore
 * xmldom) is imported, before a single line of vault code runs. This is true
 * of every published xmldom version, not just the one kdbxweb pins.
 *
 * This shim stands in for the package so it is never evaluated, and forwards
 * to the same natives kdbxweb would have picked anyway.
 */
export const DOMParser = globalThis.DOMParser;
export const XMLSerializer = globalThis.XMLSerializer;
