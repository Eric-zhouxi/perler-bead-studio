(function exposeAmbientBackground(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DouhuiAmbientBackground = api;
  if (root?.document) api.init(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildAmbientBackground() {
  const MAGNET_SIZE = 240;
  const MAX_PULSES = 3;
  const EASING = .24;
  const REST_DISTANCE = .35;
  const IDLE_DELAY = 520;

  const cap = (value, min, max) => Math.max(min, Math.min(max, value));

  function magnetTransform(x, y, tilt = 0) {
    const left = (x - MAGNET_SIZE / 2).toFixed(1);
    const top = (y - MAGNET_SIZE / 2).toFixed(1);
    return `translate3d(${left}px, ${top}px, 0) rotate(${tilt.toFixed(2)}deg)`;
  }

  function init(host) {
    const document = host.document;
    const field = document.getElementById('ambientField');
    const magnet = document.getElementById('ambientMagnet');
    if (!field || !magnet || field.dataset.ambientReady === 'true') return null;

    field.dataset.ambientReady = 'true';
    const reducedMotion = host.matchMedia?.('(prefers-reduced-motion: reduce)');
    const pulses = [];
    const pulseTimers = new Map();
    let frame = 0;
    let hideTimer = 0;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let positioned = false;
    let running = true;

    function cancelFrame() {
      if (!frame) return;
      host.cancelAnimationFrame(frame);
      frame = 0;
    }

    function scheduleFrame() {
      if (!running || reducedMotion?.matches || frame) return;
      frame = host.requestAnimationFrame(renderFrame);
    }

    function renderFrame() {
      frame = 0;
      if (!running) return;
      const dx = targetX - currentX;
      const dy = targetY - currentY;
      currentX += dx * EASING;
      currentY += dy * EASING;
      magnet.style.transform = magnetTransform(currentX, currentY, cap(dx * .045, -4, 4));
      if (Math.abs(dx) + Math.abs(dy) > REST_DISTANCE) scheduleFrame();
    }

    function hideMagnet() {
      magnet.classList.remove('is-visible');
    }

    function queueHide() {
      host.clearTimeout(hideTimer);
      hideTimer = host.setTimeout(hideMagnet, IDLE_DELAY);
    }

    function positionMagnet(x, y) {
      targetX = x;
      targetY = y;
      if (!positioned) {
        currentX = x;
        currentY = y;
        positioned = true;
        magnet.style.transform = magnetTransform(x, y);
      }
      magnet.classList.add('is-visible');
      queueHide();
      if (reducedMotion?.matches) {
        currentX = x;
        currentY = y;
        magnet.style.transform = magnetTransform(x, y);
      } else {
        scheduleFrame();
      }
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch') return;
      positionMagnet(event.clientX, event.clientY);
    }

    function removePulse(pulse) {
      const timer = pulseTimers.get(pulse);
      if (timer) host.clearTimeout(timer);
      pulseTimers.delete(pulse);
      const index = pulses.indexOf(pulse);
      if (index >= 0) pulses.splice(index, 1);
      pulse.remove?.();
    }

    function addPulse(x, y) {
      if (reducedMotion?.matches) return;
      const pulse = document.createElement('span');
      pulse.className = 'ambient-pulse';
      pulse.style.left = `${x}px`;
      pulse.style.top = `${y}px`;
      field.appendChild(pulse);
      pulses.push(pulse);
      while (pulses.length > MAX_PULSES) removePulse(pulses[0]);
      pulse.addEventListener?.('animationend', () => removePulse(pulse), { once: true });
      pulseTimers.set(pulse, host.setTimeout(() => removePulse(pulse), 900));
    }

    function onPointerDown(event) {
      addPulse(event.clientX, event.clientY);
      if (event.pointerType !== 'touch') positionMagnet(event.clientX, event.clientY);
    }

    function onPointerLeave() {
      host.clearTimeout(hideTimer);
      hideMagnet();
    }

    function onMotionPreferenceChange() {
      cancelFrame();
      if (reducedMotion?.matches) {
        pulses.slice().forEach(removePulse);
        hideMagnet();
      }
    }

    host.addEventListener('pointermove', onPointerMove, { passive: true });
    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    host.addEventListener('pointerleave', onPointerLeave, { passive: true });
    host.addEventListener('blur', onPointerLeave);
    reducedMotion?.addEventListener?.('change', onMotionPreferenceChange);

    return {
      destroy() {
        running = false;
        cancelFrame();
        host.clearTimeout(hideTimer);
        pulses.slice().forEach(removePulse);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('pointerleave', onPointerLeave);
        host.removeEventListener('blur', onPointerLeave);
        reducedMotion?.removeEventListener?.('change', onMotionPreferenceChange);
        magnet.classList.remove('is-visible');
        delete field.dataset.ambientReady;
      },
    };
  }

  return {
    IDLE_DELAY,
    MAGNET_SIZE,
    MAX_PULSES,
    init,
    magnetTransform,
  };
});
