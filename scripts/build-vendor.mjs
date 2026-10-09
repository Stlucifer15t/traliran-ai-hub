// Builds the locally bundled third-party assets into ./vendor so the app
// works offline (GitHub Pages, Docker and the Android APK all use these).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const nm = (...p) => join(root, 'node_modules', ...p);
const out = join(root, 'vendor');

mkdirSync(out, { recursive: true });

// 1. Tailwind CSS (compiled, scanned from the app's own HTML/JS).
execFileSync(nm('.bin', 'tailwindcss'), [
  '-i', join(root, 'src', 'tailwind.css'),
  '-o', join(out, 'tailwind.css'),
  '--minify'
], { cwd: root, stdio: 'inherit' });

// 2. marked (UMD build exposes window.marked).
copyFileSync(nm('marked', 'lib', 'marked.umd.js'), join(out, 'marked.umd.js'));

// 3. pdf.js 3.x (exposes window.pdfjsLib) + its worker.
copyFileSync(nm('pdfjs-dist', 'build', 'pdf.min.js'), join(out, 'pdf.min.js'));
copyFileSync(nm('pdfjs-dist', 'build', 'pdf.worker.min.js'), join(out, 'pdf.worker.min.js'));

// 4. CodeMirror 6 bundle for the mobile editor (window.CM).
await build({
  entryPoints: [join(root, 'src', 'cm-entry.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: join(out, 'codemirror.bundle.js'),
  logLevel: 'warning'
});

console.log('vendor/ built');
