import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { AppProvider } from './app/store';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { installArgon2 } from './crypto/argon2';
import { createTauriPlatform } from './platform/tauri';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// A crash anywhere from here through the first commit used to leave a
// permanently blank window, with nothing in it to see: production builds
// ship without devtools (see the `debug_assertions` gate in lib.rs), and an
// error boundary cannot help — it only catches failures during React's own
// render, not one thrown while building the element tree that is handed to
// it. Painting the error straight into the page, without relying on React
// still being in a state where it can render it, is what makes a fatal
// startup failure visible on the device that hit it instead of just blank.
function showFatalError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  root!.innerHTML = '';
  const pre = document.createElement('pre');
  pre.style.cssText =
    'white-space: pre-wrap; margin: 0; padding: 16px; ' +
    'font: 12px/1.4 monospace; color: #f8fafc; background: #0b0d10;';
  pre.textContent = `Pass Handler failed to start.\n\n${message}`;
  root!.appendChild(pre);
}

// Two listeners, for the two shapes an escaped error can take. Both are
// guarded on the root being empty so neither ever overwrites an app that
// mounted fine and hit an unrelated error later — this is only for a
// failure severe enough that nothing was ever painted.
//
// unhandledrejection: a rejected promise during startup that nothing is
// awaiting (e.g. an IPC call fired from an effect without a .catch).
window.addEventListener('unhandledrejection', (event) => {
  if (root!.childElementCount === 0) showFatalError(event.reason);
});
// error: covers two different things, both requiring the capture phase
// (the third `true` argument) rather than the default bubble phase:
//
// - A plain synchronous throw outside the try block below — a callback, a
//   timer, an event handler. try/catch and the ErrorBoundary around <App/>
//   only see errors on paths that lead back to this module's own execution
//   or to React's render; this is the net under both.
// - A resource that failed to load — the <script> or <link> tag for the
//   built bundle itself getting a 404, or blocked outright. That fires an
//   `error` event on the element, and per spec that event does not bubble,
//   so a listener on `window` only ever sees it during the capture phase.
//   This is the one that matters most: if the bundle never loaded, none of
//   the JS above — including every other handler in this file — ever runs,
//   and the previous version of this file had no way to catch it at all.
window.addEventListener(
  'error',
  (event) => {
    if (root!.childElementCount !== 0) return;
    const target = event.target;
    if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
      const url = target instanceof HTMLScriptElement ? target.src : target.href;
      showFatalError(new Error(`Failed to load ${target.tagName.toLowerCase()}: ${url}`));
    } else {
      showFatalError(event.error ?? event.message);
    }
  },
  true,
);

try {
  // Wired up before anything can try to open a vault: without it every KDBX4
  // file, which is what KeePassXC writes, fails to decrypt.
  installArgon2();

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppProvider platform={createTauriPlatform()}>
          <App />
        </AppProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  );
} catch (error) {
  showFatalError(error);
}
