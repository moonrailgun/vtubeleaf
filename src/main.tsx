import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Output } from './output';
import { About } from './About';

window.addEventListener('contextmenu', (event) => event.preventDefault());

const params = new URLSearchParams(location.search);

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    {params.has('about') ? <About /> : params.has('output') ? <Output /> : <App />}
  </StrictMode>,
);
