import React from 'react';
import ReactDOM from 'react-dom/client';
import { MaxUI } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
import './styles.css';
import App from './App';

async function boot() {
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') {
    const { worker } = await import('./mock/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MaxUI colorScheme="light">
        <App />
      </MaxUI>
    </React.StrictMode>,
  );
}

void boot();
