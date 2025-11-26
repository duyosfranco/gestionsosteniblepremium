const CACHE_NAME = 'gs-cache-v1';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/clientes-firestore.html',
  '/finanzas.html',
  '/retiros.html',
  '/usuarios.html',
  '/configuracion.html',
  '/assets/gs-auth.js',
  '/assets/demo-data.js'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache)=> cache.addAll(OFFLINE_URLS)).catch(()=>{})
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then((keys)=> Promise.all(keys.map((key)=> key !== CACHE_NAME ? caches.delete(key) : null)))
  );
});

self.addEventListener('fetch', (event)=>{
  const { request } = event;
  if(request.method !== 'GET'){ return; }
  event.respondWith(
    caches.match(request).then((cached)=>{
      const fetchPromise = fetch(request).then((response)=>{
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache)=> cache.put(request, clone)).catch(()=>{});
        return response;
      }).catch(()=> cached || Response.error());
      return cached || fetchPromise;
    })
  );
});
