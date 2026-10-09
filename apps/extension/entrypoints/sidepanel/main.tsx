import { render } from 'preact';
import '@trailmark/ui/tokens.css';
import '@trailmark/ui/app.css';
import './sidepanel.css';
import { SidePanel } from './SidePanel';

const root = document.getElementById('app');
if (root) render(<SidePanel />, root);
