import { render } from 'preact';
import '@trailmark/ui/tokens.css';
import '@trailmark/ui/app.css';
import './sidepanel.css';
import { applyTheme } from '@trailmark/ui';
import { SETTINGS_KEY } from '../../lib/guideMessages';
import { readSettings } from '../../lib/settings';
import { SidePanel } from './SidePanel';

// Same colours as the library (Settings → Colours).
const theme = () => void readSettings().then((s) => applyTheme(s.theme));
theme();
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SETTINGS_KEY in changes) theme();
});

const root = document.getElementById('app');
if (root) render(<SidePanel />, root);
