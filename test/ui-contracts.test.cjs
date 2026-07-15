const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('conversion strategies load before the app and expose exactly three version controls', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.ok(html.indexOf('id="ambientCanvas"') < html.indexOf('class="app-shell"'));
  assert.ok(html.indexOf('ripple-background.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('button-motion.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('manual.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('pwa.js') < html.indexOf('app.js'));
  assert.match(html, /button-motion\.css\?v=elastic-buttons-20260715/);
  assert.match(html, /button-motion\.js\?v=elastic-buttons-20260715/);
  assert.match(html, /ripple-background\.js\?v=default-on-20260714/, 'the default-on behavior must bypass stale cached scripts');
  assert.doesNotMatch(html, /ambient-background\\.js/, 'the retired script name must not be reused because browsers may cache an incompatible version');
  assert.match(html, /<canvas[^>]*id="ambientCanvas"[^>]*aria-hidden="true"/);
  assert.match(html, /id="ambientToggle"[^>]*aria-pressed="false"/);
  assert.ok(html.indexOf('conversion-strategies.js') < html.indexOf('app.js'));
  assert.match(html, /conversion-strategies\.js\?v=neutral-black-20260714/, 'the neutral-black matcher must bypass stale cached strategies');
  assert.match(html, /app\.js\?v=canvas-tool-guard-20260715/, 'canvas tool guards must bypass stale cached app scripts');
  assert.equal((html.match(/data-pattern-variant=/g) || []).length, 3);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML ids must remain unique');
});

test('version controls retain hidden, active, and mobile layout rules', () => {
  const style = fs.readFileSync('./style.css', 'utf8');
  const auth = fs.readFileSync('./auth.css', 'utf8');
  assert.match(style, /\.variant-switcher\.hidden\{display:none\}/);
  assert.match(style, /\.variant-switcher button\.active\{/);
  assert.match(style, /@media\(max-width:800px\)\{\.variant-switcher\{justify-content:flex-start\}\}/);
  assert.match(auth, /\.canvas-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(auth, /\.canvas-toolbar \.tool-buttons\s*\{[^}]*width:\s*100%;/s);
});

test('canvas toolbar tooltips remain above the drawing area', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const style = fs.readFileSync('./style.css', 'utf8');
  assert.match(html, /style\.css\?v=tooltip-up-20260715/);
  assert.match(style, /\.canvas-toolbar\{position:relative;z-index:10;overflow:visible\}/);
  assert.match(style, /\.canvas-stage\{z-index:1\}/);
  assert.match(style, /\.tool-buttons button\[data-tooltip\]:after\{top:auto;bottom:calc\(100% \+ 8px\);z-index:30;/);
});

test('ambient canvas remains behind the application and never captures interaction', () => {
  const style = fs.readFileSync('./style.css', 'utf8');
  assert.match(style, /body\{[^}]*isolation:isolate;/);
  assert.match(style, /\.ambient-canvas\{[^}]*position:fixed;[^}]*z-index:0;[^}]*pointer-events:none(?:;|})/);
  assert.match(style, /\.app-shell\{[^}]*position:relative;[^}]*z-index:1(?:;|})/);
});
