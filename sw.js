// ══════════════════════════════════════════
// SPAWN HARVEST — Service Worker
// Caches app shell for offline use
// ══════════════════════════════════════════

const CACHE_NAME = 'spawn-harvest-v1';
const OFFLINE_URLS = [
  '/VendoMonitor/harvest.html',
  '/VendoMonitor/sw.js'
];

// Install — cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(OFFLINE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — serve from cache first, fall back to network
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // For app shell — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        // Cache successful responses for app files
        if (response.ok && (
          event.request.url.includes('harvest.html') ||
          event.request.url.includes('sw.js')
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Return cached harvest.html as fallback for navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/VendoMonitor/harvest.html');
        }
      });
    })
  );
});

// Background sync — retry queued harvests when online
self.addEventListener('sync', event => {
  if (event.tag === 'harvest-sync') {
    event.waitUntil(syncQueuedHarvests());
  }
});

async function syncQueuedHarvests() {
  // Signal clients to attempt sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_NOW' }));
}
