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
} else if (window.crossOriginIsolated) {
  // isolation is working; allow a future retry if it ever stops working
  try { sessionStorage.removeItem('coi-reloaded'); } catch (e) { /* ignore */ }
} else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const src = document.currentScript.src;
  navigator.serviceWorker.register(src).then(async () => {
    // Wait until a worker is active, then reload ONCE so the document itself is
    // fetched through the worker and picks up the headers. The sessionStorage
    // flag stops a reload loop in browsers where isolation still fails.
    await navigator.serviceWorker.ready;
    let already = false;
    try { already = sessionStorage.getItem('coi-reloaded') === '1'; if (!already) sessionStorage.setItem('coi-reloaded', '1'); } catch (e) { /* ignore */ }
    if (!already) window.location.reload();
  }).catch((e) => console.warn('coi-serviceworker registration failed', e));
}
