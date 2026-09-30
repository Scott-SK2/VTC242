import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import './shared/i18n';
import { App } from './app/App';
import { setupPwa } from './pwa';
import { setupSentry } from './pwa/sentry';

setupPwa();
setupSentry();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
