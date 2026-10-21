import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './theme';
import * as engine from './audio/engine';

// Test hooks for the e2e driver.
if (import.meta.env.DEV) Object.assign(window, { __djw: { engine } });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
