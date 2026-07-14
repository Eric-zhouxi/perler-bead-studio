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
  const TRAIL_LIFETIME = 1800;

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

  function trailInfluence(point, trail, now) {
    const age = now - trail.startedAt;
    if (age < 0 || age >= TRAIL_LIFETIME) return null;
    const progress = age / TRAIL_LIFETIME;
    const friction = .0032;
    const travelTime = (1 - Math.exp(-age * friction)) / friction;
    const x = trail.x + trail.vx * travelTime;
    const y = trail.y + trail.vy * travelTime;
    const dx = point.x - x;
    const dy = point.y - y;
    const pointDistance = Math.hypot(dx, dy);
    const spread = 52 + progress * 34;
    const fade = (1 - progress) ** 1.8;
    const weight = Math.exp(-(pointDistance * pointDistance) / (2 * spread * spread)) * fade * trail.strength;
    const speed = Math.max(.001, Math.hypot(trail.vx, trail.vy));
    return {
      age,
      directionX: trail.vx / speed,
      directionY: trail.vy / speed,
      distance: pointDistance,
      weight,
      x,
      y,
    };
  }

  function calculateGlyphState(glyph, pointer, ripples, now, trails = []) {
    const proximity = pointerInfluence(glyph, pointer);
    let ripple = 0;
    let trailEnergy = 0;
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
    trails.forEach(item => {
      const influence = trailInfluence(glyph, item, now);
      if (!influence?.weight) return;
      const wake = Math.sin(influence.distance * .07 - influence.age * .012 + glyph.morphOffset) * influence.weight;
      trailEnergy += influence.weight;
      shiftX += influence.directionX * influence.weight * 9 - influence.directionY * wake * 3.5;
      shiftY += influence.directionY * influence.weight * 9 + influence.directionX * wake * 3.5;
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
    const visibleTrail = cap(trailEnergy, 0, 1);
    const energy = cap(proximity + Math.abs(ripple) + visibleTrail * .85, 0, 1.6);
    const morphing = energy > .12 ? Math.floor(now / 170 + glyph.morphOffset) % 7 : 0;
    return {
      x: glyph.x + shiftX + ambient,
      y: glyph.y + shiftY + ambient * .6,
      alpha: cap(glyph.baseAlpha + proximity * .2 + Math.abs(ripple) * .18 + visibleTrail * .13, 0, .34),
      size: 10 + proximity * 2.4 + Math.abs(ripple) * 1.8 + visibleTrail,
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
    let trails = [];
    let frame = 0;
    let lastFrame = 0;
    let lastRipple = 0;
    let lastTrail = 0;
    let resizeTimer = 0;
    let running = true;
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, lastAt: 0, active: false };

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
        const state = calculateGlyphState(glyph, pointer, ripples, now, trails);
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
      const frameInterval = pointer.active || ripples.length || trails.length ? 33 : 80;
      if (now - lastFrame < frameInterval) return;
      lastFrame = now;
      ripples = ripples.filter(item => now - item.startedAt < RIPPLE_LIFETIME);
      trails = trails.filter(item => now - item.startedAt < TRAIL_LIFETIME);
      draw(now);
    }

    function addRipple(x, y, strength, now) {
      ripples.push({ x, y, strength, startedAt: now });
      if (ripples.length > 6) ripples.shift();
    }

    function addTrail(x, y, vx, vy, strength, now) {
      trails.push({ x, y, vx, vy, strength, startedAt: now });
      if (trails.length > 20) trails.shift();
    }

    function onPointerMove(event) {
      const now = host.performance?.now?.() || Date.now();
      const x = event.clientX;
      const y = event.clientY;
      if (pointer.active && pointer.lastAt) {
        const elapsed = Math.max(8, Math.min(120, now - pointer.lastAt));
        const rawVx = (x - pointer.x) / elapsed;
        const rawVy = (y - pointer.y) / elapsed;
        pointer.vx = pointer.vx * .52 + rawVx * .48;
        pointer.vy = pointer.vy * .52 + rawVy * .48;
        const speed = Math.hypot(pointer.vx, pointer.vy);
        if (speed > 1.1) {
          pointer.vx *= 1.1 / speed;
          pointer.vy *= 1.1 / speed;
        }
        if (!reducedMotion?.matches && speed > .025 && now - lastTrail > 42) {
          addTrail(x, y, pointer.vx, pointer.vy, cap(.25 + speed * 1.1, .25, 1), now);
          lastTrail = now;
        }
      } else {
        pointer.vx = 0;
        pointer.vy = 0;
      }
      pointer.x = x;
      pointer.y = y;
      pointer.lastAt = now;
      pointer.active = true;
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
      pointer.lastAt = now;
      if (!reducedMotion?.matches) addRipple(pointer.x, pointer.y, 1, now);
      else draw(now);
    }

    function onPointerLeave() {
      const now = host.performance?.now?.() || Date.now();
      const speed = Math.hypot(pointer.vx, pointer.vy);
      if (!reducedMotion?.matches && speed > .025) {
        addTrail(pointer.x, pointer.y, pointer.vx, pointer.vy, cap(.35 + speed, .35, 1), now);
      }
      pointer.active = false;
      if (reducedMotion?.matches) draw(now);
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
      if (reducedMotion?.matches) {
        ripples = [];
        trails = [];
      }
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
    TRAIL_LIFETIME,
    calculateGlyphState,
    createGlyphField,
    init,
    pointerInfluence,
    rippleInfluence,
    seededValue,
    trailInfluence,
  };
});
