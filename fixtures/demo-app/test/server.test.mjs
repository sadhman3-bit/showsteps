import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDemoApp } from '../server.mjs';

let app;
beforeAll(async () => {
  app = await startDemoApp({ port: 0, xoriginPort: 0 });
});
afterAll(() => app.close());

const get = (path, base = app.url) => fetch(base + path, { redirect: 'manual' });

describe('demo app server', () => {
  it('redirects / to the login page', async () => {
    const res = await get('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login.html');
  });

  it('serves a login page with a password field', async () => {
    const html = await (await get('/login.html')).text();
    expect(html).toContain('type="password"');
    expect(html).toContain('autocomplete="current-password"');
  });

  it('falls back to the SPA shell for deep app routes', async () => {
    const res = await get('/app/invoices/new');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="review-dialog"');
  });

  it('serves SPA assets as files, not the shell', async () => {
    const res = await get('/app/app.js');
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('tells the page where the cross-origin widget lives', async () => {
    const js = await (await get('/config.js')).text();
    expect(js).toContain(`"xoriginPort":${app.xoriginPort}`);
  });

  it('serves the cross-origin widget on the second port', async () => {
    const html = await (await get('/widget.html', `http://127.0.0.1:${app.xoriginPort}`)).text();
    expect(html).toContain('Cost centre lookup');
  });

  it('delays the recent-invoices endpoint', async () => {
    const t = Date.now();
    const rows = await (await get('/api/recent-invoices?delay=300')).json();
    expect(Date.now() - t).toBeGreaterThanOrEqual(250);
    expect(rows).toHaveLength(3);
  });

  it('serves the mock identity provider on the second port', async () => {
    const idp = `http://127.0.0.1:${app.xoriginPort}`;
    const html = await (await get('/idp/?return=x', idp)).text();
    expect(html).toContain('Sign in with Demo');
    expect(html).toContain('Alex Demo');
    expect(html).toContain('type="password"');
    expect((await get('/idp/idp.js', idp)).headers.get('content-type')).toContain('javascript');
  });

  it('starts a session from the identity provider callback', async () => {
    const res = await get('/auth/callback?user=alex&return=%2Fapp%2Finvoices%2Fnew');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/invoices/new');
    expect(res.headers.get('set-cookie')).toContain('demo_session=alex');
    // Never sends the person off the app.
    const away = await get('/auth/callback?user=alex&return=%2F%2Fevil.example');
    expect(away.headers.get('location')).toBe('/app/');
  });

  it('sends an expired session to the identity provider’s password page and back', async () => {
    const expire = await get('/auth/expire');
    expect(expire.headers.get('set-cookie')).toContain('demo_session=expired');
    const res = await fetch(`${app.url}/app/invoices/new`, {
      redirect: 'manual',
      headers: { cookie: 'demo_session=expired' },
    });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location'));
    expect(to.origin).toBe(`http://127.0.0.1:${app.xoriginPort}`);
    expect(to.pathname).toBe('/idp/');
    expect(to.searchParams.get('prompt')).toBe('login');
    const back = new URL(to.searchParams.get('return'));
    expect(back.pathname).toBe('/auth/callback');
    expect(back.searchParams.get('return')).toBe('/app/invoices/new');
    // With a live session (or none) the app loads as before.
    const ok = await fetch(`${app.url}/app/`, { headers: { cookie: 'demo_session=alex' } });
    expect(ok.status).toBe(200);
  });

  it('refuses path traversal', async () => {
    const res = await get('/..%2f..%2fpackage.json');
    expect([400, 404]).toContain(res.status);
  });
});
