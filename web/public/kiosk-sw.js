// The kiosk player's service worker (ADR-0445 auto-update, ADR-0446 offline start).
//
// It keeps the kiosk page and its files in a cache so a player that boots with no internet
// still opens /kiosk and plays its saved music. It never touches /api calls or audio files
// (those live in the player's own IndexedDB cache). Updates are two-step so a new version never
// lands during service: "kiosk-check-update" fetches the newest page and files into a second
// cache; "kiosk-activate-update" (sent by the page only while the zone is closed, or for an
// urgent fix at a song boundary) swaps that cache in. A failed fetch or swap keeps the old one.

const ACTIVE = 'selectadj-kiosk-active';
const NEXT = 'selectadj-kiosk-next';
const PAGE = '/kiosk';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function isShellRequest(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return url.pathname === PAGE || url.pathname === '/kiosk/' || url.pathname === '/kiosk.html' || url.pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  if (!isShellRequest(event.request)) return;
  const isPage = event.request.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(ACTIVE);
    const key = isPage ? PAGE : event.request;
    const saved = await cache.match(key);
    if (saved) return saved;
    const answer = await fetch(event.request);
    if (answer.ok) await cache.put(key, answer.clone());
    return answer;
  })());
});

async function tell(type) {
  const pages = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const page of pages) page.postMessage({ type });
}

/** Fetch the newest page and every script and stylesheet it names into the second cache. */
async function fetchNext() {
  await caches.delete(NEXT);
  const next = await caches.open(NEXT);
  const page = await fetch(PAGE, { cache: 'no-store' });
  if (!page.ok) throw new Error('page');
  const html = await page.clone().text();
  await next.put(PAGE, page);
  const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((found) => found[1]);
  for (const file of files) {
    const answer = await fetch(file, { cache: 'no-store' });
    if (!answer.ok) throw new Error('file');
    await next.put(file, answer);
  }
}

async function swap() {
  const next = await caches.open(NEXT);
  const keys = await next.keys();
  if (!keys.length) throw new Error('nothing');
  await caches.delete(ACTIVE);
  const active = await caches.open(ACTIVE);
  for (const request of keys) {
    const answer = await next.match(request);
    if (answer) await active.put(request, answer);
  }
  await caches.delete(NEXT);
}

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'kiosk-check-update') {
    event.waitUntil(fetchNext().then(() => tell('kiosk-update-ready'), () => tell('kiosk-update-failed')));
  } else if (type === 'kiosk-activate-update') {
    event.waitUntil(swap().then(() => tell('kiosk-activated'), () => tell('kiosk-activate-failed')));
  }
});
