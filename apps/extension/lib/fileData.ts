// Files cross the extension's messages as base64 text (1.2).

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  // In slices: String.fromCharCode takes a limited number of arguments.
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function base64ToBytes(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** A file name from a link: its `download` attribute, else the address's last path segment. */
export function linkFileName(download: string | null, href: string): string {
  if (download) return download.split(/[\\/]/).pop() || 'download';
  try {
    const u = new URL(href);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const last = decodeURIComponent(u.pathname.split('/').pop() ?? '');
      if (last) return last;
    }
  } catch {
    // not a URL
  }
  return 'download';
}
