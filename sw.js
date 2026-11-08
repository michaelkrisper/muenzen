// Precache everything; after that the app needs no network.
// Two caches: the small app shell and the large vendor files (OpenCV.js,
// 11 MB). On deploy, CI replaces the "dev" in each name with a content hash of
// that cache's files (tools/stamp-sw.mjs). A cache thus gets a new name exactly
// when one of its files changes, and an app update keeps OpenCV.js.
const SHELL_CACHE = 'muenzen-shell-dev';
const ASSETS_CACHE = 'muenzen-assets-dev';
// All apps on michaelkrisper.github.io share one origin and thus one
// CacheStorage, so cleanup only touches caches with this app's prefix.
const PREFIX = 'muenzen-';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'classify.js',
  'detect.js',
  'worker.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];
const ASSETS = ['vendor/opencv.js'];

// Fetches only what a cache of the same name does not hold yet, past the HTTP
// cache, so a new cache name never stores an outdated file.
const fill = (name, files) =>
  caches
    .open(name)
    .then((cache) =>
      Promise.all(
        files.map(async (f) => (await cache.match(f)) || cache.add(new Request(f, { cache: 'reload' }))),
      ),
    );

self.addEventListener('install', (e) => {
  e.waitUntil(
    Promise.all([fill(SHELL_CACHE, SHELL), fill(ASSETS_CACHE, ASSETS)]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== SHELL_CACHE && k !== ASSETS_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
