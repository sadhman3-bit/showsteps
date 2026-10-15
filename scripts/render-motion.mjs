// Renders docs/promo/motion.html to docs/promo/showsteps-promo.webm (and .mp4 when the browser
// can encode H.264), frame by frame, so the video is smooth whatever the machine's speed.
// Run: pnpm motion            (needs `pnpm setup:browsers` once)
//      pnpm motion --stills 1,4.2,9.8   (PNG frames at those seconds, into docs/promo/stills/)
/* global document, window, MediaRecorder, MediaStream, createImageBitmap -- browser code inside page.evaluate */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
const { chromium } = await import('@playwright/test');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'promo');
const FPS = 30;

// Serve the repo on 127.0.0.1 so the page's fonts load (browsers refuse fonts from file://).
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
};
const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root) || !existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/docs/promo/motion.html#capture`);
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);
const frameAt = async (t, type = 'jpeg') => {
  await page.evaluate((s) => window.seek(s), t);
  return page.screenshot(type === 'png' ? { type } : { type, quality: 95 });
};

const stillsArg = process.argv.indexOf('--stills');
if (stillsArg > 0) {
  const dir = join(out, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const t of process.argv[stillsArg + 1].split(',').map(Number))
    writeFileSync(join(dir, `t${t.toFixed(1)}.png`), await frameAt(t, 'png'));
  console.log(`Stills in ${dir}`);
} else {
  const ffmpegDir = join(root, 'node_modules', '.pnpm');
  const core = readdirSync(ffmpegDir).find((d) => d.startsWith('playwright-core@'));
  const browsers = join(ffmpegDir, core, 'node_modules', 'playwright-core', '.local-browsers');
  const ff = join(
    browsers,
    readdirSync(browsers).find((d) => d.startsWith('ffmpeg')),
    'ffmpeg-win64.exe',
  );
  const webm = join(out, 'showsteps-promo.webm');
  const enc = spawn(
    ff,
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-c:v',
      'mjpeg',
      '-framerate',
      String(FPS),
      '-i',
      'pipe:0',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '24',
      '-row-mt',
      '1',
      '-deadline',
      'good',
      '-cpu-used',
      '2',
      '-pix_fmt',
      'yuv420p',
      webm,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const frames = Math.round(duration * FPS);
  const jpgs = [];
  for (let i = 0; i < frames; i++) {
    const jpg = await frameAt(i / FPS);
    jpgs.push(jpg);
    if (!enc.stdin.write(jpg)) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  const code = await new Promise((r) => enc.on('close', r));
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  console.log(`Video: ${webm} (${frames} frames)`);

  // MP4 for apps that do not play WebM: the browser's H.264 recorder, fed the same frames on a
  // canvas at a steady FPS (the recorder timestamps frames by the clock, so pacing matters).
  const mp4Type = await page.evaluate(
    () =>
      ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4'].find((t) =>
        MediaRecorder.isTypeSupported(t),
      ) ?? '',
  );
  if (!mp4Type) console.log('MP4: this browser cannot record H.264; only the WebM was written.');
  else {
    await page.evaluate(() => {
      document.body.innerHTML = '<canvas width="1280" height="720"></canvas>';
      window.frames_ = [];
    });
    for (let i = 0; i < jpgs.length; i += 30)
      await page.evaluate(
        (batch) => {
          for (const b64 of batch)
            window.frames_.push(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        },
        jpgs.slice(i, i + 30).map((b) => b.toString('base64')),
      );
    const bytes = await page.evaluate(
      async ({ type, fps }) => {
        const canvas = document.querySelector('canvas');
        const ctx = canvas.getContext('2d');
        const track = canvas.captureStream(0).getVideoTracks()[0];
        const rec = new MediaRecorder(new MediaStream([track]), {
          mimeType: type,
          videoBitsPerSecond: 8_000_000,
        });
        const chunks = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const stopped = new Promise((r) => (rec.onstop = r));
        const decode = (u8) => createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
        let next = await decode(window.frames_[0]);
        rec.start();
        const t0 = performance.now();
        for (let i = 0; i < window.frames_.length; i++) {
          const wait = t0 + (i * 1000) / fps - performance.now();
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          ctx.drawImage(next, 0, 0);
          track.requestFrame();
          next.close();
          if (i + 1 < window.frames_.length) next = await decode(window.frames_[i + 1]);
        }
        await new Promise((r) => setTimeout(r, 1000 / fps));
        rec.stop();
        await stopped;
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
      },
      { type: mp4Type, fps: FPS },
    );
    writeFileSync(join(out, 'showsteps-promo.mp4'), progressiveMp4(Buffer.from(bytes)));
    console.log(`Video: ${join(out, 'showsteps-promo.mp4')}`);
  }
}
await browser.close();
server.close();

/**
 * The browser writes fragmented MP4 (no overall duration), which many players and phones show
 * as a few seconds long. Rewrite it as a plain MP4: one moov with a full sample table, then the
 * samples. Single video track only, which is all MediaRecorder produces here.
 */
function progressiveMp4(src) {
  const boxes = (from, to) => {
    const list = [];
    for (let i = from; i < to;) {
      const size = src.readUInt32BE(i);
      list.push({ type: src.toString('latin1', i + 4, i + 8), start: i, size, body: i + 8 });
      i += size;
    }
    return list;
  };
  const child = (box, type) => boxes(box.body, box.start + box.size).find((b) => b.type === type);
  const raw = (box) => src.subarray(box.start, box.start + box.size);
  const top = boxes(0, src.length);
  const trak = child(
    top.find((b) => b.type === 'moov'),
    'trak',
  );
  const tkhd = child(trak, 'tkhd');
  const mdia = child(trak, 'mdia');
  const mdhd = child(mdia, 'mdhd');
  const minf = child(mdia, 'minf');
  const stsd = child(child(minf, 'stbl'), 'stsd');
  const timescale = src.readUInt32BE(mdhd.body + (src[mdhd.body] === 1 ? 20 : 12));
  const width = src.readUInt32BE(tkhd.start + tkhd.size - 8);
  const height = src.readUInt32BE(tkhd.start + tkhd.size - 4);

  const sizes = [];
  const durations = [];
  const syncs = [];
  const data = [];
  for (const moof of top.filter((b) => b.type === 'moof')) {
    const traf = child(moof, 'traf');
    const tfhd = child(traf, 'tfhd');
    const tfFlags = src.readUInt32BE(tfhd.body) & 0xffffff;
    let p = tfhd.body + 8 + (tfFlags & 1 ? 8 : 0) + (tfFlags & 2 ? 4 : 0);
    const defDuration = tfFlags & 8 ? src.readUInt32BE(p) : 0;
    p += tfFlags & 8 ? 4 : 0;
    const defSize = tfFlags & 0x10 ? src.readUInt32BE(p) : 0;
    p += tfFlags & 0x10 ? 4 : 0;
    const defFlags = tfFlags & 0x20 ? src.readUInt32BE(p) : 0;
    const trun = child(traf, 'trun');
    const flags = src.readUInt32BE(trun.body) & 0xffffff;
    const count = src.readUInt32BE(trun.body + 4);
    let q = trun.body + 8;
    let offset = moof.start;
    if (flags & 1) {
      offset += src.readInt32BE(q);
      q += 4;
    }
    let firstFlags = null;
    if (flags & 4) {
      firstFlags = src.readUInt32BE(q);
      q += 4;
    }
    for (let s = 0; s < count; s++) {
      const dur = flags & 0x100 ? src.readUInt32BE(q) : defDuration;
      q += flags & 0x100 ? 4 : 0;
      const size = flags & 0x200 ? src.readUInt32BE(q) : defSize;
      q += flags & 0x200 ? 4 : 0;
      let sf = s === 0 && firstFlags !== null ? firstFlags : defFlags;
      if (flags & 0x400) {
        sf = src.readUInt32BE(q);
        q += 4;
      }
      q += flags & 0x800 ? 4 : 0;
      if (!(sf & 0x10000)) syncs.push(sizes.length + 1);
      sizes.push(size);
      durations.push(dur);
      data.push(src.subarray(offset, offset + size));
      offset += size;
    }
  }
  const total = durations.reduce((a, b) => a + b, 0);

  const u32 = (...n) => {
    const b = Buffer.alloc(4 * n.length);
    n.forEach((v, i) => b.writeUInt32BE(v >>> 0, i * 4));
    return b;
  };
  const box = (type, ...parts) => {
    const body = Buffer.concat(parts);
    return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]);
  };
  const full = (type, version, flags, ...parts) =>
    box(type, u32((version << 24) | flags), ...parts);
  const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const ms = Math.round((total / timescale) * 1000);
  const stts = [];
  for (const d of durations)
    if (stts.length && stts[stts.length - 1][1] === d) stts[stts.length - 1][0]++;
    else stts.push([1, d]);

  const moov = (chunkOffset) =>
    box(
      'moov',
      full(
        'mvhd',
        0,
        0,
        u32(0, 0, 1000, ms, 0x10000),
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        matrix,
        Buffer.alloc(24),
        u32(2),
      ),
      box(
        'trak',
        full('tkhd', 0, 3, u32(0, 0, 1, 0, ms, 0, 0, 0, 0), matrix, u32(width, height)),
        box(
          'mdia',
          full('mdhd', 0, 0, u32(0, 0, timescale, total), Buffer.from([0x55, 0xc4, 0, 0])),
          raw(child(mdia, 'hdlr')),
          box(
            'minf',
            raw(child(minf, 'vmhd')),
            raw(child(minf, 'dinf')),
            box(
              'stbl',
              raw(stsd),
              full('stts', 0, 0, u32(stts.length, ...stts.flat())),
              full('stss', 0, 0, u32(syncs.length, ...syncs)),
              full('stsc', 0, 0, u32(1, 1, sizes.length, 1)),
              full('stsz', 0, 0, u32(0, sizes.length, ...sizes)),
              full('stco', 0, 0, u32(1, chunkOffset)),
            ),
          ),
        ),
      ),
    );
  const ftyp = box(
    'ftyp',
    Buffer.from('isom', 'latin1'),
    u32(0x200),
    Buffer.from('isomiso2avc1mp41', 'latin1'),
  );
  const head = ftyp.length + moov(0).length + 8;
  const mdat = box('mdat', ...data);
  return Buffer.concat([ftyp, moov(head), mdat]);
}
