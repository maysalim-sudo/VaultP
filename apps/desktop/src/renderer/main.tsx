import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { installTheme } from './theme/applyTokens.js';
import './styles.css';

// Paint the tokens before first render, so nothing flashes an unstyled frame.
installTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
