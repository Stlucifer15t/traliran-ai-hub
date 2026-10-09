/*
 * presets.js - prompt templates and project presets for the mobile/IDE flow.
 * Presets are plain file maps: { path: content }. Applying one writes files
 * through the normal VFS, so they are versioned and undoable like any edit.
 */
(function (g) {
    'use strict';

    const PROMPT_TEMPLATES = [
        { id: 'plan-app', label: 'Plan an app', text: 'Plan first (numbered steps, no code yet): build a {{what}} for {{who}}. List the files you will create and how they connect.' },
        { id: 'fix-error', label: 'Fix an error', text: 'The preview reports this error. Find the cause, fix it with the smallest edit, and explain in two sentences:\n{{error}}' },
        { id: 'add-feature', label: 'Add a feature', text: 'Add this feature to the current project, editing existing files where possible: {{feature}}' },
        { id: 'make-responsive', label: 'Make mobile-friendly', text: 'Make the current project work well on a phone (320px to 430px wide): larger touch targets, no horizontal scrolling, readable text.' },
        { id: 'screenshot', label: 'Screenshot to code', text: 'Recreate the attached screenshot as one self-contained index.html (inline CSS and JS, no external dependencies). Match layout, spacing and colours.' },
        { id: 'review', label: 'Review my code', text: 'Review the pinned and mentioned files for bugs, security issues and unclear code. Report findings first, then propose minimal edits.' }
    ];

    const PRESETS = [
        {
            id: 'landing',
            label: 'Landing page',
            description: 'Single-page marketing site with hero, features and a contact form.',
            files: {
                'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Product</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="hero">
    <nav><strong>My Product</strong><a href="#contact">Contact</a></nav>
    <h1>Build something people love</h1>
    <p>A short line that explains what you offer and who it is for.</p>
    <a class="cta" href="#contact">Get started</a>
  </header>
  <section class="features">
    <article><h3>Fast</h3><p>Short, clear benefit.</p></article>
    <article><h3>Simple</h3><p>Short, clear benefit.</p></article>
    <article><h3>Yours</h3><p>Short, clear benefit.</p></article>
  </section>
  <section id="contact" class="contact">
    <h2>Contact</h2>
    <form id="contactForm">
      <input name="email" type="email" placeholder="you@example.com" required>
      <textarea name="message" placeholder="Message" rows="3"></textarea>
      <button type="submit">Send</button>
    </form>
    <p id="thanks" hidden>Thanks, we will be in touch.</p>
  </section>
  <script src="script.js"></script>
</body>
</html>
`,
                'styles.css': `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#0b0b0f;color:#f5f5f5}
.hero{min-height:80vh;display:flex;flex-direction:column;justify-content:center;padding:24px;background:radial-gradient(circle at top,#134e4a,#0b0b0f 60%)}
nav{display:flex;justify-content:space-between;margin-bottom:auto}nav a{color:#6ee7b7}
h1{font-size:clamp(2rem,6vw,3.5rem);margin:.5rem 0}.cta{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#34d399;color:#022c22;text-decoration:none;font-weight:700}
.features{display:grid;gap:16px;padding:32px 24px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.features article{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:20px}
.contact{padding:32px 24px}form{display:grid;gap:12px;max-width:420px}
input,textarea,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #374151;background:#111827;color:inherit}button{background:#34d399;color:#022c22;font-weight:700;border:0}
`,
                'script.js': `document.getElementById('contactForm').addEventListener('submit', (e) => {
  e.preventDefault();
  e.target.hidden = true;
  document.getElementById('thanks').hidden = false;
});
`
            }
        },
        {
            id: 'game',
            label: 'Browser game',
            description: 'Canvas game with keyboard and touch controls and a score.',
            files: {
                'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Mini Game</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="hud"><span id="score">0</span> points</div>
  <canvas id="game" width="320" height="480"></canvas>
  <div id="controls"><button data-dir="-1">◀</button><button data-dir="1">▶</button></div>
  <script src="game.js"></script>
</body>
</html>
`,
                'style.css': `body{margin:0;background:#050505;color:#f5f5f5;font-family:system-ui;display:flex;flex-direction:column;align-items:center;min-height:100vh;user-select:none}
#hud{padding:12px;font-size:20px}canvas{background:#0b1220;border-radius:12px;max-width:100vw;height:auto}
#controls{display:flex;gap:16px;padding:12px}#controls button{font-size:28px;width:84px;height:64px;border-radius:16px;border:0;background:#1f2937;color:#fff;touch-action:manipulation}
`,
                'game.js': `const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
let player = { x: 140, y: 440, w: 40, h: 12, speed: 6 };
let touchDir = 0, score = 0, drops = [], running = true;
const keys = {};
addEventListener('keydown', e => keys[e.key] = true);
addEventListener('keyup', e => keys[e.key] = false);
document.querySelectorAll('[data-dir]').forEach(b => {
  const set = () => touchDir = Number(b.dataset.dir);
  b.addEventListener('pointerdown', set);
  b.addEventListener('pointerup', () => touchDir = 0);
  b.addEventListener('pointerleave', () => touchDir = 0);
});
function spawn() { drops.push({ x: Math.random() * (canvas.width - 16), y: -16, r: 8 + Math.random() * 6 }); }
function update() {
  const keyDir = (keys['ArrowRight'] ? 1 : 0) - (keys['ArrowLeft'] ? 1 : 0);
  const dir = keyDir || touchDir;
  player.x = Math.max(0, Math.min(canvas.width - player.w, player.x + dir * player.speed));
  if (Math.random() < 0.03) spawn();
  drops.forEach(d => d.y += 3 + score / 20);
  drops = drops.filter(d => {
    if (d.y > player.y && d.y < player.y + player.h && d.x > player.x - d.r && d.x < player.x + player.w + d.r) { score++; scoreEl.textContent = score; return false; }
    return d.y < canvas.height + 20;
  });
}
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#34d399'; ctx.fillRect(player.x, player.y, player.w, player.h);
  ctx.fillStyle = '#fbbf24'; drops.forEach(d => { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill(); });
}
function loop() { if (running) { update(); draw(); requestAnimationFrame(loop); } }
loop();
`
            }
        },
        {
            id: 'tool',
            label: 'Small tool',
            description: 'Single-purpose utility with input, output and copy button.',
            files: {
                'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tool</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>Text tool</h1>
    <textarea id="input" placeholder="Paste text here"></textarea>
    <div class="row"><button id="upper">UPPERCASE</button><button id="count">Count</button><button id="copy">Copy</button></div>
    <pre id="output"></pre>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
                'styles.css': `body{margin:0;font-family:system-ui;background:#0b0b0f;color:#f5f5f5}main{max-width:640px;margin:auto;padding:16px}
textarea{width:100%;min-height:160px;padding:12px;border-radius:12px;border:1px solid #374151;background:#111827;color:inherit;font:inherit}
.row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}button{padding:12px 16px;border-radius:10px;border:0;background:#34d399;color:#022c22;font-weight:700}
pre{white-space:pre-wrap;background:#111827;padding:12px;border-radius:12px;min-height:48px}
`,
                'app.js': `const $ = id => document.getElementById(id);
const out = text => { $('output').textContent = text; };
$('upper').onclick = () => out($('input').value.toUpperCase());
$('count').onclick = () => {
  const t = $('input').value;
  out('Characters: ' + t.length + '\\nWords: ' + (t.trim() ? t.trim().split(/\\s+/).length : 0));
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText($('output').textContent);
  out('Copied.');
};
`
            }
        },
        {
            id: 'pwa',
            label: 'PWA (installable)',
            description: 'Installable offline-capable app with manifest and service worker.',
            files: {
                'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#000000">
  <title>My PWA</title>
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main>
    <h1>My PWA</h1>
    <p id="status">Loading…</p>
    <button id="install" hidden>Install app</button>
  </main>
  <script src="app.js"></script>
</body>
</html>
`,
                'manifest.webmanifest': `{
  "name": "My PWA",
  "short_name": "PWA",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [{ "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }]
}
`,
                'icon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/><path d="M256 96l48 112 120 12-92 80 28 118-104-62-104 62 28-118-92-80 120-12z" fill="#34d399"/></svg>
`,
                'styles.css': `body{margin:0;font-family:system-ui;background:#000;color:#f5f5f5;min-height:100vh}main{padding:24px}button{padding:12px 16px;border-radius:12px;border:0;background:#34d399;color:#022c22;font-weight:700}`,
                'app.js': `let deferredPrompt = null;
const status = document.getElementById('status');
const installBtn = document.getElementById('install');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(() => { status.textContent = 'Ready offline.'; });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; installBtn.hidden = false; });
installBtn.onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt = null; installBtn.hidden = true; };
`,
                'sw.js': `const CACHE = 'app-v1';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
`
            }
        }
    ];

    /** Replaces {{placeholders}} in a template; unknown keys stay as written. */
    function fillTemplate(text, values) {
        return String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (values && values[k] != null ? String(values[k]) : m));
    }

    g.HubPresets = { PROMPT_TEMPLATES, PRESETS, fillTemplate };
})(typeof window !== 'undefined' ? window : globalThis);
