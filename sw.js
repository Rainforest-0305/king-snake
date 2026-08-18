/* King Snake - offline service worker (Microsoft Store / GitHub Pages PWA build)
 *
 * ★ This file ships two placeholder tokens, __CACHE_NAME__ and
 *   __PRECACHE_LIST__. They are NOT valid JS as committed here - Vite copies
 *   this file verbatim (public/** passthrough), and tools/build_pwa.py then
 *   rewrites the copy in store/pwa/sw.js, substituting:
 *     - __CACHE_NAME__    -> 'king-snake-v1-<8 hex chars of a sha256 over every
 *                             deployed file's path + bytes>'
 *     - __PRECACHE_LIST__ -> the real list of deployed file paths, discovered
 *                             from store/pwa/ itself (Vite hashes asset
 *                             filenames, so a hand-written list would rot the
 *                             moment a rebuild changes a hash).
 *   Do not hand-edit the tokens out of this source file, and do not hand-edit
 *   store/pwa/sw.js - it is regenerated (wiped + rebuilt) on every
 *   `python tools/build_pwa.py` run.
 *
 * Strategy
 *   navigation / index.html : network-first, cache fallback
 *       -> an online player always gets the freshest build, so a redeploy can
 *          never be masked by a stale cached page; an offline player still
 *          gets the last good copy.
 *   everything else         : cache-first
 *       -> Vite asset filenames are content-hashed and icons are immutable per
 *          CACHE version, so a cache hit is always the correct bytes.
 */
const CACHE = 'king-snake-v1-90231f82';
const PRECACHE = [
  "./",
  "./assets/index-BXPeWUgG.js",
  "./assets/style-H7WDGssU.css",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-48.png",
  "./icons/icon-512.png",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/maskable-192.png",
  "./icons/maskable-512.png",
  "./index.html",
  "./manifest.json",
  "./privacy.html"
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
