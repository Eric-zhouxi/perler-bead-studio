const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const manual = require('../manual.js');

class ClassList {
  constructor(...names) { this.names = new Set(names); }
  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
}

class Target {
  constructor(...classes) {
    this.classList = new ClassList(...classes);
    this.listeners = new Map();
    this.attributes = new Map();
    this.focusCount = 0;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ target: this, ...event }); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  focus() { this.focusCount += 1; }
}

test('manual opens accessibly and closes with Escape while restoring focus', () => {
  const openButton = new Target();
  const closeButton = new Target();
  const modal = new Target('hidden');
  modal.querySelectorAll = () => [closeButton];
  const body = new Target();
  const documentRef = new Target();
  documentRef.body = body;
  documentRef.activeElement = openButton;
  documentRef.getElementById = id => ({ manualBtn: openButton, manualModal: modal })[id];

  const destroy = manual.install(documentRef);
  openButton.dispatch('click');
  assert.equal(modal.classList.contains('hidden'), false);
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.equal(body.classList.contains('manual-open'), true);
  assert.equal(closeButton.focusCount, 1);

  documentRef.dispatch('keydown', { key: 'Escape' });
  assert.equal(modal.classList.contains('hidden'), true);
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(body.classList.contains('manual-open'), false);
  assert.equal(openButton.focusCount, 1);
  destroy();
});

test('manual includes every major workflow and versioned assets', () => {
  const html = fs.readFileSync('./index.html', 'utf8');
  const css = fs.readFileSync('./manual.css', 'utf8');
  assert.match(html, /id="manualBtn"/);
  assert.match(html, /id="manualModal"[^>]*aria-hidden="true"/);
  assert.match(html, /manual\.css\?v=detailed-guide-20260715/);
  assert.match(html, /manual\.js\?v=detailed-guide-20260715/);
  ['manualQuickStart', 'manualInstall', 'manualImage', 'manualVariants', 'manualEdit', 'manualCreate', 'manualExport', 'manualAccount', 'manualFaq']
    .forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /版本 1 · 原始识别/);
  assert.match(html, /版本 2 · 净色优化/);
  assert.match(html, /版本 3 · 深色增强/);
  assert.match(css, /@media \(max-width: 800px\)/);
});
