// SelectaDJ Cloud's app-shell service worker (`cloud.offline_shell`).
//
// It keeps only the app shell: the page (index.html) and the built, hashed scripts and styles
// under /assets/, plus the manifest and icons. A reload with no connection then opens SelectaDJ
// instead of the browser's error page. It never keeps an /api answer, an audio file or anything
// from another site: the library's own offline copy lives in the page's IndexedDB, and music
// stays in the member's own files.
//
// - The page is network first: a fresh copy whenever the network answers, the kept copy when it
//   does not (or takes longer than 6 seconds).
// - /assets/ files are named by their content hash, so a kept copy is always right: cache first.
// - The kiosk player (/kiosk, kiosk-sw.js), the Rooms pages (/r/..., /display) and the other
//   entries are left alone.
// The page registers this worker only in Cloud with the flag on, and unregisters it (and deletes
// its cache) when the flag is off.

const CACHE = 'selectadj-cloud-shell';
const PAGE = '/index.html';
const PAGE_TIMEOUT_MS = 6000;
/** Hashed files kept at most; the oldest go first, so old builds do not pile up. */
const MAX_FILES = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function leftAlone(url) {
  const path = url.pathname;
  return path.startsWith('/api/')
    || path === '/kiosk' || path.startsWith('/kiosk/') || path.startsWith('/kiosk.')
    || path.startsWith('/r/') || path === '/display' || path.startsWith('/display.') || path.startsWith('/display/')
    || path === '/guest.html' || path.endsWith('-sw.js')
    || path.endsWith('-harness.html');
}

function isShellFile(url) {
  const path = url.pathname;
  return path.startsWith('/assets/') || path.startsWith('/icons/') || path === '/manifest.webmanifest';
}

function looksLikePage(answer) {
  return answer.ok && answer.type === 'basic' && (answer.headers.get('content-type') || '').includes('text/html');
}

async function trim(cache) {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith('/assets/'));
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_FILES))) await cache.delete(request);
}

async function page(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then(async (answer) => {
    if (looksLikePage(answer)) await cache.put(PAGE, answer.clone());
    return answer;
  });
  // a late failure after the kept copy was served is nobody's error
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT_MS));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    const kept = await cache.match(PAGE);
    return kept || await network;
  } catch {
    const kept = await cache.match(PAGE);
    if (kept) return kept;
    throw new Error('offline and no kept page');
  }
}

async function shellFile(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const hashed = url.pathname.startsWith('/assets/');
  const kept = await cache.match(request, { ignoreSearch: !hashed });
  if (kept && hashed) return kept;
  try {
    const answer = await fetch(request);
    if (answer.ok && answer.type === 'basic') {
      await cache.put(request, answer.clone());
      if (hashed) await trim(cache);
    }
    return answer;
  } catch (problem) {
    if (kept) return kept;
    throw problem;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || leftAlone(url)) return;
  // audio and video (and any ranged read) are never kept
  if (request.destination === 'audio' || request.destination === 'video' || request.headers.has('range')) return;
  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  if (isShellFile(url)) event.respondWith(shellFile(request));
});

// The page tells the worker which shell files it already loaded before the worker was in
// charge, so the very first visit is enough for an offline reload. Only same-origin shell
// files are accepted.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'cloud-shell-warm' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      if (!(await cache.match(PAGE))) {
        try {
          const answer = await fetch(PAGE, { cache: 'no-cache' });
          if (looksLikePage(answer)) await cache.put(PAGE, answer);
        } catch {
          // offline right now: the next page load keeps it
        }
      }
      for (const raw of data.urls.slice(0, MAX_FILES)) {
        try {
          const url = new URL(String(raw), self.location.origin);
          if (url.origin !== self.location.origin || !isShellFile(url) || leftAlone(url)) continue;
          if (await cache.match(url.href)) continue;
          const answer = await fetch(url.href);
          if (answer.ok && answer.type === 'basic') await cache.put(url.href, answer);
        } catch {
          // one file missing is not worth failing the rest
        }
      }
    })());
  }
  if (data.type === 'cloud-shell-forget') event.waitUntil(caches.delete(CACHE));
});
