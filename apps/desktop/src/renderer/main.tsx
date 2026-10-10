import '@trailmark/ui/tokens.css';
import '@trailmark/ui/app.css';
import './desktop.css';
import { render } from 'preact';
import { App } from './App';
import { Controller } from './Controller';
import { Overlay } from './Overlay';

const root = document.getElementById('app');
const page = document.body.dataset.page;
if (root)
  render(page === 'controller' ? <Controller /> : page === 'overlay' ? <Overlay /> : <App />, root);
