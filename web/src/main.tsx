import '@design/tokens.css';
import '@design/assets/fonts/fonts.css';
import './design/base.css';
import './shell/shell.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startFeed } from './data/store';

startFeed();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
