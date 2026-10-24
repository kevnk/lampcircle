import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './theme';
import * as engine from './audio/engine';
import { isIOS, isTauri } from './platform';
import { SettingsApp } from './desktop/SettingsApp';

// Test hooks for the e2e driver.
if (import.meta.env.DEV) Object.assign(window, { __djw: { engine } });

// The Mac app's styles key off this, for the space its traffic lights take. iPhone and iPad key off `ios`.
document.documentElement.classList.toggle('desktop', isTauri() && !isIOS());
document.documentElement.classList.toggle('ios', isIOS());
const settingsWindow = new URLSearchParams(window.location.search).get('window') === 'settings';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{settingsWindow ? <SettingsApp /> : <App />}</React.StrictMode>);
