import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './app/base.css';
import './app/shell.css';
import './shared/ui/controls.css';
import './shared/ui/sheet.css';
import './shared/ui/timeline.css';
import './shared/ui/segment-editor.css';
import './shared/ui/panels.css';
import './features/today/today.css';
import './features/history/history.css';
import './features/statistics/statistics.css';
import './features/settings/settings.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
