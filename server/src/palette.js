const GROUP_LIMITS_221 = Object.freeze({ A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15 });
const GROUP_LIMITS_291 = Object.freeze({ ...GROUP_LIMITS_221, P: 23, Q: 5, R: 28, T: 1, Y: 5, ZG: 8 });

export function isPaletteColor(id, paletteSize) {
  const match = String(id || '').match(/^([A-Z]+)(\d+)$/);
  if (!match) return false;
  const limits = paletteSize === 291 ? GROUP_LIMITS_291 : GROUP_LIMITS_221;
  const limit = limits[match[1]];
  const number = Number(match[2]);
  return Boolean(limit && number >= 1 && number <= limit);
}
export function allPaletteIds(paletteSize = 291) {
  const limits = paletteSize === 291 ? GROUP_LIMITS_291 : GROUP_LIMITS_221;
  return Object.entries(limits).flatMap(([group, count]) => Array.from({ length: count }, (_, index) => `${group}${index + 1}`));
}
