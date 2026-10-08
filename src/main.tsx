import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {Toaster} from './components/Toaster';
import {DialogHost} from './components/ui/Dialog';
import {installUsageNotices} from './components/AccountServices';
import {installInputModality} from './utils/inputModality';
import {installNativeShell, nativeAppReady} from './native/bootstrap';
import {installChunkRecovery} from './utils/lazyPage';
import './index.css';

document.title = 'AutoYT';
installUsageNotices();
// Focus rings appear only during keyboard navigation (see index.css).
installInputModality();
// No-op on the web; inside the iOS/Android apps it wires up native sign-in, downloads and system bars.
installNativeShell();
// After a deploy, an open tab's page files are gone: reload once instead of going blank.
installChunkRecovery();

// Favicons are declared in index.html (ico, svg, png, and touch icon).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <Toaster />
    <DialogHost />
  </StrictMode>,
);
requestAnimationFrame(() => nativeAppReady());
