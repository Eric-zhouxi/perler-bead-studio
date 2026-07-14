(function exposeAmbientBackground(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DouhuiAmbientBackground = api;
  if (root?.document) api.install(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildAmbientBackground() {
  const GLYPHS = ['0', '1', '{', '}', '[', ']', '<', '>', '/', '*', '+', '·', '豆', '绘', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'];
  const COLORS = {
    ink: [32, 32, 30],
    orange: [255, 90, 54],
    blue: [62, 102, 238],
  };
  const POINTER_RADIUS = 148;
  const FLOW_RIPPLE_RADIUS = 280;
  const TAP_RIPPLE_RADIUS = 440;
  const RIPPLE_LIFETIME = 2200;
  const TRAIL_LIFETIME = 2400;
  const MAX_PIXEL_RATIO = 1.5;
  const ACTIVE_FRAME_INTERVAL = 40;
  const POINTER_IDLE_TIME = 180;
  const FLOW_RIPPLE_INTERVAL = 140;
  const TRAIL_INTERVAL = 90;
  const MAX_RIPPLES = 4;
  const MAX_TRAILS = 8;
  const STORAGE_KEY = 'douhui.ambient-background.enabled';

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

  function pointerInfluence(point, pointer, radius = POINTER_RADIUS) {
    if (!pointer?.active) return 0;
    const ratio = cap(1 - distance(point, pointer) / radius, 0, 1);
    return ratio * ratio * (3 - 2 * ratio);
  }

  function rippleInfluence(point, ripple, now) {
    const age = now - ripple.startedAt;
    if (age < 0 || age >= RIPPLE_LIFETIME) return 0;
    const progress = age / RIPPLE_LIFETIME;
    const isTap = ripple.kind === 'tap';
    const pointDistance = distance(point, ripple);
    const radius = progress * (isTap ? TAP_RIPPLE_RADIUS : FLOW_RIPPLE_RADIUS);
    const bandWidth = isTap ? 36 : 25;
    const offset = pointDistance - radius;
    const band = Math.exp(-(offset * offset) / (2 * bandWidth * bandWidth));
    const decay = (1 - progress) ** (isTap ? 1.35 : 2.2);
    const primary = Math.cos(offset * (isTap ? .11 : .15)) * band;
    if (!isTap) return primary * decay * ripple.strength;

    const echoOffset = pointDistance - radius * .72;
    const echo = Math.exp(-(echoOffset * echoOffset) / (2 * 20 * 20)) * .34;
    return (primary + echo) * decay * ripple.strength;
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
    const spread = 56 + progress * 42;
    const fade = (1 - progress) ** 1.35;
    const weight = Math.exp(-(pointDistance * pointDistance) / (2 * spread * spread)) * fade * trail.strength * 1.08;
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
      shiftX += influence.directionX * influence.weight * 11.5 - influence.directionY * wake * 4.2;
      shiftY += influence.directionY * influence.weight * 11.5 + influence.directionX * wake * 4.2;
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
    const visibleTrail = cap(trailEnergy, 0, 1.15);
    const energy = cap(proximity + Math.abs(ripple) + visibleTrail, 0, 1.7);
    const morphing = energy > .12 ? Math.floor(now / 170 + glyph.morphOffset) % 7 : 0;
    return {
      x: glyph.x + shiftX + ambient,
      y: glyph.y + shiftY + ambient * .6,
      alpha: cap(glyph.baseAlpha + proximity * .2 + Math.abs(ripple) * .2 + visibleTrail * .18, 0, .4),
      size: 10 + proximity * 2.4 + Math.abs(ripple) * 2 + visibleTrail * 1.35,
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
    const baseCanvas = document.createElement?.('canvas') || null;
    const baseContext = baseCanvas?.getContext?.('2d', { alpha: true }) || null;
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

    function renderGlyph(target, state) {
      const color = COLORS[state.tone];
      const alphaScale = state.tone === 'ink' ? 1 : state.tone === 'orange' ? .76 : .62;
      target.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${state.alpha * alphaScale})`;
      target.font = `500 ${Math.round(state.size)}px "DM Mono", "Noto Sans SC", monospace`;
      target.fillText(state.character, state.x, state.y);
    }

    function drawBase(target) {
      target.clearRect(0, 0, width, height);
      target.textAlign = 'center';
      target.textBaseline = 'middle';
      target.font = '500 10px "DM Mono", "Noto Sans SC", monospace';
      glyphs.forEach(glyph => {
        const color = COLORS[glyph.tone];
        const alphaScale = glyph.tone === 'ink' ? 1 : glyph.tone === 'orange' ? .76 : .62;
        target.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${glyph.baseAlpha * alphaScale})`;
        target.fillText(GLYPHS[glyph.glyphIndex], glyph.x, glyph.y);
      });
    }

    function createActivityZones(now) {
      const zones = [];
      if (pointer.active) zones.push({ x: pointer.x, y: pointer.y, radius: POINTER_RADIUS + 18 });
      ripples.forEach(item => {
        const age = now - item.startedAt;
        if (age < 0 || age >= RIPPLE_LIFETIME) return;
        const progress = age / RIPPLE_LIFETIME;
        const radius = progress * (item.kind === 'tap' ? TAP_RIPPLE_RADIUS : FLOW_RIPPLE_RADIUS);
        zones.push({ x: item.x, y: item.y, radius: radius + (item.kind === 'tap' ? 105 : 72) });
      });
      trails.forEach(item => {
        const age = now - item.startedAt;
        if (age < 0 || age >= TRAIL_LIFETIME) return;
        const progress = age / TRAIL_LIFETIME;
        const friction = .0032;
        const travelTime = (1 - Math.exp(-age * friction)) / friction;
        zones.push({
          x: item.x + item.vx * travelTime,
          y: item.y + item.vy * travelTime,
          radius: (56 + progress * 42) * 3,
        });
      });
      return zones;
    }

    function isInsideActivityZone(glyph, zones) {
      return zones.some(zone => {
        const dx = glyph.x - zone.x;
        const dy = glyph.y - zone.y;
        return dx * dx + dy * dy <= zone.radius * zone.radius;
      });
    }

    function resize() {
      width = host.innerWidth;
      height = host.innerHeight;
      const ratio = Math.min(host.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      glyphs = createGlyphField(width, height, width < 720 ? 40 : 34);
      if (baseCanvas && baseContext) {
        baseCanvas.width = canvas.width;
        baseCanvas.height = canvas.height;
        baseContext.setTransform(ratio, 0, 0, ratio, 0, 0);
        drawBase(baseContext);
      }
      draw(host.performance?.now?.() || Date.now());
    }

    function draw(now) {
      context.clearRect(0, 0, width, height);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      if (baseCanvas && baseContext) context.drawImage(baseCanvas, 0, 0, width, height);
      else drawBase(context);
      const zones = createActivityZones(now);
      if (!zones.length) return;
      glyphs.forEach(glyph => {
        if (!isInsideActivityZone(glyph, zones)) return;
        const state = calculateGlyphState(glyph, pointer, ripples, now, trails);
        renderGlyph(context, state);
      });
    }

    function requestAnimation() {
      if (!running || reducedMotion?.matches || frame) return;
      frame = host.requestAnimationFrame(animate);
    }

    function animate(now) {
      frame = 0;
      if (!running) return;
      const hadActivity = pointer.active || ripples.length || trails.length;
      if (pointer.active && now - pointer.lastAt >= POINTER_IDLE_TIME) pointer.active = false;
      ripples = ripples.filter(item => now - item.startedAt < RIPPLE_LIFETIME);
      trails = trails.filter(item => now - item.startedAt < TRAIL_LIFETIME);
      const hasActivity = pointer.active || ripples.length || trails.length;
      if (hadActivity && !hasActivity) {
        lastFrame = now;
        draw(now);
        return;
      }
      if (now - lastFrame < ACTIVE_FRAME_INTERVAL) {
        if (hasActivity) requestAnimation();
        return;
      }
      lastFrame = now;
      draw(now);
      if (hasActivity) requestAnimation();
    }

    function addRipple(x, y, strength, now, kind = 'flow') {
      ripples.push({ x, y, strength, startedAt: now, kind });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }

    function addTapRipples(x, y, now) {
      addRipple(x, y, 1.22, now, 'tap');
      addRipple(x, y, .62, now + 170, 'tap');
    }

    function addTrail(x, y, vx, vy, strength, now) {
      trails.push({ x, y, vx, vy, strength, startedAt: now });
      if (trails.length > MAX_TRAILS) trails.shift();
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
        if (!reducedMotion?.matches && speed > .025 && now - lastTrail > TRAIL_INTERVAL) {
          addTrail(x, y, pointer.vx, pointer.vy, cap(.32 + speed * 1.16, .32, 1.08), now);
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
      if (!reducedMotion?.matches && now - lastRipple > FLOW_RIPPLE_INTERVAL) {
        addRipple(pointer.x, pointer.y, .28, now);
        lastRipple = now;
      }
      if (reducedMotion?.matches) draw(now);
      else requestAnimation();
    }

    function activatePointer(x, y) {
      pointer.x = x;
      pointer.y = y;
      pointer.active = true;
      const now = host.performance?.now?.() || Date.now();
      pointer.lastAt = now;
      lastRipple = now;
      if (!reducedMotion?.matches) addTapRipples(pointer.x, pointer.y, now);
      else draw(now);
      requestAnimation();
    }

    function onPointerDown(event) {
      activatePointer(event.clientX, event.clientY);
    }

    function onTouchStart(event) {
      const touch = event.touches?.[0] || event.changedTouches?.[0];
      if (touch) activatePointer(touch.clientX, touch.clientY);
    }

    function deactivatePointer() {
      if (!pointer.active) return;
      const now = host.performance?.now?.() || Date.now();
      const speed = Math.hypot(pointer.vx, pointer.vy);
      if (!reducedMotion?.matches && speed > .025) {
        addTrail(pointer.x, pointer.y, pointer.vx, pointer.vy, cap(.42 + speed * 1.08, .42, 1.08), now);
      }
      pointer.active = false;
      if (reducedMotion?.matches) draw(now);
      else requestAnimation();
    }

    function onPointerLeave() {
      deactivatePointer();
    }

    function onPointerEnd(event) {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') deactivatePointer();
    }

    function onTouchEnd() {
      deactivatePointer();
    }

    function onResize() {
      host.clearTimeout(resizeTimer);
      resizeTimer = host.setTimeout(resize, 100);
    }

    function onVisibilityChange() {
      running = !document.hidden;
      if (running && !reducedMotion?.matches) {
        host.cancelAnimationFrame(frame);
        frame = 0;
        requestAnimation();
      } else if (!running) {
        host.cancelAnimationFrame(frame);
        frame = 0;
      }
    }

    function onMotionPreferenceChange() {
      host.cancelAnimationFrame(frame);
      frame = 0;
      if (reducedMotion?.matches) {
        ripples = [];
        trails = [];
      }
      resize();
      if (running && !reducedMotion?.matches) requestAnimation();
    }

    const needsTouchFallback = !('PointerEvent' in host);
    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    host.addEventListener('pointerup', onPointerEnd, { passive: true });
    host.addEventListener('pointercancel', onPointerEnd, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    if (needsTouchFallback) {
      host.addEventListener('touchstart', onTouchStart, { passive: true });
      host.addEventListener('touchend', onTouchEnd, { passive: true });
      host.addEventListener('touchcancel', onTouchEnd, { passive: true });
    }
    host.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    reducedMotion?.addEventListener?.('change', onMotionPreferenceChange);
    resize();

    return {
      destroy() {
        running = false;
        host.cancelAnimationFrame(frame);
        frame = 0;
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('pointerup', onPointerEnd);
        host.removeEventListener('pointercancel', onPointerEnd);
        host.removeEventListener('pointerleave', onPointerLeave);
        if (needsTouchFallback) {
          host.removeEventListener('touchstart', onTouchStart);
          host.removeEventListener('touchend', onTouchEnd);
          host.removeEventListener('touchcancel', onTouchEnd);
        }
        host.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        reducedMotion?.removeEventListener?.('change', onMotionPreferenceChange);
        delete canvas.dataset.ambientReady;
      },
    };
  }

  function install(host) {
    const document = host.document;
    const canvas = document.getElementById('ambientCanvas');
    const toggle = document.getElementById('ambientToggle');
    if (!canvas || !toggle || toggle.dataset.ambientToggleReady === 'true') return null;

    toggle.dataset.ambientToggleReady = 'true';
    let controller = null;
    let enabled = false;

    function updateToggle() {
      const label = enabled ? '关闭互动背景（可提高速度）' : '开启互动背景';
      toggle.setAttribute('aria-pressed', String(enabled));
      toggle.setAttribute('aria-label', label);
      toggle.dataset.tooltip = label;
      toggle.classList.toggle('active', enabled);
    }

    function storePreference() {
      try {
        host.localStorage?.setItem(STORAGE_KEY, String(enabled));
      } catch {
        // Storage can be unavailable in privacy modes; the toggle still works for this visit.
      }
    }

    function setEnabled(nextEnabled, persist = true) {
      const next = Boolean(nextEnabled);
      if (next === enabled && next && controller) {
        updateToggle();
        return enabled;
      }
      enabled = next;
      if (enabled) {
        canvas.classList.remove('hidden');
        controller = init(host);
      } else {
        controller?.destroy();
        controller = null;
        canvas.classList.add('hidden');
        canvas.width = 1;
        canvas.height = 1;
      }
      updateToggle();
      if (persist) storePreference();
      return enabled;
    }

    function onToggle() {
      setEnabled(!enabled);
    }

    toggle.addEventListener('click', onToggle);
    let storedPreference = false;
    try {
      storedPreference = host.localStorage?.getItem(STORAGE_KEY) === 'true';
    } catch {
      storedPreference = false;
    }
    setEnabled(storedPreference, false);

    return {
      get enabled() {
        return enabled;
      },
      setEnabled,
      destroy() {
        controller?.destroy();
        controller = null;
        toggle.removeEventListener('click', onToggle);
        delete toggle.dataset.ambientToggleReady;
      },
    };
  }

  return {
    GLYPHS,
    FLOW_RIPPLE_RADIUS,
    MAX_PIXEL_RATIO,
    MAX_RIPPLES,
    MAX_TRAILS,
    STORAGE_KEY,
    POINTER_RADIUS,
    RIPPLE_LIFETIME,
    TAP_RIPPLE_RADIUS,
    TRAIL_LIFETIME,
    calculateGlyphState,
    createGlyphField,
    init,
    install,
    pointerInfluence,
    rippleInfluence,
    seededValue,
    trailInfluence,
  };
});
