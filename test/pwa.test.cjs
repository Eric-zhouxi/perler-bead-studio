const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pwa = require('../pwa.js');

class ClassList {
  constructor(...names) { this.names = new Set(names); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const active = force === undefined ? !this.names.has(name) : Boolean(force);
    active ? this.add(name) : this.remove(name);
    return active;
  }
}

class Target {
  constructor(...classes) { this.classList = new ClassList(...classes); this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  dispatch(type, event = {}) { return this.listeners.get(type)?.(event); }
}

test('install prompt is captured and accepted through the app button', async () => {
  const button = new Target('hidden');
  const root = new Target();
  let registered = '';
  let prompted = 0;
  root.document = { getElementById: id => id === 'pwaInstallBtn' ? button : null };
  root.matchMedia = () => ({ matches: false });
  root.location = { protocol: 'https:', hostname: 'example.com' };
  root.navigator = {
    userAgent: 'Desktop Browser',
    serviceWorker: { register: async url => { registered = url; } }
  };

  pwa.install(root);
  assert.equal(button.classList.contains('hidden'), false);
  await Promise.resolve();
  assert.equal(registered, './sw.js');

  root.dispatch('beforeinstallprompt', {
    preventDefault() {},
    prompt() { prompted += 1; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  await button.dispatch('click');
  assert.equal(prompted, 1);
  assert.equal(button.classList.contains('hidden'), true);
});

test('Apple install guidance uses the in-app notice without a duplicate alert', async () => {
  const button = new Target();
  const root = new Target();
  const notices = [];
  let alerts = 0;
  root.document = { getElementById: () => button };
  root.matchMedia = () => ({ matches: false });
  root.location = { protocol: 'https:', hostname: 'example.com' };
  root.navigator = { userAgent: 'iPhone' };
  root.studioApi = { notify: message => notices.push(message) };
  root.alert = () => { alerts += 1; };

  pwa.install(root);
  await button.dispatch('click');
  assert.deepEqual(notices, ['请点击浏览器“分享”，再选择“添加到主屏幕”']);
  assert.equal(alerts, 0);
});

test('manifest, icons, cache shell, and install metadata are complete', () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  manifest.icons.forEach(icon => assert.ok(fs.existsSync(path.join(root, icon.src))));
  assert.ok(fs.existsSync(path.join(root, 'icons/apple-touch-icon.png')));
  assert.match(html, /rel="manifest" href="manifest\.webmanifest\?v=1\.1\.0"/);
  assert.match(html, /id="pwaInstallBtn"/);
  assert.match(html, /pwa\.js\?v=installable-app-20260715/);
  assert.match(worker, /request\.mode === 'navigate' \? navigationResponse\(request\) : staticResponse\(request\)/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  manifest.icons.forEach(icon => assert.match(worker, new RegExp(icon.src.replace(/[.-]/g, '\\$&'))));
});
