import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoutes } from './routes';
import { AuthProvider } from './contexts/AuthContext';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { SettingsProvider } from './contexts/SettingsContext';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <AuthProvider>
      <PermissionsProvider>
        <SettingsProvider>
          <AppRoutes />
        </SettingsProvider>
      </PermissionsProvider>
    </AuthProvider>
  </React.StrictMode>
);

// PWA: registra o service worker (habilita "Instalar app" na tela inicial).
// SW mínimo, sem cache — não interfere no deploy/atualização.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sem PWA não quebra o app */ });
  });
}