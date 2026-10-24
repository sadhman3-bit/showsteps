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

  it('serves downloads for the Exports page, and the sign-in page when signed out', async () => {
    const pdf = await get('/files/report.pdf?kb=64');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBe(64 * 1024);
    const post = await fetch(app.url + '/api/export', { method: 'POST' });
    expect(post.headers.get('content-disposition')).toBe('attachment; filename="statement.pdf"');
    const out = await get('/files/report.pdf', app.url);
    expect(out.status).toBe(200);
    const signedOut = await fetch(app.url + '/files/report.pdf', {
      headers: { cookie: 'demo_session=expired' },
    });
    expect(signedOut.headers.get('content-type')).toContain('text/html');
  });

  it('has an Exports page and a Send page with a hidden file field', async () => {
    expect(await (await get('/exports.html')).text()).toContain('download="invoices.csv"');
    const send = await (await get('/send.html')).text();
    expect(send).toContain('type="file" accept=".pdf,.csv" aria-label="Attachment" hidden');
  });
});
