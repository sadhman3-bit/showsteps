import { describe, expect, it } from 'vitest';
import extensionKey from '../../extension/extension-key.json';
import { EXTENSION_IDS, hostManifest } from '../src/main/nativeHost';

describe('native host manifest', () => {
  it('lets both the unpacked and the Chrome Web Store extension connect', () => {
    expect(EXTENSION_IDS).toEqual([extensionKey.id, extensionKey.webstoreId]);
    expect(hostManifest('C:\\host.exe')).toMatchObject({
      path: 'C:\\host.exe',
      allowed_origins: [
        `chrome-extension://${extensionKey.id}/`,
        `chrome-extension://${extensionKey.webstoreId}/`,
      ],
    });
  });

  it('only accepts well-formed extension IDs', () => {
    for (const id of EXTENSION_IDS) expect(id).toMatch(/^[a-p]{32}$/);
  });
});
