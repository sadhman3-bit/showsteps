/**
 * Live Blur: elements the user marks are blurred on the page itself while capturing, so the
 * pixels never reach a screenshot. Inline !important styles also work inside shadow roots.
 */
export class LiveBlur {
  private readonly blurred = new Map<
    HTMLElement | SVGElement,
    { filter: string; priority: string }
  >();

  get count(): number {
    return this.blurred.size;
  }

  has(el: Element): boolean {
    return this.blurred.has(el as HTMLElement);
  }

  toggle(el: Element): boolean {
    const styled = el as HTMLElement;
    if (!styled.style) return false;
    const previous = this.blurred.get(styled);
    if (previous) {
      this.restore(styled, previous);
      this.blurred.delete(styled);
      return false;
    }
    this.blurred.set(styled, {
      filter: styled.style.getPropertyValue('filter'),
      priority: styled.style.getPropertyPriority('filter'),
    });
    styled.style.setProperty('filter', 'blur(8px)', 'important');
    return true;
  }

  private restore(el: HTMLElement | SVGElement, prev: { filter: string; priority: string }) {
    if (prev.filter) el.style.setProperty('filter', prev.filter, prev.priority);
    else el.style.removeProperty('filter');
  }

  /** Remove every blur (end of capture). */
  clear(): void {
    for (const [el, prev] of this.blurred) this.restore(el, prev);
    this.blurred.clear();
  }
}
