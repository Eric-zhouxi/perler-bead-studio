const CACHE_PREFIX = 'douhui-static-';
const CACHE_NAME = `${CACHE_PREFIX}v1.1.2`;
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=region-fill-20260715',
  './auth.css',
  './button-motion.css?v=elastic-buttons-20260715',
  './manual.css?v=detailed-guide-20260715',
  './pwa.css?v=installable-app-20260715',
  './ripple-background.js?v=default-on-20260714',
  './button-motion.js?v=elastic-buttons-20260715',
  './manual.js?v=detailed-guide-20260715',
  './pwa.js?v=installable-app-20260715',
  './palette.js',
  './conversion-strategies.js?v=neutral-black-20260714',
  './app.js?v=region-fill-20260715',
  './api-config.js',
  './account.js?v=mode-transition-20260715',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put('./index.html', response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || caches.match('./index.html');
  }
}

async function staticResponse(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? navigationResponse(request) : staticResponse(request));
});
