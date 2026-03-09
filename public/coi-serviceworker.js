/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === 'deregister') {
      self.registration.unregister()
        .then(() => self.clients.matchAll())
        .then(clients => clients.forEach(client => client.navigate(client.url)));
    }
  });
  self.addEventListener('fetch', function (event) {
    const r = event.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    const newHeaders = new Headers(r.headers);
    if (coepCredentialless) {
      newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
    }
    const requestInit = {
      credentials: coepCredentialless ? 'omit' : r.credentials,
      headers: newHeaders,
    };
    if (r.mode !== 'navigate') {
      requestInit.mode = r.mode;
    }
    const request = new Request(r, requestInit);
    event.respondWith(
      fetch(request).then(response => {
        if (response.status === 0) return response;
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
        responseHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      })
    );
  });
} else {
  (async () => {
    const registration = await navigator.serviceWorker.register(
      window.location.pathname.endsWith('.html')
        ? window.location.pathname.replace(/\/[^/]*$/, '/coi-serviceworker.js')
        : 'coi-serviceworker.js'
    ).catch(console.error);
    if (!registration) return;
    if (!navigator.serviceWorker.controller) {
      window.location.reload();
    }
  })();
}
