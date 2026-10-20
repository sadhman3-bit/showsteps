import type { Page } from '@playwright/test';

/** Visible buttons, links and form controls without a name, or smaller than 24×24 px. */
export async function audit(page: Page): Promise<{ unnamed: string[]; small: string[] }> {
  return page.evaluate(() => {
    const unnamed: string[] = [];
    const small: string[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const nameOf = (el: HTMLElement): string => {
      const labelledby = el.getAttribute('aria-labelledby');
      if (labelledby)
        return labelledby
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
      if (el.getAttribute('aria-label')) return el.getAttribute('aria-label') ?? '';
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) {
        if (el.labels?.length)
          return [...el.labels]
            .map((l) => l.textContent)
            .join(' ')
            .trim();
        return el.placeholder ?? el.title ?? '';
      }
      return (el.textContent ?? '').trim() || el.title;
    };
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], summary',
    )) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!nameOf(el)) unnamed.push(describe(el));
      // Inline text links are exempt from the target size rule (WCAG 2.5.8).
      const inline = el.tagName === 'A' || el.classList.contains('ss-link');
      if (!inline && (r.width < 24 || r.height < 24))
        small.push(`${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { unnamed, small };
  });
}

/** Tab through the first `n` stops: each focused element shows an outline or a ring. */
export async function focusVisible(page: Page, n = 12): Promise<string[]> {
  const missing: string[] = [];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab');
    const shown = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'none';
      // A ring on the element, or on the field it sits in (search boxes ring the whole box).
      const ring = (node: Element | null) => {
        if (!node) return false;
        const s = getComputedStyle(node);
        return (
          (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
          (!!s.boxShadow && s.boxShadow !== 'none')
        );
      };
      const visible = ring(el) || ring(el.parentElement);
      return visible
        ? ''
        : `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30)}"`;
    });
    if (shown && shown !== 'none') missing.push(shown);
  }
  return missing;
}

/** Elements still transitioning or animating (should be none with reduced motion). */
export function moving(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
        const s = getComputedStyle(el);
        return (
          parseFloat(s.transitionDuration) > 0.05 ||
          (s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.05)
        );
      }).length,
  );
}
