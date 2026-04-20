const CACHE = 'spawn-harvest-v1';
const OFFLINE_QUEUE_KEY = 'harvest_offline_queue';

const ASSETS = [
  '/VendoMonitor/harvest.html',
  '/VendoMonitor/manifest.json'
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — serve from cache when offline
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Supabase API calls — try network, queue if offline
  if (url.hostname.includes('supabase.co') && e.request.method === 'POST') {
    e.respondWith(
      fetch(e.request.clone()).catch(async () => {
        // Offline — store in queue
        const body = await e.request.clone().text();
        const queue = JSON.parse((await getFromIDB(OFFLINE_QUEUE_KEY)) || '[]');
        queue.push({
          url: e.request.url,
          method: e.request.method,
          headers: Object.fromEntries(e.request.headers.entries()),
          body: body,
          timestamp: Date.now()
        });
        await saveToIDB(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
        return new Response(JSON.stringify({ offline: true, queued: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Static assets — cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});

// Sync — flush offline queue when back online
self.addEventListener('sync', e => {
  if (e.tag === 'harvest-sync') {
    e.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  const raw = await getFromIDB(OFFLINE_QUEUE_KEY);
  if (!raw) return;
  const queue = JSON.parse(raw);
  if (!queue.length) return;
  const remaining = [];
  for (const req of queue) {
    try {
      await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body
      });
    } catch {
      remaining.push(req);
    }
  }
  await saveToIDB(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  // Notify all clients
  const clients = await self.clients.matchAll();
  clients.forEach(c => c.postMessage({ type: 'sync-complete', remaining: remaining.length }));
}

// Simple IDB helpers
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('spawn-harvest', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('kv');
    r.onsuccess = e => res(e.target.result);
    r.onerror = () => rej(r.error);
  });
}
async function getFromIDB(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function saveToIDB(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
