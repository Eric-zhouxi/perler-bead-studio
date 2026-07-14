const test = require('node:test');
const assert = require('node:assert/strict');
const ambient = require('../ambient-background.js');

test('glyph fields are deterministic and cover the viewport at a stable density', () => {
  const first = ambient.createGlyphField(300, 180, 30, 42);
  const second = ambient.createGlyphField(300, 180, 30, 42);
  assert.deepEqual(first, second);
  assert.equal(first.length, 77);
  assert.ok(first.every(item => ambient.GLYPHS[item.glyphIndex]));
  assert.ok(first.every(item => item.baseAlpha >= .012 && item.baseAlpha <= .03));
});

test('animation work is bounded for high-density displays and pointer effects', () => {
  assert.equal(ambient.MAX_PIXEL_RATIO, 1.5);
  assert.ok(ambient.MAX_RIPPLES <= 4);
  assert.ok(ambient.MAX_TRAILS <= 8);
});

test('pointer reveal is strongest at the cursor and fades to zero outside its radius', () => {
  const pointer = { x: 100, y: 100, active: true };
  assert.equal(ambient.pointerInfluence({ x: 100, y: 100 }, pointer), 1);
  assert.ok(ambient.pointerInfluence({ x: 120, y: 100 }, pointer) > 0);
  assert.equal(ambient.pointerInfluence({ x: 100 + ambient.POINTER_RADIUS, y: 100 }, pointer), 0);
  assert.equal(ambient.pointerInfluence({ x: 100, y: 100 }, { ...pointer, active: false }), 0);
});

test('ripple influence peaks around the expanding wavefront and expires cleanly', () => {
  const ripple = { x: 0, y: 0, strength: 1, startedAt: 0 };
  const halfway = ambient.RIPPLE_LIFETIME / 2;
  assert.ok(ambient.rippleInfluence({ x: ambient.FLOW_RIPPLE_RADIUS / 2, y: 0 }, ripple, halfway) > 0);
  assert.ok(Math.abs(ambient.rippleInfluence({ x: 0, y: 0 }, ripple, halfway)) < .001);
  assert.equal(ambient.rippleInfluence({ x: 140, y: 0 }, ripple, ambient.RIPPLE_LIFETIME), 0);
});

test('tap ripple sends a stronger wavefront outward with a secondary ring', () => {
  const ripple = { x: 0, y: 0, strength: 1, startedAt: 0, kind: 'tap' };
  const quarter = ambient.RIPPLE_LIFETIME / 4;
  const halfway = ambient.RIPPLE_LIFETIME / 2;
  const firstRadius = ambient.TAP_RIPPLE_RADIUS / 4;
  const secondRadius = ambient.TAP_RIPPLE_RADIUS / 2;
  const firstWave = ambient.rippleInfluence({ x: firstRadius, y: 0 }, ripple, quarter);
  const secondWave = ambient.rippleInfluence({ x: secondRadius, y: 0 }, ripple, halfway);
  const oldPosition = ambient.rippleInfluence({ x: firstRadius, y: 0 }, ripple, halfway);
  const flowWave = ambient.rippleInfluence(
    { x: ambient.FLOW_RIPPLE_RADIUS / 2, y: 0 },
    { ...ripple, kind: 'flow' },
    halfway,
  );
  assert.ok(firstWave > 0);
  assert.ok(secondWave > 0);
  assert.ok(Math.abs(secondWave) > Math.abs(oldPosition));
  assert.ok(secondWave > flowWave);
});

test('trail influence keeps moving forward with inertia and fades after its lifetime', () => {
  const trail = { x: 0, y: 0, vx: .6, vy: 0, strength: 1, startedAt: 0 };
  const moving = ambient.trailInfluence({ x: 120, y: 0 }, trail, 500);
  assert.ok(moving.x > 100);
  assert.equal(moving.directionX, 1);
  assert.equal(moving.directionY, 0);
  assert.ok(moving.weight > 0);
  assert.ok(ambient.trailInfluence({ x: 185, y: 0 }, trail, 1800)?.weight > 0);
  assert.equal(ambient.trailInfluence({ x: 120, y: 0 }, trail, ambient.TRAIL_LIFETIME), null);
});

test('glyph state becomes brighter and moves when the pointer and ripple are nearby', () => {
  const glyph = ambient.createGlyphField(40, 40, 30, 7)[0];
  const calm = ambient.calculateGlyphState(glyph, { active: false }, [], 500);
  const active = ambient.calculateGlyphState(
    glyph,
    { x: glyph.x, y: glyph.y, active: true },
    [{ x: glyph.x - 20, y: glyph.y, strength: 1, startedAt: 0 }],
    500,
  );
  assert.ok(active.alpha > calm.alpha);
  assert.ok(active.size > calm.size);
  assert.ok(active.x !== calm.x || active.y !== calm.y);
  assert.ok(ambient.GLYPHS.includes(active.character));
});

test('a moving trail leaves a brighter displaced wake after the pointer has gone', () => {
  const glyph = { ...ambient.createGlyphField(80, 40, 30, 9)[1], x: 120, y: 0 };
  const calm = ambient.calculateGlyphState(glyph, { active: false }, [], 500);
  const trailing = ambient.calculateGlyphState(
    glyph,
    { active: false },
    [],
    500,
    [{ x: 0, y: 0, vx: .6, vy: 0, strength: 1, startedAt: 0 }],
  );
  assert.ok(trailing.alpha > calm.alpha);
  assert.ok(trailing.x > calm.x);
  assert.ok(trailing.size > calm.size);
});

test('reduced-motion initialization renders once, caps pixel density, and cleans up', () => {
  const listeners = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const drawCalls = [];
  const transforms = [];
  const context = {
    setTransform(...args) { transforms.push(args); },
    clearRect() {},
    fillText(...args) { drawCalls.push(args); },
    set textAlign(value) { this._textAlign = value; },
    set textBaseline(value) { this._textBaseline = value; },
    set fillStyle(value) { this._fillStyle = value; },
    set font(value) { this._font = value; },
  };
  const canvas = { dataset: {}, width: 0, height: 0, getContext: () => context };
  const media = {
    matches: true,
    addEventListener(type, handler) { mediaListeners.set(type, handler); },
    removeEventListener(type) { mediaListeners.delete(type); },
  };
  const document = {
    hidden: false,
    getElementById: id => id === 'ambientCanvas' ? canvas : null,
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  const host = {
    document,
    innerWidth: 320,
    innerHeight: 180,
    devicePixelRatio: 3,
    performance: { now: () => 500 },
    matchMedia: () => media,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); },
  };

  const controller = ambient.init(host);
  assert.ok(controller);
  assert.equal(canvas.width, 480);
  assert.equal(canvas.height, 270);
  assert.deepEqual(transforms[0], [1.5, 0, 0, 1.5, 0, 0]);
  assert.ok(drawCalls.length > 0);
  assert.equal(canvas.dataset.ambientReady, 'true');

  const beforeMove = drawCalls.length;
  listeners.get('pointermove')({ clientX: 80, clientY: 70 });
  assert.ok(drawCalls.length > beforeMove);

  const beforePointerDown = drawCalls.length;
  listeners.get('pointerdown')({ clientX: 90, clientY: 75 });
  assert.ok(drawCalls.length > beforePointerDown);

  const beforeTouch = drawCalls.length;
  assert.ok(listeners.has('touchstart'));
  listeners.get('touchstart')({ touches: [{ clientX: 100, clientY: 80 }] });
  assert.ok(drawCalls.length > beforeTouch);
  assert.ok(listeners.has('touchend'));
  listeners.get('touchend')();

  controller.destroy();
  assert.equal(canvas.dataset.ambientReady, undefined);
  assert.equal(mediaListeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(listeners.size, 0);
});

test('initialization exits cleanly when a 2D canvas context is unavailable', () => {
  const canvas = { dataset: {}, getContext: () => null };
  const controller = ambient.init({ document: { getElementById: () => canvas } });
  assert.equal(controller, null);
  assert.equal(canvas.dataset.ambientReady, undefined);
});

test('interaction toggle defaults off, persists the choice, and releases the canvas when disabled', () => {
  const hostListeners = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const toggleListeners = new Map();
  const stored = new Map();
  const canvasClasses = new Set(['ambient-canvas', 'hidden']);
  const toggleClasses = new Set();
  const attributes = new Map();
  const context = {
    setTransform() {},
    clearRect() {},
    fillText() {},
    set textAlign(value) { this._textAlign = value; },
    set textBaseline(value) { this._textBaseline = value; },
    set fillStyle(value) { this._fillStyle = value; },
    set font(value) { this._font = value; },
  };
  const canvas = {
    classList: {
      add(value) { canvasClasses.add(value); },
      remove(value) { canvasClasses.delete(value); },
    },
    dataset: {},
    width: 300,
    height: 150,
    getContext: () => context,
  };
  const toggle = {
    dataset: {},
    classList: {
      toggle(value, force) {
        if (force) toggleClasses.add(value);
        else toggleClasses.delete(value);
      },
    },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(type, handler) { toggleListeners.set(type, handler); },
    removeEventListener(type) { toggleListeners.delete(type); },
  };
  const media = {
    matches: true,
    addEventListener(type, handler) { mediaListeners.set(type, handler); },
    removeEventListener(type) { mediaListeners.delete(type); },
  };
  const document = {
    hidden: false,
    getElementById(id) {
      if (id === 'ambientCanvas') return canvas;
      if (id === 'ambientToggle') return toggle;
      return null;
    },
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); },
  };
  const host = {
    document,
    innerWidth: 320,
    innerHeight: 180,
    devicePixelRatio: 1,
    performance: { now: () => 500 },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
    },
    matchMedia: () => media,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    addEventListener(type, handler) { hostListeners.set(type, handler); },
    removeEventListener(type) { hostListeners.delete(type); },
  };

  const manager = ambient.install(host);
  assert.ok(manager);
  assert.equal(manager.enabled, false);
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(canvas.dataset.ambientReady, undefined);
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);

  toggleListeners.get('click')();
  assert.equal(manager.enabled, true);
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.equal(canvas.dataset.ambientReady, 'true');
  assert.equal(canvasClasses.has('hidden'), false);
  assert.equal(toggleClasses.has('active'), true);
  assert.equal(stored.get(ambient.STORAGE_KEY), 'true');

  toggleListeners.get('click')();
  assert.equal(manager.enabled, false);
  assert.equal(canvas.dataset.ambientReady, undefined);
  assert.equal(canvasClasses.has('hidden'), true);
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
  assert.equal(stored.get(ambient.STORAGE_KEY), 'false');

  manager.destroy();
  assert.equal(toggle.dataset.ambientToggleReady, undefined);
  assert.equal(toggleListeners.size, 0);
});
