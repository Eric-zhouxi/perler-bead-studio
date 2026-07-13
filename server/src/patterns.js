import { HttpError } from './http.js';
import { isPaletteColor } from './palette.js';
import { patternFingerprint as fingerprint } from './security.js';

export function validatePattern(pattern) {
  const { width, height, paletteSize, beads } = pattern;
  if (!Number.isInteger(width) || width < 16 || width > 200 || !Number.isInteger(height) || height < 16 || height > 200) {
    throw new HttpError(400, 'invalid_pattern_size', '图纸尺寸必须在 16 到 200 之间');
  }
  if (![221, 291].includes(paletteSize)) throw new HttpError(400, 'invalid_palette_size', '色卡只能是 221 或 291');
  if (!Array.isArray(beads) || beads.length !== height || beads.some(row => !Array.isArray(row) || row.length !== width)) {
    throw new HttpError(400, 'invalid_pattern_grid', '图纸网格尺寸不正确');
  }
  const usage = {};
  for (const row of beads) {
    for (const id of row) {
      if (id === null) continue;
      if (!isPaletteColor(id, paletteSize)) throw new HttpError(400, 'invalid_color_id', `色号 ${id} 不属于 MARD ${paletteSize} 色卡`);
      usage[id] = (usage[id] || 0) + 1;
    }
  }
  if (!Object.keys(usage).length) throw new HttpError(400, 'empty_pattern', '不能保存空白图纸');
  return { usage, fingerprint: fingerprint(pattern) };
}
export function encodePattern(beads) {
  const runs = [];
  beads.flat().forEach(id => {
    const last = runs[runs.length - 1];
    if (last && last[0] === id) last[1]++;
    else runs.push([id, 1]);
  });
  return { encoding: 'rle-v1', runs };
}

export function decodePattern(data, width, height) {
  if (data?.encoding !== 'rle-v1' || !Array.isArray(data.runs)) throw new HttpError(500, 'invalid_stored_pattern', '服务器中的图纸格式不正确');
  const flat = [];
  for (const run of data.runs) {
    const [id, count] = run;
    if (!Number.isInteger(count) || count < 1 || flat.length + count > width * height) throw new HttpError(500, 'invalid_stored_pattern', '服务器中的图纸数据已损坏');
    for (let index = 0; index < count; index++) flat.push(id);
  }
  if (flat.length !== width * height) throw new HttpError(500, 'invalid_stored_pattern', '服务器中的图纸数据不完整');
  return Array.from({ length: height }, (_, y) => flat.slice(y * width, (y + 1) * width));
}
