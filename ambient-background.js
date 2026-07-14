(function exposeAmbientBackground(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DouhuiAmbientBackground = api;
  if (root?.document) api.init(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildAmbientBackground() {
  const GLYPHS = ['0', '1', '{', '}', '[', ']', '<', '>', '/', '*', '+', '·', '豆', '绘', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'];
  const COLORS = {
    ink: [32, 32, 30],
    orange: [255, 90, 54],
    blue: [62, 102, 238],
  };
  const RIPPLE_LIFETIME = 2200;

  const cap = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function seededValue(x, y, seed = 8241) {
    let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed;
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967295;
  }

  function createGlyphField(width, height, spacing = 30, seed = 8241) {
    const columns = Math.ceil(width / spacing) + 1;
    const rows = Math.ceil(height / spacing) + 1;
    const glyphs = [];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const random = seededValue(column, row, seed);
        const random2 = seededValue(column, row, seed + 191);
        const tone = random2 > .9 ? 'orange' : random2 > .79 ? 'blue' : 'ink';
        glyphs.push({
          x: column * spacing + (random - .5) * spacing * .32,
          y: row * spacing + (random2 - .5) * spacing * .32,
          glyphIndex: Math.floor(random * GLYPHS.length),
          morphOffset: Math.floor(random2 * 17),
          baseAlpha: .012 + random * .018,
          tone,
        });
      }
    }
    return glyphs;
  }

  function pointerInfluence(point, pointer, radius = 190) {
    if (!pointer?.active) return 0;
    const ratio = cap(1 - distance(point, pointer) / radius, 0, 1);
    return ratio * ratio * (3 - 2 * ratio);
  }

  function rippleInfluence(point, ripple, now) {
    const age = now - ripple.startedAt;
    if (age < 0 || age >= RIPPLE_LIFETIME) return 0;
    const progress = age / RIPPLE_LIFETIME;
    const radius = progress * 360;
    const offset = distance(point, ripple) - radius;
    const band = Math.exp(-(offset * offset) / (2 * 30 * 30));
    const decay = (1 - progress) ** 2;
    return Math.cos(offset * .15) * band * decay * ripple.strength;
  }

  function calculateGlyphState(glyph, pointer, ripples, now) {
    const proximity = pointerInfluence(glyph, pointer);
    let ripple = 0;
    let shiftX = 0;
    let shiftY = 0;
    ripples.forEach(item => {
      const influence = rippleInfluence(glyph, item, now);
      if (!influence) return;
      const dx = glyph.x - item.x;
      const dy = glyph.y - item.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      ripple += influence;
      shiftX += dx / length * influence * 8;
      shiftY += dy / length * influence * 8;
    });
    if (proximity && pointer) {
      const dx = glyph.x - pointer.x;
      const dy = glyph.y - pointer.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const current = Math.sin(length * .055 - now * .005 + glyph.morphOffset) * proximity;
      shiftX += dx / length * current * 4.5;
      shiftY += dy / length * current * 4.5;
    }
    const ambient = Math.sin(glyph.x * .012 + glyph.y * .009 + now * .00045 + glyph.morphOffset) * .55;
    const energy = cap(proximity + Math.abs(ripple), 0, 1.4);
    const morphing = energy > .12 ? Math.floor(now / 170 + glyph.morphOffset) % 7 : 0;
    return {
      x: glyph.x + shiftX + ambient,
      y: glyph.y + shiftY + ambient * .6,
      alpha: cap(glyph.baseAlpha + proximity * .2 + Math.abs(ripple) * .18, 0, .34),
      size: 10 + proximity * 2.4 + Math.abs(ripple) * 1.8,
      character: GLYPHS[(glyph.glyphIndex + morphing) % GLYPHS.length],
      tone: glyph.tone,
    };
  }

  function init(host) {
    const document = host.document;
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas || canvas.dataset.ambientReady === 'true') return null;
    canvas.dataset.ambientReady = 'true';
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      delete canvas.dataset.ambientReady;
      return null;
    }
    const reducedMotion = host.matchMedia?.('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let glyphs = [];
    let ripples = [];
    let frame = 0;
    let lastFrame = 0;
    let lastRipple = 0;
    let resizeTimer = 0;
    let running = true;
    const pointer = { x: 0, y: 0, active: false };

    function resize() {
      width = host.innerWidth;
      height = host.innerHeight;
      const ratio = Math.min(host.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      glyphs = createGlyphField(width, height, width < 720 ? 36 : 30);
      draw(host.performance?.now?.() || Date.now());
    }

    function draw(now) {
      context.clearRect(0, 0, width, height);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      glyphs.forEach(glyph => {
        const state = calculateGlyphState(glyph, pointer, ripples, now);
        const color = COLORS[state.tone];
        const alphaScale = state.tone === 'ink' ? 1 : state.tone === 'orange' ? .76 : .62;
        context.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${state.alpha * alphaScale})`;
        context.font = `500 ${state.size}px "DM Mono", "Noto Sans SC", monospace`;
        context.fillText(state.character, state.x, state.y);
      });
    }

    function animate(now) {
      if (!running) return;
      frame = host.requestAnimationFrame(animate);
      const frameInterval = pointer.active || ripples.length ? 33 : 80;
      if (now - lastFrame < frameInterval) return;
      lastFrame = now;
      ripples = ripples.filter(item => now - item.startedAt < RIPPLE_LIFETIME);
      draw(now);
    }

    function addRipple(x, y, strength, now) {
      ripples.push({ x, y, strength, startedAt: now });
      if (ripples.length > 6) ripples.shift();
    }

    function onPointerMove(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      const now = host.performance?.now?.() || Date.now();
      if (!reducedMotion?.matches && now - lastRipple > 95) {
        addRipple(pointer.x, pointer.y, .34, now);
        lastRipple = now;
      }
      if (reducedMotion?.matches) draw(now);
    }

    function onPointerDown(event) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      const now = host.performance?.now?.() || Date.now();
      if (!reducedMotion?.matches) addRipple(pointer.x, pointer.y, 1, now);
      else draw(now);
    }

    function onPointerLeave() {
      pointer.active = false;
      if (reducedMotion?.matches) draw(host.performance?.now?.() || Date.now());
    }

    function onResize() {
      host.clearTimeout(resizeTimer);
      resizeTimer = host.setTimeout(resize, 100);
    }

    function onVisibilityChange() {
      running = !document.hidden;
      if (running && !reducedMotion?.matches) {
        host.cancelAnimationFrame(frame);
        frame = host.requestAnimationFrame(animate);
      } else if (!running) {
        host.cancelAnimationFrame(frame);
      }
    }

    function onMotionPreferenceChange() {
      host.cancelAnimationFrame(frame);
      resize();
      if (running && !reducedMotion?.matches) frame = host.requestAnimationFrame(animate);
    }

    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    host.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion?.addEventListener?.('change', onMotionPreferenceChange);
    resize();
    if (!reducedMotion?.matches) frame = host.requestAnimationFrame(animate);

    return {
      destroy() {
        running = false;
        host.cancelAnimationFrame(frame);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('pointerleave', onPointerLeave);
        host.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        reducedMotion?.removeEventListener?.('change', onMotionPreferenceChange);
        delete canvas.dataset.ambientReady;
      },
    };
  }

  return {
    GLYPHS,
    RIPPLE_LIFETIME,
    calculateGlyphState,
    createGlyphField,
    init,
    pointerInfluence,
    rippleInfluence,
    seededValue,
  };
});
