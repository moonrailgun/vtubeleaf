import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Output } from './output';

window.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {new URLSearchParams(location.search).has('output') ? <Output /> : <App />}
  </StrictMode>,
);
