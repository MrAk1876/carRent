const APP_CACHE = 'carrental-app-v1';
const STATIC_CACHE = 'carrental-static-v1';
const API_CACHE = 'carrental-api-v1';
const ACTIVE_CACHES = [APP_CACHE, STATIC_CACHE, API_CACHE];

const APP_SHELL_ASSETS = ['/', '/index.html', '/favicon.svg'];
const isLocalDevelopmentHost = ['localhost', '127.0.0.1'].includes(self.location.hostname);

if (isLocalDevelopmentHost) {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.registration.unregister().then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) =>
          Promise.all(
            clients.map((client) => {
              if ('navigate' in client) {
                return client.navigate(client.url);
              }
              return Promise.resolve();
            }),
          ),
        ),
      ),
    );
  });
}

self.addEventListener('install', (event) => {
  if (isLocalDevelopmentHost) return;
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .catch(() => null)
      .finally(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  if (isLocalDevelopmentHost) return;
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !ACTIVE_CACHES.includes(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .finally(() => self.clients.claim()),
  );
});

const isNavigationRequest = (request) => request.mode === 'navigate';

const isStaticAssetRequest = (request, url) => {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/assets/')) return true;
  if (url.pathname === '/favicon.svg') return true;
  return ['style', 'script', 'worker', 'font', 'image'].includes(request.destination);
};

const isApiRequest = (request, url) =>
  request.method === 'GET' && url.pathname.startsWith('/api/');

const putInCacheIfSuccessful = async (cacheName, request, response) => {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  cache.put(request, response.clone());
  return response;
};

const networkFirst = async (request, cacheName, fallbackRequest = null) => {
  try {
    const networkResponse = await fetch(request);
    await putInCacheIfSuccessful(cacheName, request, networkResponse);
    return networkResponse;
  } catch (_error) {
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;
    if (fallbackRequest) {
      const fallbackResponse = await cache.match(fallbackRequest);
      if (fallbackResponse) return fallbackResponse;
    }
    return Response.error();
  }
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    await putInCacheIfSuccessful(cacheName, request, networkResponse);
    return networkResponse;
  } catch (_error) {
    return Response.error();
  }
};

const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => putInCacheIfSuccessful(cacheName, request, response))
    .catch(() => null);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return Response.error();
};

self.addEventListener('fetch', (event) => {
  if (isLocalDevelopmentHost) return;
  const { request } = event;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request, APP_CACHE, '/index.html'));
    return;
  }

  if (isApiRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, STATIC_CACHE));
});

self.addEventListener('message', (event) => {
  const type = String(event?.data?.type || '').trim();
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const parsePushPayload = (event) => {
  if (!event || !event.data) {
    return {
      title: 'CarRental',
      message: 'You have a new notification',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: '/' },
      tag: 'carrental-notification',
    };
  }

  try {
    const parsed = event.data.json();
    return {
      title: String(parsed?.title || 'CarRental').trim(),
      message: String(parsed?.message || 'You have a new notification').trim(),
      icon: String(parsed?.icon || '/favicon.svg').trim(),
      badge: String(parsed?.badge || '/favicon.svg').trim(),
      data: {
        url: String(parsed?.data?.url || '/').trim() || '/',
        referenceId: String(parsed?.data?.referenceId || '').trim(),
        type: String(parsed?.data?.type || 'system').trim(),
      },
      tag: String(parsed?.tag || 'carrental-notification').trim(),
    };
  } catch (_error) {
    const text = String(event.data.text() || '').trim();
    return {
      title: 'CarRental',
      message: text || 'You have a new notification',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: '/' },
      tag: 'carrental-notification',
    };
  }
};

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.message,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      data: payload.data,
      renotify: true,
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = String(event?.notification?.data?.url || '/').trim() || '/';
  const targetAbsoluteUrl = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          const sameOrigin = String(client.url || '').startsWith(self.location.origin);
          if (sameOrigin) {
            client.navigate(targetAbsoluteUrl);
            return client.focus();
          }
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetAbsoluteUrl);
      }

      return undefined;
    }),
  );
});
