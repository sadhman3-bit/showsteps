import type { GuideStore } from '@trailmark/core';
import { useEffect, useState } from 'preact/hooks';

const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export function mimeFor(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Object URL for an image in the store; revoked when the component unmounts or inputs change. */
export function useImageUrl(
  store: GuideStore,
  guideId: string,
  name: string | undefined,
): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!name) {
      setUrl(undefined);
      return;
    }
    let created: string | undefined;
    let cancelled = false;
    store
      .getImage(guideId, name)
      .then((bytes) => {
        if (cancelled || !bytes) return;
        created = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeFor(name) }));
        setUrl(created);
      })
      .catch(() => setUrl(undefined));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [store, guideId, name]);
  return url;
}

/** Remember a small UI preference (view mode, sort) in localStorage when available. */
export function usePreference<T extends string>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(`trailmark:${key}`) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`trailmark:${key}`, v);
    } catch {
      // storage unavailable (private window): keep it for this session only
    }
  };
  return [value, set];
}

/** Save bytes as a file via a temporary link (works in extension pages and Electron). */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  type = 'application/octet-stream',
): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A file-system-safe name for exports. */
export function safeFileName(title: string): string {
  return (
    title
      // eslint-disable-next-line no-control-regex -- control characters are invalid in file names
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'guide'
  );
}
