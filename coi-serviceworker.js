/*
 * Cross-origin isolation shim for static hosting (GitHub Pages, a USB stick
 * served by `python -m http.server`, ...).
 *
 * The simulator needs SharedArrayBuffer, which browsers only enable on pages
 * served with COOP/COEP headers. `node server.js` sends them directly; when
 * the page is served by something that cannot set headers, this service worker
 * adds them to every response it proxies and reloads the page once.
 */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    event.respondWith(fetch(req).then((res) => {
      if (res.status === 0) return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }));
  });
} else if (!window.crossOriginIsolated && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    if (reg.active && !navigator.serviceWorker.controller) {
      // the worker is installed but not yet controlling this page
      window.location.reload();
    }
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'activated' && !navigator.serviceWorker.controller) window.location.reload(); });
    });
  }).catch((e) => console.warn('coi-serviceworker registration failed', e));
}
