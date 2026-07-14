const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const strategies = require('../conversion-strategies.js');

const BASE = ['BASE', '#7a4c50'];
const NOISE = ['NOISE', '#83575a'];
const ACCENT = ['ACCENT', '#2466cf'];
const LINE = ['LINE', '#202020'];
const DEEP = ['DEEP', '#6f3038'];
const MUTED = ['MUTED', '#69494c'];

function filledGrid(width, height, color) {
  return Array(width * height).fill(color);
}

test('cleanSpeckles merges a low-distance singleton into a supported neighbor color', () => {
  const cells = filledGrid(5, 5, BASE);
  cells[12] = NOISE;
  const result = strategies.cleanSpeckles(cells, { width: 5, height: 5 });
  assert.equal(result[12], BASE);
  assert.equal(strategies.colorCounts(result).has('NOISE'), false);
  assert.equal(cells[12], NOISE, 'the original strategy result must remain untouched');
});

test('cleanSpeckles preserves a high-contrast singleton that may be intentional detail', () => {
  const cells = filledGrid(5, 5, BASE);
  cells[12] = ACCENT;
  const result = strategies.cleanSpeckles(cells, { width: 5, height: 5 });
  assert.equal(result[12], ACCENT);
});

test('cleanSpeckles never rewrites protected line pixels', () => {
  const cells = filledGrid(3, 3, BASE);
  cells[4] = LINE;
  const lineMask = Array(9).fill(false);
  lineMask[4] = true;
  const result = strategies.cleanSpeckles(cells, { width: 3, height: 3, lineMask });
  assert.equal(result[4], LINE);
});

test('deep matcher keeps chromatic dark pixels out of a neutral gray', () => {
  const palette = [
    ['GRAY', '#545454'],
    ['RED', '#71363d'],
    ['LIGHT_RED', '#9b777a'],
    ['BLACK', '#202020'],
  ];
  const matcher = strategies.createDeepColorMatcher(palette);
  assert.equal(matcher([82, 55, 58])[0], 'RED');
  assert.equal(matcher([78, 79, 78])[0], 'GRAY');
});

test('deep matcher preserves hue using the real MARD 221 palette', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fs.readFileSync('./palette.js', 'utf8')}\n;globalThis.palette=MARD_PALETTES[221];`, context);
  const matcher = strategies.createDeepColorMatcher(context.palette);
  assert.equal(matcher([78, 48, 52])[0], 'F11');
  assert.equal(matcher([66, 48, 78])[0], 'D10');
  assert.equal(matcher([58, 59, 58])[0], 'H5');
});

test('consolidateDeepRegions absorbs a rare muted intermediate into the dominant deep color', () => {
  const cells = filledGrid(5, 5, DEEP);
  cells[12] = MUTED;
  const result = strategies.consolidateDeepRegions(cells, { width: 5, height: 5 });
  assert.equal(result[12], DEEP);
  assert.equal(cells[12], MUTED);
});
