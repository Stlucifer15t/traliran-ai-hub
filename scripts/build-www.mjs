// Copies the static web app into ./www (the directory Capacitor packages).
// Root files are left untouched so GitHub Pages / Docker keep working.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const f of readdirSync(root)) {
  if (/\.(html|js|css|webmanifest|png|svg|ico)$/.test(f)) copyFileSync(join(root, f), join(www, f));
}
if (existsSync(join(root, 'assets'))) cpSync(join(root, 'assets'), join(www, 'assets'), { recursive: true });
if (!existsSync(join(root, 'vendor'))) throw new Error('vendor/ missing - run npm run build:vendor first');
cpSync(join(root, 'vendor'), join(www, 'vendor'), { recursive: true });

// Monaco is large (13 MB) so it is never committed; copy it into the package only.
const monacoVs = join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
if (existsSync(monacoVs)) cpSync(monacoVs, join(www, 'vendor', 'monaco', 'vs'), { recursive: true });

console.log('www/ built');
