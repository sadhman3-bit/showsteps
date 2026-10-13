import { render } from 'preact';
import '@showsteps/ui/tokens.css';
import '@showsteps/ui/app.css';
import { LibraryApp } from './LibraryApp';

const root = document.getElementById('app');
if (root) render(<LibraryApp />, root);
