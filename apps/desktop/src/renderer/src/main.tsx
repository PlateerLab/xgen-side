import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './preview-api';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
