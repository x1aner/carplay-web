// TiPlay's page moved from play/ to the site root. This worker replaces the one that play/ registered: it
// unregisters itself and reloads its pages, so they reach play/index.html, which forwards to the site root.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()
  .then(() => self.clients.matchAll({ type: 'window' }))
  .then(clients => Promise.all(clients.map(client => client.navigate(client.url).catch(() => {}))))));
