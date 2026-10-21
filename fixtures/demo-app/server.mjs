// Demo app server for ShowSteps tests. No dependencies.
// Main origin serves the app; a second port serves the cross-origin iframe widget.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('./public/', import.meta.url));
const XORIGIN_ROOT = fileURLToPath(new URL('./xorigin/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Resolve a URL path inside root, refusing anything that escapes it. */
function safePath(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const full = normalize(join(root, decoded));
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

async function sendFile(res, file, status = 200) {
  try {
    const body = await readFile(file);
    res.writeHead(status, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

function cookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

function mainHandler(xoriginPort) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/') {
      res.writeHead(302, { location: '/login.html' });
      return res.end();
    }
    if (path === '/config.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' });
      return res.end(`window.DEMO_CONFIG = ${JSON.stringify({ xoriginPort })};`);
    }
    if (path === '/api/recent-invoices') {
      // Deliberately slow, to test waiting.
      const delay = Number(url.searchParams.get('delay') ?? 1500);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(delay, 0), 10000)));
      res.writeHead(200, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
      return res.end(
        JSON.stringify([
          { number: 'INV-1042', supplier: 'Harbour Paper Co.', amount: 1280.5 },
          { number: 'INV-1041', supplier: 'Gumtree Logistics', amount: 432.0 },
          { number: 'INV-1039', supplier: 'Saltbush Software', amount: 9900.0 },
        ]),
      );
    }
    // Sign-in through the mock identity provider (second port, /idp/): it sends the person
    // back here with a user name, which becomes the session cookie.
    if (path === '/auth/callback') {
      const user = (url.searchParams.get('user') ?? 'demo').replace(/[^\w.-]/g, '') || 'demo';
      const back = url.searchParams.get('return') ?? '/app/';
      res.writeHead(302, {
        'set-cookie': `demo_session=${user}; Path=/; SameSite=Lax`,
        location: back.startsWith('/') && !back.startsWith('//') ? back : '/app/',
      });
      return res.end();
    }
    // Tests and manual checks: end the session, so the app sends the person to sign in again.
    if (path === '/auth/expire') {
      res.writeHead(200, {
        'set-cookie': 'demo_session=expired; Path=/; SameSite=Lax',
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end('Session expired');
    }
    // SPA routes under /app/ fall back to the shell (history API routing).
    if (path === '/app' || path.startsWith('/app/')) {
      const asset = safePath(ROOT, path);
      if (asset && extname(asset)) return sendFile(res, asset);
      if (cookie(req, 'demo_session') === 'expired') {
        const callback = `http://${req.headers.host}/auth/callback?return=${encodeURIComponent(path + url.search)}`;
        res.writeHead(302, {
          location: `http://127.0.0.1:${xoriginPort}/idp/?prompt=login&return=${encodeURIComponent(callback)}`,
        });
        return res.end();
      }
      return sendFile(res, join(ROOT, 'app', 'index.html'));
    }
    const file = safePath(ROOT, path);
    if (!file) {
      res.writeHead(400);
      return res.end();
    }
    return sendFile(res, file);
  };
}

function xoriginHandler() {
  return async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    // `/idp/` is the mock identity provider's page; anything else is the widget and its files.
    const file = safePath(
      XORIGIN_ROOT,
      path === '/' ? '/widget.html' : path.endsWith('/') ? `${path}index.html` : path,
    );
    if (!file) {
      res.writeHead(400);
      return res.end();
    }
    return sendFile(res, file);
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

/**
 * Start both servers. Port 0 picks free ports (used by tests).
 * @returns {Promise<{ port: number, xoriginPort: number, url: string, close: () => Promise<void> }>}
 */
export async function startDemoApp({ port = 5173, xoriginPort = 5174, host = '127.0.0.1' } = {}) {
  const xServer = createServer(xoriginHandler());
  const actualXPort = await listen(xServer, xoriginPort, host);
  const mServer = createServer(mainHandler(actualXPort));
  const actualPort = await listen(mServer, port, host);
  const close = () =>
    Promise.all([
      new Promise((r) => mServer.close(() => r())),
      new Promise((r) => xServer.close(() => r())),
    ]).then(() => undefined);
  return {
    port: actualPort,
    xoriginPort: actualXPort,
    url: `http://localhost:${actualPort}`,
    close,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const port = Number(process.env.DEMO_PORT ?? 5173);
  const xoriginPort = Number(process.env.DEMO_XORIGIN_PORT ?? 5174);
  const app = await startDemoApp({ port, xoriginPort });
  console.log(`ShowSteps demo app:   ${app.url}`);
  console.log(`Cross-origin widget:  http://127.0.0.1:${app.xoriginPort}`);
}
