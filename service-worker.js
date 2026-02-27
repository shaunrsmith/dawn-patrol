// Dawn Patrol Service Worker
const CACHE_NAME = 'dawn-patrol-v5';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/style.css',
    '/manifest.json'
];

// Install - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - network first for API calls, cache first for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API calls - always try network first
    if (url.hostname.includes('api') ||
        url.hostname.includes('services.surfline.com') ||
        url.hostname.includes('open-meteo.com') ||
        url.hostname.includes('marine-api.open-meteo.com') ||
        url.hostname.includes('tidesandcurrents.noaa.gov') ||
        url.hostname.includes('sunrise-sunset.org')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    // Cache successful API responses for 30 minutes
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME + '-api').then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Fall back to cached API response if offline
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Static assets - cache first
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(event.request).then((response) => {
                    if (!response || response.status !== 200) {
                        return response;
                    }
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                    return response;
                });
            })
    );
});
