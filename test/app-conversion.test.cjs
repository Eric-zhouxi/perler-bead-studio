const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const strategies = require('../conversion-strategies.js');

class ClassList {
  constructor(names = []) {
    this.names = new Set(names);
  }

  add(name) { this.names.add(name); }
  remove(name) { this.names.delete(name); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const active = force === undefined ? !this.names.has(name) : Boolean(force);
    if (active) this.names.add(name);
    else this.names.delete(name);
    return active;
  }
}

class ElementStub {
  constructor(id = '', classes = []) {
    this.id = id;
    this.classList = new ClassList(classes);
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.children = [];
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.width = 640;
    this.height = 640;
    this._span = { textContent: '' };
  }

  append(...children) { this.children.push(...children); }
  after() {}
  click() { this.onclick?.(); }
  querySelector(selector) { return selector === 'span' ? this._span : null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
}

function buildPixels() {
  const width = 50;
  const height = 50;
  const data = new Uint8ClampedArray(width * height * 4);
  const setPixel = (x, y, hex) => {
    const value = parseInt(hex.slice(1), 16);
    const offset = (y * width + x) * 4;
    data[offset] = value >> 16;
    data[offset + 1] = value >> 8 & 255;
    data[offset + 2] = value & 255;
    data[offset + 3] = 255;
  };
  const fillRect = (x, y, w, h, hex) => {
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) setPixel(px, py, hex);
    }
  };

  fillRect(0, 0, width, height, '#e4c8ba');
  fillRect(25, 0, 25, 7, '#f6d4cb');
  fillRect(0, 44, 25, 6, '#f8c0a9');
  fillRect(3, 8, 18, 35, '#4e2f35');
  fillRect(27, 8, 20, 16, '#42304e');
  fillRect(27, 28, 20, 15, '#3c465c');

  const boundaryNoise = [
    [24, 2, '#f5c9ca'], [25, 4, '#fad4bf'], [23, 45, '#f1c4a5'], [25, 47, '#f2d8c1'],
    [24, 6, '#fcc6ac'], [26, 6, '#c4b3bb'], [22, 44, '#f5c9ca'], [26, 44, '#fad4bf'],
  ];
  boundaryNoise.forEach(([x, y, color]) => setPixel(x, y, color));
  [[7, 14, '#77544e'], [12, 20, '#69494c'], [16, 34, '#76575a'], [8, 39, '#644b51']]
    .forEach(([x, y, color]) => setPixel(x, y, color));
  return data;
}

function loadStudio(pixelData) {
  const elements = new Map();
  const createElement = (id, classes = []) => {
    const element = new ElementStub(id, classes);
    elements.set(id, element);
    return element;
  };
  const context2d = {
    save() {}, restore() {}, fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillText() {}, strokeText() {}, translate() {}, rotate() {}, arc() {}, fill() {}, drawImage() {},
    getImageData() { return { data: pixelData }; },
  };
  const canvas = createElement('beadCanvas');
  canvas.getContext = () => context2d;
  ['gridWidth', 'gridHeight'].forEach(id => { createElement(id).value = '50'; });
  createElement('variantSwitcher', ['hidden']);
  createElement('editBtn', ['hidden']);
  createElement('editState', ['hidden']);
  createElement('previewWrap', ['hidden']);
  createElement('emptyState');
  createElement('uploadZone', ['upload-zone']);
  createElement('imagePanel', ['image-panel']);
  createElement('canvasFooter', ['canvas-footer']);
  const ids = [
    'clearBtn', 'undoBtn', 'redoBtn', 'previewBtn', 'gridBtn', 'zoomOut', 'zoomIn', 'zoomLabel', 'beadTotal',
    'usedColors', 'gridInfo', 'projectTitle', 'commonPalette', 'palette', 'paletteCount', 'allPaletteCount', 'legend',
    'imageInput', 'imagePreview', 'removeImage', 'saveBtn', 'startCreate', 'toast',
  ];
  ids.forEach(id => { if (!elements.has(id)) createElement(id); });

  const variantButtons = Array.from({ length: 3 }, (_, index) => {
    const button = new ElementStub(`variant${index}`);
    button.dataset.patternVariant = String(index);
    button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
    return button;
  });
  const paletteButtons = [221, 291].map(size => {
    const button = new ElementStub(`palette${size}`);
    button.dataset.paletteSize = String(size);
    return button;
  });
  const modeButtons = ['image', 'create'].map(mode => {
    const button = new ElementStub(`mode-${mode}`, ['mode']);
    button.dataset.mode = mode;
    if (mode === 'image') button.classList.add('active');
    return button;
  });

  const document = {
    head: new ElementStub('head'),
    getElementById(id) { return elements.get(id) || createElement(id); },
    createElement(tag) {
      const element = new ElementStub(tag);
      if (tag === 'canvas') element.getContext = () => context2d;
      return element;
    },
    querySelector(selector) {
      if (selector === '.upload-zone') return elements.get('uploadZone');
      if (selector === '.image-panel') return elements.get('imagePanel');
      if (selector === '.canvas-footer') return elements.get('canvasFooter');
      return new ElementStub(selector);
    },
    querySelectorAll(selector) {
      if (selector === '[data-pattern-variant]') return variantButtons;
      if (selector === '[data-palette-size]') return paletteButtons;
      if (selector === '.mode') return modeButtons;
      return [];
    },
  };
  document.head.insertAdjacentHTML = () => {};

  const context = {
    console,
    document,
    DouhuiConversionStrategies: strategies,
    Image: class ImageStub {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    setTimeout,
    clearTimeout,
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const paletteSource = fs.readFileSync('./palette.js', 'utf8');
  const appSource = fs.readFileSync('./app.js', 'utf8');
  const testApi = `
    ;globalThis.__studioTest = {
      prepareSource() { source = { naturalWidth: 50, naturalHeight: 50 }; },
      convert,
      editCell(x, y, code) { beads[y][x] = paletteData.find(item => item[0] === code); },
      selectPatternVariant,
      startFreshCreate,
      startImageMode,
      state() {
        const usage = colorCounts();
        return {
          variantCount: patternVariants.length,
          selectedPatternVariant,
          usage,
          singletonColors: usage.filter(([, count]) => count === 1).length,
          beads: beads.map(row => row.map(entry => entry?.[0] || null)),
          activeMode,
          hasContent: usedBeads().length > 0,
        };
      },
    };
  `;
  vm.runInContext(`${paletteSource}\n${appSource}\n${testApi}`, context);
  return { api: context.__studioTest, context, elements, modeButtons, variantButtons };
}

test('the real app generates three selectable conversion variants', () => {
  const studio = loadStudio(buildPixels());
  studio.api.prepareSource();
  studio.api.convert();

  const original = studio.api.state();
  assert.equal(original.variantCount, 3);
  assert.equal(original.selectedPatternVariant, 0);
  assert.equal(studio.elements.get('variantSwitcher').classList.contains('hidden'), false);
  assert.equal(studio.variantButtons[0].getAttribute('aria-pressed'), 'true');

  studio.api.selectPatternVariant(1, false);
  const cleaned = studio.api.state();
  assert.equal(cleaned.selectedPatternVariant, 1);
  assert.ok(cleaned.singletonColors < original.singletonColors, `${cleaned.singletonColors} should be less than ${original.singletonColors}`);

  studio.api.selectPatternVariant(2, false);
  const deep = studio.api.state();
  assert.equal(deep.selectedPatternVariant, 2);
  assert.equal(deep.beads[25][5], 'F11');
  assert.equal(deep.beads[15][35], 'D10');
  assert.equal(deep.beads[35][35], 'C12');

  studio.elements.get('editBtn').click();
  studio.api.editCell(0, 0, 'A1');
  studio.elements.get('editBtn').click();
  assert.ok(studio.variantButtons.every(button => !button.disabled));

  studio.api.selectPatternVariant(0, false);
  assert.equal(studio.api.state().selectedPatternVariant, 0);
  studio.api.selectPatternVariant(2, false);
  const restoredEdit = studio.api.state();
  assert.equal(restoredEdit.selectedPatternVariant, 2);
  assert.equal(restoredEdit.beads[0][0], 'A1');
});

test('image canvas tools require an uploaded image before rendering', () => {
  const studio = loadStudio(buildPixels());
  const toast = studio.elements.get('toast');
  const zoomLabel = studio.elements.get('zoomLabel');
  const gridButton = studio.elements.get('gridBtn');
  const previewButton = studio.elements.get('previewBtn');

  ['previewBtn', 'gridBtn', 'zoomIn', 'zoomOut'].forEach(id => {
    toast.textContent = '';
    studio.elements.get(id).click();
    assert.equal(toast.textContent, '请先上传图片', `${id} should request an image`);
  });

  assert.equal(zoomLabel.textContent, '');
  assert.equal(gridButton.classList.contains('active'), false);
  assert.equal(previewButton.classList.contains('active'), false);
});

test('leaving a drawing for image mode asks first, then restores the landing state', () => {
  const studio = loadStudio(buildPixels());
  studio.api.startFreshCreate();
  studio.api.editCell(0, 0, 'A1');
  let requests = 0;
  studio.context.accountManager = {
    requestImageMode() {
      requests += 1;
      return true;
    },
  };

  studio.modeButtons.find(button => button.dataset.mode === 'image').click();
  assert.equal(requests, 1);
  assert.equal(studio.api.state().hasContent, true, 'the drawing must remain until the user chooses');

  studio.api.startImageMode();
  const state = studio.api.state();
  assert.equal(state.activeMode, 'image');
  assert.equal(state.beads.length, 0);
  assert.equal(studio.elements.get('beadCanvas').classList.contains('hidden'), true);
  assert.equal(studio.elements.get('emptyState').classList.contains('hidden'), false);
  assert.equal(studio.elements.get('gridInfo').textContent, '等待创建图纸');
});
