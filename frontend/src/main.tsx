import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

/**
 * PWA registration is best-effort. Service workers are unavailable in private
 * browsing, some embedded webviews and under certain corporate policies;
 * VitalScan must keep working as a plain website when that happens, so any
 * failure is swallowed rather than surfacing as an uncaught rejection.
 *
 * Only the app shell is precached - measurement data is never cached.
 */
const inNativeShell =
  typeof window !== 'undefined' &&
  (window as unknown as { Capacitor?: unknown }).Capacitor !== undefined;

if (import.meta.env.PROD && !inNativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
