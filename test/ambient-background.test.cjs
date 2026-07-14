const test = require('node:test');
const assert = require('node:assert/strict');
const ambient = require('../ambient-background.js');

function createClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); },
  };
}

function createHost(reduced = false) {
  const listeners = new Map();
  const mediaListeners = new Map();
  const frames = new Map();
  const timers = new Map();
  let nextFrame = 0;
  let nextTimer = 0;

  const field = {
    dataset: {},
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
  };
  const magnet = { classList: createClassList(), style: {} };
  const document = {
    getElementById(id) {
      if (id === 'ambientField') return field;
      if (id === 'ambientMagnet') return magnet;
      return null;
    },
    createElement() {
      return {
        className: '',
        style: {},
        addEventListener() {},
        remove() {
          if (!this.parentNode) return;
          const index = this.parentNode.children.indexOf(this);
          if (index >= 0) this.parentNode.children.splice(index, 1);
          this.parentNode = null;
        },
      };
    },
  };
  const media = {
    matches: reduced,
    addEventListener(type, handler) { mediaListeners.set(type, handler); },
    removeEventListener(type) { mediaListeners.delete(type); },
  };
  const host = {
    document,
    matchMedia: () => media,
    requestAnimationFrame(handler) {
      const id = ++nextFrame;
      frames.set(id, handler);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(handler) {
      const id = ++nextTimer;
      timers.set(id, handler);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
  };
  return { field, frames, host, listeners, magnet, mediaListeners, timers };
}

test('magnet transform centers the lightweight effect on the pointer', () => {
  assert.equal(ambient.MAGNET_SIZE, 240);
  assert.equal(ambient.magnetTransform(120, 120), 'translate3d(0.0px, 0.0px, 0) rotate(0.00deg)');
  assert.match(ambient.magnetTransform(300, 200, 3), /translate3d\(180\.0px, 80\.0px, 0\) rotate\(3\.00deg\)/);
});

test('pointer movement schedules one composited update and click pulses stay bounded', () => {
  const fixture = createHost();
  const controller = ambient.init(fixture.host);
  assert.ok(controller);
  assert.equal(fixture.field.dataset.ambientReady, 'true');

  fixture.listeners.get('pointermove')({ clientX: 100, clientY: 80, pointerType: 'mouse' });
  fixture.listeners.get('pointermove')({ clientX: 220, clientY: 150, pointerType: 'mouse' });
  assert.equal(fixture.frames.size, 1, 'coalesces pointer events into one animation frame');
  assert.equal(fixture.magnet.classList.contains('is-visible'), true);

  const [frameId, render] = fixture.frames.entries().next().value;
  fixture.frames.delete(frameId);
  render();
  assert.match(fixture.magnet.style.transform, /^translate3d\(/);

  for (let index = 0; index < 5; index++) {
    fixture.listeners.get('pointerdown')({ clientX: 40 + index, clientY: 50, pointerType: 'mouse' });
  }
  assert.equal(fixture.field.children.length, ambient.MAX_PULSES);
  assert.equal(ambient.MAX_PULSES, 3);

  controller.destroy();
  assert.equal(fixture.field.dataset.ambientReady, undefined);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.field.children.length, 0);
});

test('touch tracking is skipped and reduced-motion mode uses no animation frames or pulses', () => {
  const fixture = createHost(true);
  const controller = ambient.init(fixture.host);
  fixture.listeners.get('pointermove')({ clientX: 90, clientY: 70, pointerType: 'touch' });
  assert.equal(fixture.magnet.classList.contains('is-visible'), false);

  fixture.listeners.get('pointermove')({ clientX: 90, clientY: 70, pointerType: 'mouse' });
  fixture.listeners.get('pointerdown')({ clientX: 90, clientY: 70, pointerType: 'mouse' });
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.field.children.length, 0);
  assert.match(fixture.magnet.style.transform, /^translate3d\(/);

  controller.destroy();
  assert.equal(fixture.mediaListeners.size, 0);
});
