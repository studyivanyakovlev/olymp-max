import React from 'react';
import ReactDOM from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import './styles.css';
import App from './App';

async function boot() {
  if (import.meta.env.VITE_USE_MOCK === 'true') {
    const { worker } = await import('./mock/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }

  try {
    const max = (window as any).WebApp;
    if (max?.ready) {
      max.ready();
    }
    if (max?.expand) {
      max.expand();
    }
  } catch {}

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MaxUI colorScheme="light">
        <App />
      </MaxUI>
    </React.StrictMode>,
  );
}

void boot();
