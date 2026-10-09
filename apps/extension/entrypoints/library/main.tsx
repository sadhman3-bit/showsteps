import { render } from 'preact';
import '@trailmark/ui/tokens.css';
import '@trailmark/ui/app.css';
import { LibraryApp } from './LibraryApp';

const root = document.getElementById('app');
if (root) render(<LibraryApp />, root);
