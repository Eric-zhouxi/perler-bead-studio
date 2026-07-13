const codes = [['A', 26], ['B', 32], ['C', 29], ['D', 26], ['E', 24], ['F', 25], ['G', 21], ['H', 23], ['M', 15]]
  .flatMap(([letter, count]) => Array.from({ length: count }, (_, i) => `${letter}${i + 1}`));
const paletteData = Array.from({ length: 221 }, (_, i) => [codes[i], `hsl(${i * 47 % 360} ${35 + i % 5 * 14}% ${18 + Math.floor(i / 5) % 9 * 9}%)`]);
const $ = id => document.getElementById(id);
const canvas = $('beadCanvas');
const ctx = canvas.getContext('2d');
const WATERMARK = 'ERIC_ZHOU · PERLER STUDIO';
const BRAND = 'ERIC_ZHOU · 豆绘';
let W = 64, H = 64, beads = [], selected = paletteData[0], zoom = 1, source, grid = true, history = [], redoHistory = [], timer;

const cap = (v, a, b) => Math.max(a, Math.min(b, v));
const cloneBeads = value => value.map(row => row.slice());
const usedBeads = () => beads.flat().filter(Boolean);
const rgbDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const colorKey = c => c.map(v => cap(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

const colour = c => {
  const [h, s, l] = c.match(/\d+/g).map(Number);
  const a = s / 100 * Math.min(l / 100, 1 - l / 100);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};
const p = paletteData.map(a => [a, colour(a[1])]);
const dis = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const near = (a, set = p) => set.reduce((v, x) => dis(a, x[1]) < dis(a, v[1]) ? x : v)[0];

function normalizeRgb(rgb) {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  const luminance = r * .299 + g * .587 + b * .114;
  if (max < 56) return [0, 0, 0];
  if (min > 238 && spread < 22) return [255, 255, 255];
  if (spread < 18 || (max < 100 && spread < 38)) {
    const gray = cap(Math.round(luminance / 16) * 16, 0, 255);
    return [gray, gray, gray];
  }
  const step = max < 92 ? 16 : 12;
  return [r, g, b].map(v => cap(Math.round(v / step) * step, 0, 255));
}

function averageColor(list) {
  const sum = list.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0]);
  return sum.map(v => v / Math.max(1, list.length));
}

function colorCounts(list = usedBeads()) {
  const counts = new Map();
  list.forEach(c => counts.set(c[0], (counts.get(c[0]) || 0) + 1));
  return [...counts].sort(([a], [b]) => codes.indexOf(a) - codes.indexOf(b));
}

function textColor(fill) {
  const q = colour(fill);
  return (q[0] * 299 + q[1] * 587 + q[2] * 114) > 145000 ? '#20201e' : '#fff';
}

function setHistoryButtons() {
  const undo = $('undoBtn');
  const redo = $('redoBtn');
  if (undo) undo.disabled = history.length === 0;
  if (redo) redo.disabled = redoHistory.length === 0;
}

function resetHistory() {
  history = [];
  redoHistory = [];
  setHistoryButtons();
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

function drawGrid(target, cell) {
  target.save();
  target.strokeStyle = '#d5d3cc';
  target.lineWidth = Math.max(1, Math.round(cell * .035));
  target.beginPath();
  for (let x = 0; x <= W; x++) {
    target.moveTo(x * cell + .5, 0);
    target.lineTo(x * cell + .5, H * cell);
  }
  for (let y = 0; y <= H; y++) {
    target.moveTo(0, y * cell + .5);
    target.lineTo(W * cell, y * cell + .5);
  }
  target.stroke();
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
  const { showGrid = grid, watermark = false, highQualityText = false } = options;
  target.fillStyle = '#fff';
  target.fillRect(0, 0, W * cell, H * cell);
  beads.forEach((r, y) => r.forEach((b, x) => {
    target.fillStyle = b?.[1] || '#fff';
    target.fillRect(x * cell, y * cell, cell, cell);
  }));
  if (watermark) drawWatermarkOverlay(target, cell);
  if (showGrid) drawGrid(target, cell);
  drawNumbers(target, cell, highQualityText);
}

function render() {
  const c = cap(Math.round(900 / Math.max(W, H)), 6, 16) * zoom;
  canvas.width = W * c;
  canvas.height = H * c;
  canvas.style.width = 'auto';
  canvas.style.height = 'auto';
  drawPattern(ctx, c);
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
  beads = Array.from({ length: H }, () => Array(W).fill(null));
  resetHistory();
  render();
}

function readSourcePixels() {
  const t = document.createElement('canvas');
  t.width = W;
  t.height = H;
  const x = t.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);
  const s = Math.min(W / source.naturalWidth, H / source.naturalHeight);
  const w = source.naturalWidth * s;
  const h = source.naturalHeight * s;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
  const d = x.getImageData(0, 0, W, H).data;
  const pixels = [];
  for (let i = 0; i < d.length; i += 4) pixels.push([d[i], d[i + 1], d[i + 2]]);
  return pixels;
}

function detectUniformBackground(pixels) {
  const border = [];
  for (let x = 0; x < W; x++) {
    border.push(pixels[x], pixels[(H - 1) * W + x]);
  }
  for (let y = 1; y < H - 1; y++) {
    border.push(pixels[y * W], pixels[y * W + W - 1]);
  }
  const avg = averageColor(border);
  const distances = border.map(c => rgbDistance(c, avg));
  const closeRatio = distances.filter(v => v < 34).length / Math.max(1, distances.length);
  const meanDistance = distances.reduce((a, b) => a + b, 0) / Math.max(1, distances.length);
  if (closeRatio < .86 || meanDistance > 24) return null;
  return {
    rgb: normalizeRgb(avg),
    threshold: cap(Math.round(meanDistance * 1.8 + 34), 38, 72),
  };
}

function cleanForegroundMask(mask) {
  const out = mask.slice();
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && at(x + dx, y + dy)) neighbors++;
        }
      }
      const i = y * W + x;
      if (mask[i] && neighbors === 0) out[i] = false;
      if (!mask[i] && neighbors >= 6) out[i] = true;
    }
  }
  return out;
}

function dilateMask(mask) {
  const out = mask.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = true;
        }
      }
    }
  }
  return out;
}

function findComponents(mask) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const q = [i];
    const comp = [];
    seen[i] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      comp.push(cur);
      const x = cur % W;
      const y = Math.floor(cur / W);
      dirs.forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        const ni = ny * W + nx;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && mask[ni] && !seen[ni]) {
          seen[ni] = 1;
          q.push(ni);
        }
      });
    }
    components.push(comp);
  }
  return components.sort((a, b) => b.length - a.length);
}

function ensureConnected(mask, backgroundMask, foregroundMask) {
  const components = findComponents(mask);
  if (components.length < 2) return;
  const anchor = components[0][0];
  const ax = anchor % W;
  const ay = Math.floor(anchor / W);
  components.slice(1).forEach(comp => {
    const point = comp[0];
    let x = point % W;
    let y = Math.floor(point / W);
    const stepX = x < ax ? 1 : -1;
    while (x !== ax) {
      const i = y * W + x;
      mask[i] = true;
      if (!foregroundMask[i]) backgroundMask[i] = true;
      x += stepX;
    }
    const stepY = y < ay ? 1 : -1;
    while (y !== ay) {
      const i = y * W + x;
      mask[i] = true;
      if (!foregroundMask[i]) backgroundMask[i] = true;
      y += stepY;
    }
  });
}

function smoothColors(colors, keepMask, backgroundMask) {
  const out = colors.map(c => c.slice());
  const paletteByKey = new Map(colors.map(c => [colorKey(c), c]));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!keepMask[i] || backgroundMask[i]) continue;
      const counts = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          const ni = ny * W + nx;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || !keepMask[ni] || backgroundMask[ni]) continue;
          const key = colorKey(colors[ni]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (!best || best[0] === colorKey(colors[i])) continue;
      const neighborColor = paletteByKey.get(best[0]);
      if (best[1] >= 5 || (best[1] >= 2 && rgbDistance(colors[i], neighborColor) > 48)) {
        out[i] = neighborColor.slice();
      }
    }
  }
  return out;
}

function autoPaletteSet(colors, keepMask, backgroundMask, backgroundRgb) {
  const counts = new Map();
  colors.forEach((rgb, i) => {
    if (!keepMask[i]) return;
    const src = backgroundMask[i] ? backgroundRgb : rgb;
    const item = near(src);
    counts.set(item[0], (counts.get(item[0]) || 0) + 1);
  });
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const minCount = Math.max(2, Math.ceil(total * .0025));
  let ids = [...counts]
    .sort((a, b) => b[1] - a[1])
    .filter(([, count], i) => count >= minCount || i < 8)
    .slice(0, 72)
    .map(([id]) => id);
  if (backgroundRgb) ids.unshift(near(backgroundRgb)[0]);
  ids = [...new Set(ids)];
  return ids.map(id => p.find(v => v[0][0] === id)).filter(Boolean);
}

function buildConversionMasks(pixels) {
  const total = W * H;
  const bg = detectUniformBackground(pixels);
  const keepMask = Array(total).fill(true);
  const backgroundMask = Array(total).fill(false);
  if (!bg) return { keepMask, backgroundMask, backgroundRgb: null };

  const foreground = pixels.map(px => rgbDistance(normalizeRgb(px), bg.rgb) > bg.threshold);
  const foregroundMask = cleanForegroundMask(foreground);
  const foregroundCount = foregroundMask.filter(Boolean).length;
  if (!foregroundCount || foregroundCount > total * .92) return { keepMask, backgroundMask, backgroundRgb: null };

  const ring = dilateMask(foregroundMask);
  for (let i = 0; i < total; i++) {
    keepMask[i] = ring[i];
    backgroundMask[i] = ring[i] && !foregroundMask[i];
  }
  ensureConnected(keepMask, backgroundMask, foregroundMask);
  return { keepMask, backgroundMask, backgroundRgb: bg.rgb };
}

function convert() {
  if (!source) return;
  W = cap(+$('gridWidth').value, 16, 200);
  H = cap(+$('gridHeight').value, 16, 200);
  const pixels = readSourcePixels();
  const { keepMask, backgroundMask, backgroundRgb } = buildConversionMasks(pixels);
  let colors = pixels.map(normalizeRgb);
  if (backgroundRgb) colors = smoothColors(colors, keepMask, backgroundMask);
  const keepSet = autoPaletteSet(colors, keepMask, backgroundMask, backgroundRgb);
  beads = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
    const i = y * W + x;
    if (!keepMask[i]) return null;
    const src = backgroundMask[i] && backgroundRgb ? backgroundRgb : colors[i];
    return near(src, keepSet);
  }));
  resetHistory();
  $('emptyState').classList.add('hidden');
  $('projectTitle').textContent = '图片转拼豆图纸';
  render();
}

function draw(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / r.width * W);
  const y = Math.floor((e.clientY - r.top) / r.height * H);
  if (beads[y]?.[x] !== undefined) {
    beads[y][x] = selected;
    render();
  }
}

function palette() {
  $('palette').innerHTML = '';
  paletteData.forEach(c => {
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
    $('palette').append(wrap);
  });
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
  target.fillText(`${W} × ${H} 格 · ${new Set(list.map(x => x[0])).size} 色 · ${list.length} 颗`, margin, margin * .75 + 46);
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
  target.fillText('用色清单', x, y);
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
  const chartW = W * cell;
  const chartH = H * cell;
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

async function exportImage() {
  if (!beads.length) {
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
    showToast('已保存高清水印图纸');
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
    showToast('已导出高清水印图纸');
    return;
  }

  const input = window.prompt('请输入图纸文件名', suggestedName);
  if (input === null) {
    showToast('已取消导出');
    return;
  }
  downloadBlob(blob, safeFileName(input));
  showToast('已导出高清水印图纸');
}

function clearCanvas() {
  if (!beads.length) {
    showToast('当前没有图纸');
    return;
  }
  pushHistory();
  beads = Array.from({ length: H }, () => Array(W).fill(null));
  render();
}

canvas.onpointerdown = e => {
  if (!beads.length) return;
  canvas.setPointerCapture(e.pointerId);
  pushHistory();
  draw(e);
};
canvas.onpointermove = e => e.buttons && draw(e);
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
$('undoBtn').onclick = () => {
  if (!history.length) return;
  redoHistory.push(cloneBeads(beads));
  beads = history.pop();
  render();
};
$('redoBtn').onclick = () => {
  if (!redoHistory.length) return;
  history.push(cloneBeads(beads));
  beads = redoHistory.pop();
  render();
};
$('clearBtn').onclick = clearCanvas;
$('saveBtn').onclick = exportImage;

function activate(mode) {
  const creating = mode === 'create';
  document.querySelectorAll('.mode').forEach(q => q.classList.toggle('active', q.dataset.mode === mode));
  document.querySelector('.image-panel').style.display = creating ? 'none' : 'block';
  if (creating) {
    if (!beads.length) blank();
    $('emptyState').classList.add('hidden');
  }
}

document.querySelectorAll('.mode').forEach(b => b.onclick = () => activate(b.dataset.mode));
$('startCreate').onclick = () => activate('create');
document.head.insertAdjacentHTML('beforeend', '<style>.canvas-stage canvas{max-width:none!important;max-height:none!important;flex:none}.palette-entry{text-align:center;font:9px monospace;color:#666}.palette-entry .swatch{display:block}.legend-head{display:flex;justify-content:space-between;margin:24px 0 10px;font-size:12px}.legend-head span,.watermark{font:10px monospace;color:#8b877e}.legend-list{display:flex;flex-wrap:wrap;gap:8px}.legend-item{display:flex;align-items:center;gap:5px;border:1px solid #dedbd4;padding:5px 7px;font:10px monospace;background:#fff}.legend-item i{width:13px;height:13px;border-radius:50%;border:1px solid #0002}.legend-item small{color:#777}.watermark{text-align:right;letter-spacing:1px;margin:12px 0}</style>');
setHistoryButtons();
palette();
