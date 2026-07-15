(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.ButtonMotion = api;
    if (root.document) api.install(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CONFIRM_CLASS = 'elastic-confirm';

  function install(host) {
    const document = host?.document;
    if (!document || document.documentElement?.dataset.buttonMotionReady === 'true') return null;

    const onClick = event => {
      const button = event.target?.closest?.('button');
      if (!button || button.disabled) return;
      button.classList.remove(CONFIRM_CLASS);
      void button.offsetWidth;
      button.classList.add(CONFIRM_CLASS);
      button.addEventListener('animationend', () => button.classList.remove(CONFIRM_CLASS), { once: true });
    };

    document.addEventListener('click', onClick, true);
    if (document.documentElement?.dataset) document.documentElement.dataset.buttonMotionReady = 'true';

    return {
      destroy() {
        document.removeEventListener('click', onClick, true);
        delete document.documentElement?.dataset.buttonMotionReady;
      },
    };
  }

  return { CONFIRM_CLASS, install };
});

