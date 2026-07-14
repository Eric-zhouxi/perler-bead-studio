(function exposeConversionStrategies(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DouhuiConversionStrategies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildConversionStrategies() {
  const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [value >> 16, value >> 8 & 255, value & 255];
  }

  function rgbToLab([r, g, b]) {
    const linear = value => {
      const channel = value / 255;
      return channel > .04045 ? ((channel + .055) / 1.055) ** 2.4 : channel / 12.92;
    };
    r = linear(r);
    g = linear(g);
    b = linear(b);
    const x = (r * .4124 + g * .3576 + b * .1805) / .95047;
    const y = r * .2126 + g * .7152 + b * .0722;
    const z = (r * .0193 + g * .1192 + b * .9505) / 1.08883;
    const pivot = value => value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
    const fx = pivot(x);
    const fy = pivot(y);
    const fz = pivot(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const chroma = lab => Math.hypot(lab[1], lab[2]);
  const colorId = entry => entry?.[0];

  function isNearNeutralBlack(rgb) {
    const lab = rgbToLab(rgb);
    const spread = Math.max(...rgb) - Math.min(...rgb);
    return lab[0] <= 22 && chroma(lab) <= 14 && spread <= 28;
  }

  function colorCounts(cells) {
    const counts = new Map();
    cells.forEach(entry => {
      const id = colorId(entry);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    return counts;
  }

  function buildLabMap(cells) {
    const labs = new Map();
    cells.forEach(entry => {
      if (entry && !labs.has(entry[0])) labs.set(entry[0], rgbToLab(hexToRgb(entry[1])));
    });
    return labs;
  }

  function normalizedOptions(cells, options) {
    const { width, height } = options;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width * height !== cells.length) {
      throw new Error('Grid dimensions do not match the converted color data.');
    }
    return {
      width,
      height,
      activeMask: options.activeMask || cells.map(Boolean),
      lineMask: options.lineMask || Array(cells.length).fill(false),
    };
  }

  function componentSizes(cells, options) {
    const { width, height, activeMask, lineMask } = options;
    const visited = new Uint8Array(cells.length);
    const sizes = new Uint32Array(cells.length);
    for (let start = 0; start < cells.length; start++) {
      if (visited[start] || !activeMask[start] || lineMask[start] || !cells[start]) continue;
      const id = cells[start][0];
      const queue = [start];
      const members = [];
      visited[start] = 1;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const index = queue[cursor];
        members.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        ORTHOGONAL.forEach(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
          const neighbor = ny * width + nx;
          if (visited[neighbor] || !activeMask[neighbor] || lineMask[neighbor] || colorId(cells[neighbor]) !== id) return;
          visited[neighbor] = 1;
          queue.push(neighbor);
        });
      }
      members.forEach(index => { sizes[index] = members.length; });
    }
    return sizes;
  }

  function neighborGroups(cells, index, options, accept = () => true) {
    const { width, height, activeMask, lineMask } = options;
    const x = index % width;
    const y = Math.floor(index / width);
    const groups = new Map();
    let occupied = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        const entry = cells[neighbor];
        if (!activeMask[neighbor] || lineMask[neighbor] || !entry) continue;
        occupied++;
        if (!accept(entry)) continue;
        const id = entry[0];
        const group = groups.get(id) || { entry, count: 0, orthogonal: 0, weight: 0 };
        const straight = dx === 0 || dy === 0;
        group.count++;
        group.orthogonal += straight ? 1 : 0;
        group.weight += straight ? 2 : 1;
        groups.set(id, group);
      }
    }
    return { groups, occupied };
  }

  function cleanSpeckles(cells, rawOptions = {}) {
    const options = normalizedOptions(cells, rawOptions);
    const passes = Math.max(1, Math.min(3, rawOptions.passes || 2));
    let current = cells.slice();
    for (let pass = 0; pass < passes; pass++) {
      const sizes = componentSizes(current, options);
      const totals = colorCounts(current);
      const labs = buildLabMap(current);
      const next = current.slice();
      let changed = 0;
      current.forEach((entry, index) => {
        if (!entry || !options.activeMask[index] || options.lineMask[index]) return;
        const size = sizes[index];
        const usage = totals.get(entry[0]) || 0;
        if (!size || size > 2 || (size === 2 && usage > 4)) return;
        const { groups, occupied } = neighborGroups(current, index, options, candidate => candidate[0] !== entry[0]);
        const sourceLab = labs.get(entry[0]);
        let best = null;
        groups.forEach(group => {
          const distance = labDistance(sourceLab, labs.get(group.entry[0]));
          const score = group.weight * 7 + group.count * 2 - distance * .34;
          if (!best || score > best.score) best = { ...group, distance, score };
        });
        if (!best) return;
        const globallyRare = usage <= Math.max(2, size + 1);
        const density = best.count / Math.max(1, occupied);
        const supported = best.count >= 3 || best.orthogonal >= 2 || (globallyRare && best.count >= 2);
        const denseEnough = density >= (globallyRare ? .28 : .42);
        const distanceLimit = best.count >= 5 ? 44 : globallyRare ? 34 : 28;
        if (!supported || !denseEnough || best.distance > distanceLimit) return;
        next[index] = best.entry;
        changed++;
      });
      current = next;
      if (!changed) break;
    }
    return current;
  }

  function createDeepColorMatcher(palette) {
    const prepared = palette.map(entry => {
      const rgb = hexToRgb(entry[1]);
      const lab = rgbToLab(rgb);
      return { entry, lab, chroma: chroma(lab) };
    });
    return rgb => {
      const sourceLab = rgbToLab(rgb);
      const sourceChroma = chroma(sourceLab);
      const spread = Math.max(...rgb) - Math.min(...rgb);
      let nearest = prepared[0];
      let nearestDistance = labDistance(sourceLab, nearest.lab);
      for (let index = 1; index < prepared.length; index++) {
        const distance = labDistance(sourceLab, prepared[index].lab);
        if (distance < nearestDistance) {
          nearest = prepared[index];
          nearestDistance = distance;
        }
      }
      if (isNearNeutralBlack(rgb)) {
        const neutralDark = prepared.filter(item => item.lab[0] < 38 && item.chroma <= 7);
        return neutralDark.reduce((best, item) => (
          labDistance(sourceLab, item.lab) < labDistance(sourceLab, best.lab) ? item : best
        ), neutralDark[0] || nearest).entry;
      }
      const darkChromatic = sourceLab[0] < 58 && (sourceChroma >= 7 || spread >= 11);
      if (!darkChromatic) return nearest.entry;
      const minimumChroma = Math.max(9, sourceChroma * .45);
      const maximumLightness = Math.min(68, sourceLab[0] + 16);
      let best = null;
      prepared.forEach(item => {
        if (item.chroma < minimumChroma || item.lab[0] > maximumLightness) return;
        const distance = labDistance(sourceLab, item.lab);
        const chromaLoss = Math.max(0, Math.max(13, sourceChroma) * .75 - item.chroma);
        const lightnessLift = Math.max(0, item.lab[0] - sourceLab[0] - 5);
        const alignment = sourceChroma && item.chroma
          ? (sourceLab[1] * item.lab[1] + sourceLab[2] * item.lab[2]) / (sourceChroma * item.chroma)
          : 1;
        const huePenalty = (1 - Math.max(-1, Math.min(1, alignment))) * Math.min(12, sourceChroma * .5);
        const score = distance + chromaLoss * 1.15 + lightnessLift * .65 + huePenalty;
        if (!best || score < best.score) best = { entry: item.entry, score };
      });
      return best?.entry || nearest.entry;
    };
  }

  function consolidateDeepRegions(cells, rawOptions = {}) {
    const options = normalizedOptions(cells, rawOptions);
    const passes = Math.max(1, Math.min(2, rawOptions.passes || 2));
    let current = cells.slice();
    for (let pass = 0; pass < passes; pass++) {
      const labs = buildLabMap(current);
      const totals = colorCounts(current);
      const next = current.slice();
      let changed = 0;
      current.forEach((entry, index) => {
        if (!entry || !options.activeMask[index] || options.lineMask[index]) return;
        const sourceLab = labs.get(entry[0]);
        if (sourceLab[0] >= 62) return;
        const sourceChroma = chroma(sourceLab);
        const { groups, occupied } = neighborGroups(current, index, options, candidate => {
          if (candidate[0] === entry[0]) return false;
          const candidateLab = labs.get(candidate[0]);
          const candidateChroma = chroma(candidateLab);
          if (sourceChroma < 8 && candidateChroma >= 9) return false;
          return candidateLab[0] < 62 && candidateChroma >= 9;
        });
        let best = null;
        groups.forEach(group => {
          const candidateLab = labs.get(group.entry[0]);
          const distance = labDistance(sourceLab, candidateLab);
          const score = group.weight * 6 + group.count * 2 - distance * .28;
          if (!best || score > best.score) best = { ...group, lab: candidateLab, distance, score };
        });
        if (!best || best.count < 2 || best.distance > 28) return;
        const usage = totals.get(entry[0]) || 0;
        const density = best.count / Math.max(1, occupied);
        const candidateChroma = chroma(best.lab);
        const improvesDepth = candidateChroma >= sourceChroma + 3 || best.lab[0] <= sourceLab[0] - 4;
        const supported = best.count >= 5 || (best.count >= 3 && usage <= 12) || (best.count >= 2 && usage <= 2);
        if (!improvesDepth || !supported || density < .3) return;
        next[index] = best.entry;
        changed++;
      });
      current = next;
      if (!changed) break;
    }
    return current;
  }

  return {
    cleanSpeckles,
    consolidateDeepRegions,
    createDeepColorMatcher,
    colorCounts,
    hexToRgb,
    isNearNeutralBlack,
    labDistance,
    rgbToLab,
  };
});
