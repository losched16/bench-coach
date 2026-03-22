// BenchCoach Service Worker - minimal for PWA install support
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Pass through all requests to network (no offline caching for now)
  event.respondWith(fetch(event.request))
})
