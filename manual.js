(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    const start = () => api.install(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function install(documentRef) {
    const openButton = documentRef.getElementById('manualBtn');
    const modal = documentRef.getElementById('manualModal');
    if (!openButton || !modal) return () => {};

    const closeButtons = [...modal.querySelectorAll('[data-manual-close]')];
    let returnFocus = null;

    function open() {
      returnFocus = documentRef.activeElement;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      documentRef.body.classList.add('manual-open');
      closeButtons[0]?.focus();
    }

    function close() {
      if (modal.classList.contains('hidden')) return;
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      documentRef.body.classList.remove('manual-open');
      returnFocus?.focus?.();
    }

    function onBackdropClick(event) {
      if (event.target === modal) close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) close();
    }

    openButton.addEventListener('click', open);
    closeButtons.forEach(button => button.addEventListener('click', close));
    modal.addEventListener('click', onBackdropClick);
    documentRef.addEventListener('keydown', onKeydown);

    return () => {
      openButton.removeEventListener('click', open);
      closeButtons.forEach(button => button.removeEventListener('click', close));
      modal.removeEventListener('click', onBackdropClick);
      documentRef.removeEventListener('keydown', onKeydown);
    };
  }

  return { install };
});
