import { BrandSourcesContext } from '@showsteps/ui';
import { render } from 'preact';
import '@showsteps/ui/tokens.css';
import '@showsteps/ui/app.css';
import { getBrandStores } from '../../lib/client';
import { LibraryApp } from './LibraryApp';

const root = document.getElementById('app');
// Brand kits for every export made from these pages (B6).
if (root)
  render(
    <BrandSourcesContext.Provider value={getBrandStores}>
      <LibraryApp />
    </BrandSourcesContext.Provider>,
    root,
  );
