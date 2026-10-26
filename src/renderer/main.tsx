// SpaceViewer v2.2.26
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

// Capture any global unhandled errors in renderer to prevent silent failures
window.addEventListener('error', (event) => {
  console.error('[Renderer Error]', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.warn('[Renderer UnhandledRejection]', event.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

