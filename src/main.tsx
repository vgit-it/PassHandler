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

// Covers a rejected promise during startup that nothing else is awaiting.
// Guarded on the root being empty so it never overwrites an app that mounted
// fine and hit an unrelated async error later.
window.addEventListener('unhandledrejection', (event) => {
  if (root!.childElementCount === 0) showFatalError(event.reason);
});

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
