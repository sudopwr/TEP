import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { AppTheme } from './shared/theme/AppTheme';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('index.html is missing its #root element');
}

createRoot(container).render(
  <StrictMode>
    <AppTheme>
      <App />
    </AppTheme>
  </StrictMode>,
);
