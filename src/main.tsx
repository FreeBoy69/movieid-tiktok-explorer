import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {Toaster} from './components/Toaster';
import './index.css';

document.title = 'AutoYT';

// Favicons are declared in index.html (ico, svg, png, and touch icon).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
