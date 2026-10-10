// Copies the offline OCR engine (U8) into an app's public folder: the tesseract.js worker, the
// WebAssembly cores (plain, SIMD and relaxed-SIMD LSTM builds; the worker picks one) and the
// English model. Nothing is fetched from the internet at run time.
// Usage: node scripts/copy-ocr.mjs <destination folder>
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const dest = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/copy-ocr.mjs <destination folder>');

// Resolve from the ui package, which depends on tesseract.js.
const fromUi = createRequire(new URL('../packages/ui/package.json', import.meta.url));
const tesseract = dirname(fromUi.resolve('tesseract.js/package.json'));
const fromTesseract = createRequire(join(tesseract, 'package.json'));
const core = dirname(fromTesseract.resolve('tesseract.js-core/package.json'));
const fromRoot = createRequire(new URL('../package.json', import.meta.url));
const eng = dirname(fromRoot.resolve('@tesseract.js-data/eng/package.json'));

const files = [
  [join(tesseract, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map(
    (n) => [join(core, `${n}.wasm.js`), `${n}.wasm.js`],
  ),
  [join(eng, '4.0.0_best_int', 'eng.traineddata.gz'), 'eng.traineddata.gz'],
];

mkdirSync(dest, { recursive: true });
let bytes = 0;
for (const [from, name] of files) {
  const to = join(dest, name);
  copyFileSync(from, to);
  bytes += statSync(to).size;
}
console.log(`OCR engine copied to ${dest} (${(bytes / 1e6).toFixed(1)} MB)`);
