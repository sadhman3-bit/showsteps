import { describe, expect, it } from 'vitest';
import {
  BrandKitSchema,
  SHOWSTEPS_KIT,
  coverOrder,
  createGuide,
  expandTokens,
  isShowStepsLook,
  parseGuide,
  resolveBrand,
  serializeGuide,
  type BrandKit,
} from '../src/index.js';

const kit = (id: string, over: Partial<BrandKit> = {}): BrandKit =>
  BrandKitSchema.parse({ ...SHOWSTEPS_KIT, id, name: id, ...over });

const acme = kit('acme', {
  company: 'Acme Pty Ltd',
  colors: { ...SHOWSTEPS_KIT.colors, accent: '#0055aa', links: '#0055aa' },
  logo: 'acme-logo.png',
  cover: { ...SHOWSTEPS_KIT.cover, style: 'solid' },
});
const team = kit('team', {
  colors: { ...SHOWSTEPS_KIT.colors, accent: '#118833' },
  page: { ...SHOWSTEPS_KIT.page, notice: 'Internal use only' },
});

describe('brand kits (B1)', () => {
  it('without any kit, a guide looks exactly as before', () => {
    const brand = resolveBrand(createGuide());
    expect(isShowStepsLook(brand)).toBe(true);
    expect(brand.logoFrom).toBeUndefined();
  });

  it('applies the library default, then the team kit, then the guide’s kit and overrides', () => {
    const ctx = { kits: [acme, team], defaultKit: 'acme', teamKit: team };
    const plain = resolveBrand(createGuide(), ctx);
    // The team's kit replaces the library default as a whole: its accent, cover and no logo.
    expect(plain.colors.accent).toBe('#118833');
    expect(plain.cover.style).toBe('pattern');
    expect(plain.page.notice).toBe('Internal use only');
    expect(plain.logoFrom).toBeUndefined();
    expect(resolveBrand(createGuide(), { kits: [acme], defaultKit: 'acme' }).logoFrom).toEqual({
      from: 'kit',
      kitId: 'acme',
      name: 'acme-logo.png',
    });
    const own = resolveBrand(
      createGuide({
        branding: {
          kit: 'acme',
          overrides: { colors: { headings: '#222222' }, marks: { pattern: false } },
        },
      } as never),
      ctx,
    );
    expect(own.colors.accent).toBe('#0055aa');
    expect(own.cover.style).toBe('solid');
    expect(own.colors.headings).toBe('#222222');
    expect(own.marks.pattern).toBe(false);
    expect(own.marks.openInLinks).toBe(true);
    // A guide can choose ShowSteps's own look over the library's default.
    const plainLook = resolveBrand(createGuide({ branding: { kit: 'showsteps' } } as never), ctx);
    expect(isShowStepsLook(plainLook)).toBe(true);
  });

  it('keeps a 1.2 guide’s logo, accent and font', () => {
    const g = {
      ...createGuide(),
      branding: { logo: 'img/branding-logo.png', accent: '#123456', font: 'Georgia' },
    };
    const brand = resolveBrand(g);
    expect(brand.colors.accent).toBe('#123456');
    expect(brand.fonts).toEqual({ body: 'Georgia', heading: 'Georgia' });
    expect(brand.logoFrom).toEqual({ from: 'guide', name: 'branding-logo.png' });
    // The new fields survive saving and reading back.
    const saved = parseGuide(
      JSON.parse(
        serializeGuide({
          ...g,
          branding: { ...g.branding, kit: 'acme', overrides: { company: 'X' } },
        }),
      ),
    );
    expect(saved.branding).toMatchObject({
      kit: 'acme',
      overrides: { company: 'X' },
      accent: '#123456',
    });
  });

  it('fills in header and footer tokens', () => {
    const v = {
      title: 'Pay a bill',
      company: 'Acme',
      page: 3,
      pages: 9,
      date: '1 May 2026',
      pageOf: 'Page 3 of 9',
    };
    expect(expandTokens('{company} · {title}', v)).toBe('Acme · Pay a bill');
    expect(expandTokens('{pageOf}', v)).toBe('Page 3 of 9');
    expect(expandTokens('{page}/{pages} {date} {author}{nope}', v)).toBe('3/9 1 May 2026 {nope}');
  });

  it('orders the cover as the kit says, hiding what it hides', () => {
    const order = coverOrder({
      cover: {
        ...SHOWSTEPS_KIT.cover,
        elements: [
          { kind: 'logo', visible: true },
          { kind: 'title', visible: true },
          { kind: 'links', visible: false },
        ],
      },
    });
    expect(order).toEqual(['logo', 'title', 'description', 'meta', 'preconditions']);
  });

  it('keeps kit text to one short line and refuses bad colours and names', () => {
    const k = kit('k', { company: `Acme\nInc\u2028Ltd` });
    expect(k.company).toBe('Acme Inc Ltd');
    expect(() => kit('k', { company: 'x'.repeat(201) })).toThrow();
    expect(() => kit('k', { colors: { ...SHOWSTEPS_KIT.colors, accent: 'red' } })).toThrow();
    expect(() => kit('k', { logo: '../evil.png' })).toThrow();
    expect(() => kit('bad id!')).toThrow();
  });
});
