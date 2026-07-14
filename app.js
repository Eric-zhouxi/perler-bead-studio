let paletteSize = 221;
let paletteData = MARD_PALETTES[paletteSize];
let codes = paletteData.map(([id]) => id);
const COMMON_COLOR_IDS = ['H1', 'H7', 'H3', 'H4', 'H6', 'A4', 'A6', 'A10', 'B4', 'B8', 'C4', 'C8', 'D6', 'D10', 'E4', 'E6', 'F3', 'F5', 'G4', 'G8'];
const $ = id => document.getElementById(id);
const canvas = $('beadCanvas');
const ctx = canvas.getContext('2d');
const WATERMARK = 'ERIC_ZHOU · PERLER STUDIO';
const BRAND = 'ERIC_ZHOU · 豆绘';
let W = 50, H = 50, beads = [], selected = paletteData[0], zoom = 1, source, grid = true, showColorNumbers = true, history = [], redoHistory = [], timer, editLocked = false;
let renderCell = 16, renderGutter = 0;
let patternVariants = [], selectedPatternVariant = 0, deepColorMatcher;
const VARIANT_LABELS = ['原始识别', '净色优化', '深色增强'];

const cap = (v, a, b) => Math.max(a, Math.min(b, v));
const cloneBeads = value => value.map(row => row.slice());
const usedBeads = () => beads.flat().filter(Boolean);

const hexToRgb = hex => {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16, value >> 8 & 255, value & 255];
};

function rgbToLab([r, g, b]) {
  const linear = value => {
    const channel = value / 255;
    return channel > .04045 ? ((channel + .055) / 1.055) ** 2.4 : channel / 12.92;
  };
  r = linear(r);
  g = linear(g);
  b = linear(b);
  const x = (r * .4124 + g * .3576 + b * .1805) / .95047;
  const y = (r * .2126 + g * .7152 + b * .0722);
  const z = (r * .0193 + g * .1192 + b * .9505) / 1.08883;
  const pivot = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luminance = rgb => rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
let p = [];
let darkPalette = [];
let paletteById = new Map();

function rebuildPaletteMatcher() {
  codes = paletteData.map(([id]) => id);
  p = paletteData.map(item => [item, hexToRgb(item[1]), rgbToLab(hexToRgb(item[1]))]);
  darkPalette = p.filter(([, , lab]) => lab[0] < 38);
  paletteById = new Map(paletteData.map(item => [item[0], item]));
  deepColorMatcher = DouhuiConversionStrategies.createDeepColorMatcher(paletteData);
}

rebuildPaletteMatcher();
const nearLab = (lab, set = p) => set.reduce((best, item) => labDistance(lab, item[2]) < labDistance(lab, best[2]) ? item : best)[0];
const near = (rgb, set = p) => nearLab(rgbToLab(rgb), set);

function normalizeRgb(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const lightness = luminance(rgb);
  if (max < 28) return [0, 0, 0];
  if (min > 248 && spread < 8) return [255, 255, 255];
  if (spread < 8) {
    const gray = Math.round(lightness);
    return [gray, gray, gray];
  }
  return [r, g, b];
}

function colorCounts(list = usedBeads()) {
  const counts = new Map();
  list.forEach(c => counts.set(c[0], (counts.get(c[0]) || 0) + 1));
  return [...counts].sort(([a, countA], [b, countB]) => countB - countA || codes.indexOf(a) - codes.indexOf(b));
}

function textColor(fill) {
  const q = hexToRgb(fill);
  return (q[0] * 299 + q[1] * 587 + q[2] * 114) > 145000 ? '#20201e' : '#fff';
}

function setHistoryButtons() {
  const undo = $('undoBtn');
  const redo = $('redoBtn');
  if (undo) undo.disabled = editLocked || history.length === 0;
  if (redo) redo.disabled = editLocked || redoHistory.length === 0;
}

function setEditLocked(locked, showButton = false) {
  editLocked = locked;
  const button = $('editBtn');
  const state = $('editState');
  button.classList.toggle('hidden', !showButton);
  button.classList.toggle('editing', showButton && !locked);
  button.disabled = false;
  button.querySelector('span').textContent = locked ? '开始编辑' : '结束编辑';
  button.setAttribute('aria-label', locked ? '开始编辑图纸' : '结束编辑并锁定图纸');
  button.setAttribute('aria-pressed', String(showButton && !locked));
  if (state) {
    state.classList.toggle('hidden', !showButton);
    state.classList.toggle('editing', showButton && !locked);
    state.classList.toggle('locked', showButton && locked);
    state.textContent = locked ? '锁定状态' : '编辑状态';
  }
  $('clearBtn').disabled = locked;
  canvas.classList.toggle('edit-locked', locked);
  setHistoryButtons();
}

function resetHistory() {
  history = [];
  redoHistory = [];
  setHistoryButtons();
}

function updateVariantSwitcher() {
  const switcher = $('variantSwitcher');
  const available = patternVariants.length === VARIANT_LABELS.length;
  switcher.classList.toggle('hidden', !available);
  switcher.classList.remove('locked');
  document.querySelectorAll('[data-pattern-variant]').forEach(button => {
    const index = +button.dataset.patternVariant;
    const active = available && index === selectedPatternVariant;
    button.classList.toggle('active', active);
    button.disabled = !available;
    button.setAttribute('aria-pressed', String(active));
  });
}

function clearPatternVariants() {
  patternVariants = [];
  selectedPatternVariant = 0;
  updateVariantSwitcher();
}

function setPatternVariants(variants) {
  patternVariants = variants.map(cloneBeads);
  selectedPatternVariant = 0;
  beads = cloneBeads(patternVariants[0]);
  updateVariantSwitcher();
}

function saveSelectedPatternVariant() {
  if (patternVariants.length !== VARIANT_LABELS.length || !patternVariants[selectedPatternVariant]) return;
  patternVariants[selectedPatternVariant] = cloneBeads(beads);
}

function selectPatternVariant(index, notify = true) {
  if (!patternVariants[index] || index === selectedPatternVariant) return;
  saveSelectedPatternVariant();
  selectedPatternVariant = index;
  beads = cloneBeads(patternVariants[index]);
  resetHistory();
  updateVariantSwitcher();
  render();
  if (notify) showToast(`已切换至版本 ${index + 1} · ${VARIANT_LABELS[index]}`);
}

function pushHistory() {
  history.push(cloneBeads(beads));
  redoHistory = [];
  setHistoryButtons();
}

function drawNumbers(target, cell, highQuality = false) {
  const fontSize = Math.max(highQuality ? 14 : 5, Math.floor(cell * .46));
  target.save();
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  target.lineJoin = 'round';
  target.miterLimit = 2;
  target.font = `700 ${fontSize}px "DM Mono", Consolas, monospace`;
  target.lineWidth = Math.max(highQuality ? 2 : .75, fontSize * .14);
  beads.forEach((r, y) => r.forEach((b, x) => {
    if (!b) return;
    const fill = textColor(b[1]);
    target.strokeStyle = fill === '#fff' ? 'rgba(32,32,30,.72)' : 'rgba(255,255,255,.82)';
    target.fillStyle = fill;
    target.strokeText(b[0], x * cell + cell / 2, y * cell + cell / 2, cell * .86);
    target.fillText(b[0], x * cell + cell / 2, y * cell + cell / 2, cell * .86);
  }));
  target.restore();
}

function coordinateGutter(cell, highQuality = false) {
  return Math.max(highQuality ? 58 : 24, Math.ceil(cell * (highQuality ? 1.8 : 2.2)));
}

function patternMetrics(cell, options = {}) {
  const { showCoordinates = true, highQualityText = false } = options;
  const gutter = showCoordinates ? coordinateGutter(cell, highQualityText) : 0;
  return {
    gutter,
    gridX: gutter,
    gridY: gutter,
    gridWidth: W * cell,
    gridHeight: H * cell,
    width: W * cell + gutter * 2,
    height: H * cell + gutter * 2,
  };
}

function strokeGridLines(target, cell, major) {
  const width = major ? Math.max(2, Math.round(cell * .12)) : Math.max(1, Math.round(cell * .035));
  const nudge = width <= 1.5 ? .5 : 0;
  target.strokeStyle = major ? '#8b877e' : '#d5d3cc';
  target.lineWidth = width;
  target.beginPath();
  for (let x = 0; x <= W; x++) {
    if (major !== (x % 10 === 0 || x === W)) continue;
    const px = x * cell + nudge;
    target.moveTo(px, 0);
    target.lineTo(px, H * cell);
  }
  for (let y = 0; y <= H; y++) {
    if (major !== (y % 10 === 0 || y === H)) continue;
    const py = y * cell + nudge;
    target.moveTo(0, py);
    target.lineTo(W * cell, py);
  }
  target.stroke();
}

function drawGrid(target, cell) {
  target.save();
  strokeGridLines(target, cell, false);
  strokeGridLines(target, cell, true);
  target.restore();
}

function drawCoordinates(target, cell, gutter, highQuality = false) {
  const fontSize = Math.max(highQuality ? 16 : 4, Math.min(highQuality ? 22 : 10, Math.floor(cell * .72)));
  const gridW = W * cell;
  const gridH = H * cell;
  const bottom = gutter + gridH;
  const right = gutter + gridW;
  target.save();
  target.fillStyle = '#f5f3ee';
  target.fillRect(0, 0, gutter * 2 + gridW, gutter);
  target.fillRect(0, bottom, gutter * 2 + gridW, gutter);
  target.fillRect(0, 0, gutter, gutter * 2 + gridH);
  target.fillRect(right, 0, gutter, gutter * 2 + gridH);
  target.strokeStyle = '#c8c4ba';
  target.lineWidth = Math.max(1, Math.round(cell * .045));
  target.beginPath();
  target.moveTo(gutter, 0);
  target.lineTo(gutter, gutter * 2 + gridH);
  target.moveTo(right, 0);
  target.lineTo(right, gutter * 2 + gridH);
  target.moveTo(0, gutter);
  target.lineTo(gutter * 2 + gridW, gutter);
  target.moveTo(0, bottom);
  target.lineTo(gutter * 2 + gridW, bottom);
  target.stroke();
  target.fillStyle = '#5f5b54';
  target.font = `700 ${fontSize}px "DM Mono", Consolas, monospace`;
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  for (let x = 0; x < W; x++) {
    const label = String(x + 1);
    const cx = gutter + x * cell + cell / 2;
    target.fillText(label, cx, gutter / 2);
    target.fillText(label, cx, bottom + gutter / 2);
  }
  target.textAlign = 'right';
  for (let y = 0; y < H; y++) {
    const label = String(y + 1);
    const cy = gutter + y * cell + cell / 2;
    target.fillText(label, gutter - Math.max(5, cell * .32), cy);
    target.textAlign = 'left';
    target.fillText(label, right + Math.max(5, cell * .32), cy);
    target.textAlign = 'right';
  }
  target.restore();
}

function drawWatermarkOverlay(target, cell) {
  target.save();
  target.globalAlpha = .09;
  target.fillStyle = '#20201e';
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  target.font = `700 ${Math.max(18, Math.floor(cell * .72))}px "DM Mono", monospace`;
  target.translate(W * cell / 2, H * cell / 2);
  target.rotate(-Math.PI / 7);
  const stepX = Math.max(360, cell * 12);
  const stepY = Math.max(210, cell * 7);
  for (let y = -H * cell; y <= H * cell; y += stepY) {
    for (let x = -W * cell; x <= W * cell; x += stepX) {
      target.fillText(WATERMARK, x, y);
    }
  }
  target.restore();
}

function drawPattern(target, cell, options = {}) {
  const { showGrid = grid, showNumbers = true, watermark = false, highQualityText = false, showCoordinates = true } = options;
  const { gutter, width, height } = patternMetrics(cell, { showCoordinates, highQualityText });
  target.fillStyle = '#fff';
  target.fillRect(0, 0, width, height);
  target.save();
  target.translate(gutter, gutter);
  beads.forEach((r, y) => r.forEach((b, x) => {
    target.fillStyle = b?.[1] || '#fff';
    target.fillRect(x * cell, y * cell, cell, cell);
  }));
  if (watermark) drawWatermarkOverlay(target, cell);
  if (showGrid) drawGrid(target, cell);
  if (showNumbers) drawNumbers(target, cell, highQualityText);
  target.restore();
  if (showCoordinates) drawCoordinates(target, cell, gutter, highQualityText);
}

function render() {
  const c = cap(Math.round(900 / Math.max(W, H)), 6, 16) * zoom;
  const { width, height, gutter } = patternMetrics(c);
  renderCell = c;
  renderGutter = gutter;
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = 'auto';
  canvas.style.height = 'auto';
  drawPattern(ctx, c, { showNumbers: showColorNumbers });
  const a = usedBeads();
  $('beadTotal').textContent = a.length;
  $('usedColors').textContent = new Set(a.map(x => x[0])).size;
  $('gridInfo').textContent = `${W} × ${H} 格`;
  legend(a);
  setHistoryButtons();
}

function legend(list) {
  let box = $('legend');
  if (!box) {
    box = document.createElement('section');
    box.id = 'legend';
    document.querySelector('.canvas-footer').after(box);
  }
  box.innerHTML = `<div class="legend-head"><strong>用色清单</strong><span>${BRAND}</span></div><div class="legend-list">${colorCounts(list).map(([id, count]) => {
    const c = paletteData.find(x => x[0] === id);
    return `<div class="legend-item"><i style="background:${c[1]}"></i><b>${id}</b><small>${count} 颗</small></div>`;
  }).join('')}</div><p class="watermark">${WATERMARK}</p>`;
}

function blank(w = +$('gridWidth').value, h = +$('gridHeight').value) {
  W = cap(w, 16, 200);
  H = cap(h, 16, 200);
  clearPatternVariants();
  beads = Array.from({ length: H }, () => Array(W).fill(null));
  setEditLocked(false);
  resetHistory();
  render();
}

function readSourcePixels() {
  const t = document.createElement('canvas');
  t.width = W;
  t.height = H;
  const x = t.getContext('2d');
  const s = Math.min(W / source.naturalWidth, H / source.naturalHeight);
  const w = Math.max(1, Math.round(source.naturalWidth * s));
  const h = Math.max(1, Math.round(source.naturalHeight * s));
  const offsetX = Math.floor((W - w) / 2);
  const offsetY = Math.floor((H - h) / 2);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, offsetX, offsetY, w, h);
  const d = x.getImageData(0, 0, W, H).data;
  const pixels = [];
  const activeMask = [];
  for (let i = 0; i < d.length; i += 4) {
    pixels.push([d[i], d[i + 1], d[i + 2]]);
    activeMask.push(d[i + 3] > 24);
  }
  return { pixels, activeMask };
}

function detectLineMask(colors, activeMask) {
  const levels = colors.filter((_, i) => activeMask[i]).map(luminance).sort((a, b) => a - b);
  const lowerLevel = levels[Math.floor(levels.length * .18)] || 0;
  const darkThreshold = cap(lowerLevel + 18, 52, 112);
  const mask = Array(colors.length).fill(false);
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && activeMask[y * W + x];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!activeMask[i]) continue;
      const current = luminance(colors[i]);
      const currentLab = rgbToLab(colors[i]);
      const chroma = Math.hypot(currentLab[1], currentLab[2]);
      let brightestNeighbor = current;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !at(x + dx, y + dy)) continue;
          brightestNeighbor = Math.max(brightestNeighbor, luminance(colors[(y + dy) * W + x + dx]));
        }
      }
      const neutralDark = current < 72 && chroma < 18;
      const contrastingEdge = current < darkThreshold && brightestNeighbor - current > 24;
      mask[i] = neutralDark || contrastingEdge;
    }
  }
  const closed = mask.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!activeMask[i] || mask[i]) continue;
      const horizontal = x > 0 && x < W - 1 && mask[i - 1] && mask[i + 1];
      const vertical = y > 0 && y < H - 1 && mask[i - W] && mask[i + W];
      if (horizontal || vertical) closed[i] = true;
    }
  }
  return closed;
}

function detectDeepLineMask(colors, activeMask) {
  const levels = colors.filter((_, i) => activeMask[i]).map(luminance).sort((a, b) => a - b);
  const lowerLevel = levels[Math.floor(levels.length * .18)] || 0;
  const darkThreshold = cap(lowerLevel + 12, 45, 96);
  const mask = Array(colors.length).fill(false);
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && activeMask[y * W + x];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!activeMask[i]) continue;
      const current = luminance(colors[i]);
      const currentLab = rgbToLab(colors[i]);
      const chroma = Math.hypot(currentLab[1], currentLab[2]);
      let brightestNeighbor = current;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !at(x + dx, y + dy)) continue;
          brightestNeighbor = Math.max(brightestNeighbor, luminance(colors[(y + dy) * W + x + dx]));
        }
      }
      const neutralDark = current < 58 && chroma < 10;
      const contrastingEdge = current < darkThreshold && brightestNeighbor - current > 32;
      mask[i] = neutralDark || contrastingEdge;
    }
  }
  const closed = mask.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!activeMask[i] || mask[i]) continue;
      const horizontal = x > 0 && x < W - 1 && mask[i - 1] && mask[i + 1];
      const vertical = y > 0 && y < H - 1 && mask[i - W] && mask[i + W];
      if (horizontal || vertical) closed[i] = true;
    }
  }
  return closed;
}

function dominantLineColor(colors, lineMask) {
  const counts = new Map();
  colors.forEach((rgb, i) => {
    if (!lineMask[i]) return;
    const item = luminance(rgb) < 30 ? paletteById.get('H7') : near(rgb, darkPalette);
    counts.set(item[0], (counts.get(item[0]) || 0) + 1);
  });
  const id = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  return id ? paletteById.get(id) : paletteById.get('H7');
}

function smoothBeadRegions(converted, activeMask, lineMask) {
  const out = converted.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!activeMask[i] || lineMask[i]) continue;
      const counts = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          const ni = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !activeMask[ni] || lineMask[ni]) continue;
          const id = converted[ni]?.[0];
          if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 5 && best[0] !== converted[i]?.[0]) out[i] = paletteById.get(best[0]);
    }
  }
  return out;
}

function convert() {
  if (!source) return;
  W = cap(+$('gridWidth').value, 16, 200);
  H = cap(+$('gridHeight').value, 16, 200);
  const { pixels, activeMask } = readSourcePixels();
  const colors = pixels.map(normalizeRgb);
  const lineMask = detectLineMask(colors, activeMask);
  const lineColor = dominantLineColor(colors, lineMask);
  const converted = colors.map((rgb, i) => !activeMask[i] ? null : lineMask[i] ? lineColor : near(rgb));
  const smoothed = smoothBeadRegions(converted, activeMask, lineMask);
  const strategyOptions = { width: W, height: H, activeMask, lineMask };
  const cleaned = DouhuiConversionStrategies.cleanSpeckles(smoothed, strategyOptions);
  const deepLineMask = detectDeepLineMask(colors, activeMask);
  const deepLineColor = dominantLineColor(colors, deepLineMask);
  const deepStrategyOptions = { width: W, height: H, activeMask, lineMask: deepLineMask };
  const deepConverted = colors.map((rgb, i) => !activeMask[i] ? null : deepLineMask[i] ? deepLineColor : deepColorMatcher(rgb));
  const deepSmoothed = smoothBeadRegions(deepConverted, activeMask, deepLineMask);
  const deepCleaned = DouhuiConversionStrategies.cleanSpeckles(deepSmoothed, deepStrategyOptions);
  const deepConsolidated = DouhuiConversionStrategies.consolidateDeepRegions(deepCleaned, deepStrategyOptions);
  const toRows = flat => Array.from({ length: H }, (_, y) => flat.slice(y * W, (y + 1) * W));
  setPatternVariants([toRows(smoothed), toRows(cleaned), toRows(deepConsolidated)]);
  setEditLocked(true, true);
  resetHistory();
  $('emptyState').classList.add('hidden');
  $('projectTitle').textContent = '图片转拼豆图纸';
  render();
}

function draw(e) {
  const r = canvas.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * canvas.width - renderGutter;
  const py = (e.clientY - r.top) / r.height * canvas.height - renderGutter;
  const x = Math.floor(px / renderCell);
  const y = Math.floor(py / renderCell);
  if (beads[y]?.[x] !== undefined) {
    beads[y][x] = selected;
    render();
  }
}

function palette() {
  const renderEntries = (container, colors) => {
    container.innerHTML = '';
    colors.forEach(c => {
      const wrap = document.createElement('div');
      wrap.className = 'palette-entry';
      const b = document.createElement('button');
      b.className = 'swatch' + (c === selected ? ' selected' : '');
      b.style.background = c[1];
      b.title = c[0];
      b.onclick = () => {
        selected = c;
        palette();
      };
      const label = document.createElement('span');
      label.textContent = c[0];
      wrap.append(b, label);
      container.append(wrap);
    });
  };
  renderEntries($('commonPalette'), COMMON_COLOR_IDS.map(id => paletteById.get(id)).filter(Boolean));
  renderEntries($('palette'), paletteData);
}

function setPaletteSize(size, options = {}) {
  if (!MARD_PALETTES[size] || size === paletteSize) return;
  const { refresh = true, notify = true } = options;
  paletteSize = size;
  paletteData = MARD_PALETTES[size];
  rebuildPaletteMatcher();
  selected = paletteById.get(selected[0]) || paletteData[0];
  $('paletteCount').textContent = `${size} 色`;
  document.querySelectorAll('[data-palette-size]').forEach(button => {
    const active = +button.dataset.paletteSize === size;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('allPaletteCount').textContent = `${size} 色`;
  palette();
  if (refresh && source) {
    convert();
  } else if (refresh && beads.length) {
    const remap = gridData => gridData.map(row => row.map(bead => bead ? paletteById.get(bead[0]) || near(hexToRgb(bead[1])) : null));
    if (patternVariants.length) {
      patternVariants = patternVariants.map(remap);
      beads = cloneBeads(patternVariants[selectedPatternVariant]);
    } else {
      beads = remap(beads);
    }
    resetHistory();
    render();
  }
  if (notify) showToast(`已切换至 MARD ${size} 色卡`);
}

function resize() {
  clearTimeout(timer);
  timer = setTimeout(() => source ? convert() : blank(), 180);
}

function drawExportHeader(target, width, margin, headerH, list) {
  target.save();
  target.fillStyle = '#20201e';
  target.font = '800 34px "Noto Sans SC", sans-serif';
  target.textBaseline = 'top';
  target.textAlign = 'left';
  target.fillText($('projectTitle').textContent || '拼豆图纸', margin, margin * .75);
  target.font = '500 18px "DM Mono", "Noto Sans SC", monospace';
  target.fillStyle = '#76736d';
  target.fillText(`${W} × ${H} 格 · MARD ${paletteSize} · ${new Set(list.map(x => x[0])).size} 色 · ${list.length} 颗`, margin, margin * .75 + 46);
  target.textAlign = 'right';
  target.font = '700 18px "DM Mono", monospace';
  target.fillStyle = '#ff5a36';
  target.fillText(BRAND, width - margin, margin * .75 + 10);
  target.strokeStyle = '#dedbd4';
  target.lineWidth = 2;
  target.beginPath();
  target.moveTo(margin, headerH - 1);
  target.lineTo(width - margin, headerH - 1);
  target.stroke();
  target.restore();
}

function drawExportLegend(target, counts, x, y, width, itemW, itemH) {
  target.save();
  target.fillStyle = '#20201e';
  target.font = '800 22px "Noto Sans SC", sans-serif';
  target.textAlign = 'left';
  target.textBaseline = 'top';
  target.fillText(`用色清单 · MARD ${paletteSize}`, x, y);
  target.font = '500 16px "DM Mono", monospace';
  counts.forEach(([id, count], i) => {
    const colCount = Math.max(1, Math.floor(width / itemW));
    const col = Math.floor(i % colCount);
    const row = Math.floor(i / colCount);
    const left = x + col * itemW;
    const top = y + 42 + row * itemH;
    const c = paletteData.find(v => v[0] === id);
    target.fillStyle = '#fff';
    target.strokeStyle = '#dedbd4';
    target.lineWidth = 2;
    target.strokeRect(left, top, itemW - 10, itemH - 8);
    target.fillRect(left + 1, top + 1, itemW - 12, itemH - 10);
    target.fillStyle = c[1];
    target.strokeStyle = 'rgba(0,0,0,.18)';
    target.beginPath();
    target.arc(left + 20, top + itemH / 2 - 4, 9, 0, Math.PI * 2);
    target.fill();
    target.stroke();
    target.fillStyle = '#20201e';
    target.fillText(id, left + 38, top + 12);
    target.fillStyle = '#76736d';
    target.fillText(`${count} 颗`, left + 78, top + 12);
  });
  target.restore();
}

function buildExportCanvas() {
  const list = usedBeads();
  const counts = colorCounts(list);
  const cell = cap(Math.floor(7600 / Math.max(W, H)), 32, 44);
  const { width: chartW, height: chartH } = patternMetrics(cell, { highQualityText: true });
  const margin = Math.round(cell * 1.6);
  const headerH = Math.round(cell * 3);
  const footerH = Math.round(cell * 2.2);
  const itemW = Math.max(138, Math.round(cell * 4.2));
  const itemH = Math.max(42, Math.round(cell * 1.25));
  const cols = Math.max(1, Math.floor(chartW / itemW));
  const rows = Math.ceil(counts.length / cols);
  const legendH = counts.length ? 52 + rows * itemH : 0;
  const out = document.createElement('canvas');
  out.width = chartW + margin * 2;
  out.height = margin + headerH + chartH + legendH + footerH + margin;
  const o = out.getContext('2d');
  o.fillStyle = '#f8f7f3';
  o.fillRect(0, 0, out.width, out.height);
  drawExportHeader(o, out.width, margin, headerH, list);
  o.save();
  o.translate(margin, headerH);
  drawPattern(o, cell, { showGrid: true, watermark: true, highQualityText: true });
  o.restore();
  if (counts.length) drawExportLegend(o, counts, margin, headerH + chartH + Math.round(cell * .8), chartW, itemW, itemH);
  o.save();
  o.fillStyle = '#8b877e';
  o.font = '700 18px "DM Mono", monospace';
  o.textAlign = 'right';
  o.textBaseline = 'bottom';
  o.fillText(WATERMARK, out.width - margin, out.height - margin * .65);
  o.restore();
  return out;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function safeFileName(name) {
  const base = (name || '拼豆图纸').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || '拼豆图纸';
  return base.toLowerCase().endsWith('.png') ? base : `${base}.png`;
}

function defaultExportName() {
  return safeFileName(`${$('projectTitle').textContent || '拼豆图纸'}_${W}x${H}`);
}

function canvasToBlob(out) {
  return new Promise(resolve => {
    if (out.toBlob) out.toBlob(resolve, 'image/png');
    else resolve(null);
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = name;
  a.href = url;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCompleted(message) {
  showToast(message);
  window.accountManager?.recordExport();
}

async function exportImage() {
  if (!usedBeads().length) {
    showToast('请先创建或转换一张图纸');
    return;
  }
  const out = buildExportCanvas();
  const suggestedName = defaultExportName();
  let saveHandle = null;
  if (window.showSaveFilePicker) {
    try {
      saveHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }],
      });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        showToast('已取消导出');
        return;
      }
    }
  }

  const blob = await canvasToBlob(out);
  if (saveHandle && blob) {
    const writable = await saveHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    exportCompleted('已保存高清水印图纸');
    return;
  }
  if (!blob) {
    const input = window.prompt('请输入图纸文件名', suggestedName);
    if (input === null) {
      showToast('已取消导出');
      return;
    }
    const a = document.createElement('a');
    a.download = safeFileName(input);
    a.href = out.toDataURL('image/png');
    a.click();
    exportCompleted('已导出高清水印图纸');
    return;
  }

  const input = window.prompt('请输入图纸文件名', suggestedName);
  if (input === null) {
    showToast('已取消导出');
    return;
  }
  downloadBlob(blob, safeFileName(input));
  exportCompleted('已导出高清水印图纸');
}

function clearCanvas() {
  if (editLocked) {
    showToast('请先点击“开始编辑”');
    return;
  }
  if (!beads.length) {
    showToast('当前没有图纸');
    return;
  }
  pushHistory();
  beads = Array.from({ length: H }, () => Array(W).fill(null));
  render();
}

canvas.onpointerdown = e => {
  if (!beads.length || editLocked) return;
  canvas.setPointerCapture(e.pointerId);
  pushHistory();
  draw(e);
};
canvas.onpointermove = e => e.buttons && !editLocked && draw(e);
document.querySelectorAll('[data-size]').forEach(b => b.onclick = () => {
  const n = +b.dataset.size;
  $('gridWidth').value = $('gridHeight').value = n;
  document.querySelectorAll('[data-size]').forEach(q => q.classList.toggle('selected', q === b));
  source ? convert() : blank(n, n);
});
['gridWidth', 'gridHeight'].forEach(id => $(id).oninput = resize);
$('imageInput').onchange = e => {
  const f = e.target.files[0];
  const i = new Image();
  if (!f) return;
  i.onload = () => {
    source = i;
    $('imagePreview').src = i.src;
    $('previewWrap').classList.remove('hidden');
    document.querySelector('.upload-zone').classList.add('hidden');
    convert();
  };
  i.src = URL.createObjectURL(f);
};
$('removeImage').onclick = () => {
  source = null;
  $('imageInput').value = '';
  $('previewWrap').classList.add('hidden');
  document.querySelector('.upload-zone').classList.remove('hidden');
};
$('zoomIn').onclick = () => {
  zoom = cap(zoom + .25, .5, 4);
  $('zoomLabel').textContent = zoom * 100 + '%';
  render();
};
$('zoomOut').onclick = () => {
  zoom = cap(zoom - .25, .5, 4);
  $('zoomLabel').textContent = zoom * 100 + '%';
  render();
};
$('gridBtn').onclick = () => {
  grid = !grid;
  $('gridBtn').classList.toggle('active', grid);
  render();
};
$('previewBtn').onclick = () => {
  showColorNumbers = !showColorNumbers;
  const previewing = !showColorNumbers;
  const button = $('previewBtn');
  button.classList.toggle('active', previewing);
  button.setAttribute('aria-pressed', String(previewing));
  button.setAttribute('aria-label', previewing ? '退出预览（显示色号）' : '预览图纸（隐藏色号）');
  button.dataset.tooltip = previewing ? '退出预览（显示色号）' : '预览（隐藏色号）';
  render();
};
$('undoBtn').onclick = () => {
  if (editLocked || !history.length) return;
  redoHistory.push(cloneBeads(beads));
  beads = history.pop();
  render();
};
$('redoBtn').onclick = () => {
  if (editLocked || !redoHistory.length) return;
  history.push(cloneBeads(beads));
  beads = redoHistory.pop();
  render();
};
$('clearBtn').onclick = clearCanvas;
$('editBtn').onclick = () => {
  const nextLocked = !editLocked;
  saveSelectedPatternVariant();
  setEditLocked(nextLocked, true);
  showToast(nextLocked ? '已锁定图纸' : '已开启图纸编辑');
};
$('saveBtn').onclick = exportImage;
document.querySelectorAll('[data-pattern-variant]').forEach(button => {
  button.onclick = () => selectPatternVariant(+button.dataset.patternVariant);
});

function activate(mode) {
  const creating = mode === 'create';
  document.querySelectorAll('.mode').forEach(q => q.classList.toggle('active', q.dataset.mode === mode));
  document.querySelector('.image-panel').style.display = creating ? 'none' : 'block';
  if (creating) {
    if (!beads.length) blank();
    $('emptyState').classList.add('hidden');
  }
}

function resetImportedImage() {
  source = null;
  $('imageInput').value = '';
  $('previewWrap').classList.add('hidden');
  document.querySelector('.upload-zone').classList.remove('hidden');
}

function startFreshCreate() {
  resetImportedImage();
  blank();
  $('projectTitle').textContent = '未命名图纸';
  $('emptyState').classList.add('hidden');
  activate('create');
}

function snapshotPattern() {
  return {
    title: $('projectTitle').textContent || '未命名图纸',
    width: W,
    height: H,
    paletteSize,
    beads: beads.map(row => row.map(bead => bead?.[0] || null)),
    createdAt: new Date().toISOString(),
  };
}

function loadPattern(snapshot) {
  if (!snapshot?.beads?.length) return;
  resetImportedImage();
  clearPatternVariants();
  setPaletteSize(snapshot.paletteSize || 221, { refresh: false, notify: false });
  W = cap(+snapshot.width, 16, 200);
  H = cap(+snapshot.height, 16, 200);
  $('gridWidth').value = W;
  $('gridHeight').value = H;
  beads = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    const id = snapshot.beads[y]?.[x];
    return id ? paletteById.get(id) || near(hexToRgb(MARD_PALETTES[291].find(item => item[0] === id)?.[1] || '#ffffff')) : null;
  }));
  resetHistory();
  setEditLocked(false);
  $('projectTitle').textContent = snapshot.title || '历史图纸';
  $('emptyState').classList.add('hidden');
  activate('create');
  render();
}

window.studioApi = {
  getSnapshot: snapshotPattern,
  getUsage: () => colorCounts(),
  getPalette: size => MARD_PALETTES[size || paletteSize],
  getPaletteSize: () => paletteSize,
  hasContent: () => usedBeads().length > 0,
  loadPattern,
  notify: showToast,
  startFreshCreate,
};

document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
  if (b.dataset.mode === 'create') {
    window.accountManager?.requestFreshCreate() || startFreshCreate();
  } else {
    activate('image');
  }
});
document.querySelectorAll('[data-palette-size]').forEach(button => button.onclick = () => setPaletteSize(+button.dataset.paletteSize));
$('startCreate').onclick = startFreshCreate;
document.head.insertAdjacentHTML('beforeend', '<style>.canvas-stage canvas{max-width:none!important;max-height:none!important;flex:none}.palette-entry{text-align:center;font:9px monospace;color:#666}.palette-entry .swatch{display:block}.legend-head{display:flex;justify-content:space-between;margin:24px 0 10px;font-size:12px}.legend-head span,.watermark{font:10px monospace;color:#8b877e}.legend-list{display:flex;flex-wrap:wrap;gap:8px}.legend-item{display:flex;align-items:center;gap:5px;border:1px solid #dedbd4;padding:5px 7px;font:10px monospace;background:#fff}.legend-item i{width:13px;height:13px;border-radius:50%;border:1px solid #0002}.legend-item small{color:#777}.watermark{text-align:right;letter-spacing:1px;margin:12px 0}</style>');
setHistoryButtons();
updateVariantSwitcher();
palette();
