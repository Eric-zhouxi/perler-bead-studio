const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('conversion strategies load before the app and expose exactly three version controls', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  assert.ok(html.indexOf('id="ambientField"') < html.indexOf('class="app-shell"'));
  assert.ok(html.indexOf('ambient-background.js') < html.indexOf('app.js'));
  assert.match(html, /<div[^>]*id="ambientField"[^>]*aria-hidden="true"/);
  assert.match(html, /id="ambientMagnet"/);
  assert.ok(html.indexOf('conversion-strategies.js') < html.indexOf('app.js'));
  assert.equal((html.match(/data-pattern-variant=/g) || []).length, 3);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML ids must remain unique');
});

test('version controls retain hidden, active, locked, and mobile layout rules', () => {
  const style = fs.readFileSync('./style.css', 'utf8');
  const auth = fs.readFileSync('./auth.css', 'utf8');
  assert.match(style, /\.variant-switcher\.hidden\{display:none\}/);
  assert.match(style, /\.variant-switcher button\.active\{/);
  assert.match(style, /\.variant-switcher\.locked button:not\(\.active\)\{/);
  assert.match(style, /@media\(max-width:800px\)\{\.variant-switcher\{justify-content:flex-start\}\}/);
  assert.match(auth, /\.canvas-toolbar\s*\{[^}]*flex-wrap:\s*wrap;/s);
  assert.match(auth, /\.canvas-toolbar \.tool-buttons\s*\{[^}]*width:\s*100%;/s);
});

test('ambient field remains behind the application and only animates composited properties', () => {
  const style = fs.readFileSync('./style.css', 'utf8');
  const ambientStyle = fs.readFileSync('./ambient-background.css', 'utf8');
  assert.match(style, /body\{[^}]*isolation:isolate;/);
  assert.match(ambientStyle, /\.ambient-field\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*0;[^}]*contain:\s*strict;[^}]*pointer-events:\s*none;/s);
  assert.match(ambientStyle, /\.ambient-magnet\s*\{[^}]*will-change:\s*transform, opacity;/s);
  assert.match(ambientStyle, /\.ambient-pulse\s*\{[^}]*animation:\s*ambient-bead-pulse/s);
  assert.match(style, /\.app-shell\{[^}]*position:relative;[^}]*z-index:1(?:;|})/);
});
