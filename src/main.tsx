import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initLang } from './i18n';

window.addEventListener('contextmenu', (event) => event.preventDefault());

const params = new URLSearchParams(location.search);
await initLang();
// Each window parses only its own UI. Load it before rendering: a Suspense fallback
// would hold the first paint back by React's 300 ms reveal throttle.
const Root = params.has('about')
  ? (await import('./About')).About
  : params.has('output')
    ? (await import('./output')).Output
    : (await import('./App')).App;

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
