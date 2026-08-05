import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { AppProvider } from './app/store';
import { installArgon2 } from './crypto/argon2';
import { createTauriPlatform } from './platform/tauri';
import './index.css';

// Wired up before anything can try to open a vault: without it every KDBX4
// file, which is what KeePassXC writes, fails to decrypt.
installArgon2();

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppProvider platform={createTauriPlatform()}>
      <App />
    </AppProvider>
  </React.StrictMode>,
);
