(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    const start = () => api.install(root);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function install(root) {
    const documentRef = root.document;
    const button = documentRef?.getElementById('pwaInstallBtn');
    if (!button) return () => {};

    let installPrompt = null;
    const standalone = () => root.matchMedia?.('(display-mode: standalone)').matches || root.navigator?.standalone === true;
    const isAppleMobile = /iPhone|iPad|iPod/i.test(root.navigator?.userAgent || '');
    const notify = message => {
      if (typeof root.studioApi?.notify === 'function') {
        root.studioApi.notify(message);
        return;
      }
      root.alert?.(message);
    };

    function updateButton() {
      button.classList.toggle('hidden', standalone());
    }

    function onBeforeInstall(event) {
      event.preventDefault();
      installPrompt = event;
      updateButton();
    }

    async function onInstallClick() {
      if (installPrompt) {
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        installPrompt = null;
        if (choice?.outcome === 'accepted') button.classList.add('hidden');
        return;
      }
      if (isAppleMobile) {
        notify('请点击浏览器“分享”，再选择“添加到主屏幕”');
        return;
      }
      notify('请在浏览器菜单中选择“安装应用”或“将此网站作为应用安装”');
    }

    function onInstalled() {
      installPrompt = null;
      button.classList.add('hidden');
      notify('豆绘已安装，可从桌面或主屏幕打开');
    }

    button.addEventListener('click', onInstallClick);
    root.addEventListener?.('beforeinstallprompt', onBeforeInstall);
    root.addEventListener?.('appinstalled', onInstalled);
    updateButton();

    const secure = root.location?.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(root.location?.hostname);
    if (secure && root.navigator?.serviceWorker) {
      root.navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    return () => {
      button.removeEventListener('click', onInstallClick);
      root.removeEventListener?.('beforeinstallprompt', onBeforeInstall);
      root.removeEventListener?.('appinstalled', onInstalled);
    };
  }

  return { install };
});
