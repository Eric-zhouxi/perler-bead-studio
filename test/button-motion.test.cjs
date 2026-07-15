const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../button-motion.js');

test('button motion adds one elastic confirmation and cleans up', () => {
  const documentListeners = new Map();
  const buttonListeners = new Map();
  const classes = new Set();
  const dataset = {};
  const button = {
    disabled: false,
    offsetWidth: 42,
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); },
    },
    addEventListener(type, handler) { buttonListeners.set(type, handler); },
  };
  const document = {
    documentElement: { dataset },
    addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); },
  };

  const controller = motion.install({ document });
  assert.ok(controller);
  assert.equal(dataset.buttonMotionReady, 'true');

  documentListeners.get('click')({ target: { closest: () => button } });
  assert.equal(classes.has(motion.CONFIRM_CLASS), true);
  buttonListeners.get('animationend')();
  assert.equal(classes.has(motion.CONFIRM_CLASS), false);

  controller.destroy();
  assert.equal(dataset.buttonMotionReady, undefined);
  assert.equal(documentListeners.size, 0);
});

test('disabled buttons do not animate', () => {
  const listeners = new Map();
  const classes = new Set();
  const document = {
    documentElement: { dataset: {} },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener() {},
  };
  const controller = motion.install({ document });
  listeners.get('click')({
    target: {
      closest: () => ({
        disabled: true,
        classList: { add(value) { classes.add(value); }, remove() {} },
      }),
    },
  });
  assert.equal(classes.size, 0);
  controller.destroy();
});

test('motion stylesheet includes hover, selected color, and reduced-motion states', () => {
  const css = require('node:fs').readFileSync('./button-motion.css', 'utf8');
  assert.match(css, /--button-spring:\s*cubic-bezier/);
  assert.match(css, /button:not\(:disabled\):hover/);
  assert.match(css, /\.palette-entry \.swatch\.selected/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

