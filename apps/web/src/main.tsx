// Free fonts ship with the app (OFL); the commercial ones are only ever used when installed (lib/fonts.ts).
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/estedad/500.css';
import '@fontsource/estedad/700.css';
import '@fontsource/estedad/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ConsentPage from './components/ConsentPage';
import { applyFonts, loadFontChoice } from './lib/fonts';
import { initPairing } from './lib/pairing';
import { installLockSaving } from './lib/desktop';
import { applyTheme, storedTheme } from './lib/theme';

initPairing();
installLockSaving();
applyTheme(storedTheme());
applyFonts(loadFontChoice(), document.documentElement.lang === 'en' ? 'en' : 'fa');
// An AI app connecting over MCP opens `/oauth/authorize` (docs/ARCHITECTURE.md "MCP connector"): only the consent page.
const consent = location.pathname === '/oauth/authorize';
createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {consent ? <ConsentPage /> : <App />}
  </StrictMode>,
);
