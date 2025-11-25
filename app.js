(function(global){
  'use strict';

  /**
   * App shell refactor for Gestión Sostenible.
   * - Centralized router + loading/error states.
   * - Session-aware guards with demo/production separation.
   * - Frame lifecycle management (create/reload/hide) for embedded modules.
   * - Lightweight analytics hooks ready to send to Firestore or other sinks.
   */

  const ROUTES = Object.freeze({
    '/': { key: '/', label: 'Inicio', subtitle: 'Vista general y KPIs', moduleKey: 'home', type: 'home' },
    '/clientes': { key: '/clientes', label: 'Clientes', subtitle: 'Gestión, segmentos y mapas', moduleKey: 'clientes', page: 'clientes-firestore.html' },
    '/retiros': { key: '/retiros', label: 'Retiros', subtitle: 'Planificación y optimización', moduleKey: 'rutas', page: 'retiros.html' },
    '/finanzas': { key: '/finanzas', label: 'Finanzas', subtitle: 'Flujos, proyecciones y DGI', moduleKey: 'finanzas', page: 'finanzas.html' },
    '/usuarios': { key: '/usuarios', label: 'Usuarios', subtitle: 'Roles, permisos y auditoría', moduleKey: 'usuarios', page: 'usuarios.html' },
    '/configuracion': { key: '/configuracion', label: 'Configuración', subtitle: 'Seguridad, SMS y dominios', moduleKey: 'configuracion', page: 'configuracion.html' },
    '/temas': { key: '/temas', label: 'Temas', subtitle: 'Personalización visual', moduleKey: 'temas', page: 'temas.html' }
  });

  const DEFAULT_OPTIONS = {
    selectors: {
      homeView: '#homeView',
      viewer: '#viewer',
      viewerLoading: '#viewerLoading',
      viewerLoadingTitle: '#viewerLoadingTitle',
      viewerLoadingText: '#viewerLoadingText',
      viewerError: '#viewerError',
      viewerErrorTitle: '#viewerErrorTitle',
      viewerErrorText: '#viewerErrorText',
      sideNav: '#sideNav',
      pageTitle: '#pageTitle',
      pageSubtitle: '#pageSubtitle'
    },
    storageKey: 'gs:lastRoute',
    iframeClass: 'module-frame',
    iframeLoadedClass: 'loaded',
    loaderCopy: {
      title: ()=> `${getBrandName()} · Cargando`,
      subtitle: 'Sincronizando la vista con tu sesión.'
    }
  };

  const state = {
    session: null,
    abilities: null,
    activeRoute: null,
    frames: new Map(),
    ready: false
  };

  /**
   * Small analytics facade to centralize event logging.
   */
  const analytics = {
    sink: null, // set to Firestore collection or external endpoint later
    log(eventName, payload){
      const entry = Object.assign({
        event: eventName,
        ts: Date.now(),
        route: state.activeRoute ? state.activeRoute.key : null,
        uid: state.session && state.session.user ? state.session.user.uid : null,
        demo: isDemoSession()
      }, payload || {});
      if(this.sink && typeof this.sink === 'function'){
        try{ this.sink(entry); }
        catch(err){ console.warn('Analytics sink failed', err); }
      }else{
        console.debug('[analytics]', entry);
      }
    }
  };

  function getBrandName(){
    return (global.gsAuth && typeof global.gsAuth.getTheme === 'function'
      ? (global.gsAuth.getTheme() && global.gsAuth.getTheme().brandName)
      : null) || 'Gestión Sostenible';
  }

  function isDemoSession(){
    if(global.gsAuth && typeof global.gsAuth.isDemoSession === 'function'){
      return !!global.gsAuth.isDemoSession();
    }
    const status = state.session && state.session.status;
    return status === 'demo';
  }

  function select(el){ return typeof el === 'string' ? document.querySelector(el) : el; }

  function buildDomRefs(options){
    const refs = {};
    Object.entries(options.selectors).forEach(([key, selector])=>{
      refs[key] = select(selector);
    });
    return refs;
  }

  function normalizeHash(hash){
    const clean = (hash || '').replace(/^#/,'');
    return clean.startsWith('/') ? clean : `/${clean}`;
  }

  function getRouteFromHash(hash){
    const normalized = normalizeHash(hash || '#/');
    return ROUTES[normalized] || ROUTES['/'];
  }

  function persistRoute(route, storageKey){
    if(!route){ return; }
    try{ localStorage.setItem(storageKey, route.key); }
    catch(err){ /* storage unavailable */ }
  }

  function readPersistedRoute(storageKey){
    try{
      const val = localStorage.getItem(storageKey);
      return val && ROUTES[val] ? ROUTES[val] : ROUTES['/'];
    }catch(err){ return ROUTES['/']; }
  }

  function ensureFrame(route, refs, options){
    if(!route || !route.page || !refs.viewer){ return null; }
    const existing = state.frames.get(route.key);
    if(existing && refs.viewer.contains(existing)){ return existing; }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', route.label);
    iframe.setAttribute('data-page', route.page);
    iframe.setAttribute('data-page-label', route.label);
    if(route.moduleKey){ iframe.setAttribute('data-module-key', route.moduleKey); }
    iframe.className = options.iframeClass;
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'no-referrer';
    iframe.addEventListener('load', ()=>{
      iframe.dataset.loaded = 'true';
      iframe.classList.add(options.iframeLoadedClass);
      hideLoader(refs, options);
      analytics.log('module_loaded', { module: route.moduleKey });
    });
    iframe.addEventListener('error', ()=>{
      showModuleError(refs, route.label, 'No pudimos cargar la vista. Revisá tu conexión e intenta nuevamente.');
      analytics.log('module_error', { module: route.moduleKey });
    });
    refs.viewer.appendChild(iframe);
    state.frames.set(route.key, iframe);
    return iframe;
  }

  function hideFrames(activeFrame){
    state.frames.forEach((frame)=>{
      if(frame === activeFrame){ return; }
      frame.classList.add('hidden');
      frame.setAttribute('aria-hidden','true');
      frame.setAttribute('tabindex','-1');
    });
  }

  function setNavActive(refs, hash){
    if(!refs.sideNav){ return; }
    const links = refs.sideNav.querySelectorAll('a[href]');
    links.forEach((a)=>{
      a.classList.toggle('active', a.getAttribute('href') === hash);
    });
  }

  function showLoader(refs, options, title, subtitle){
    if(refs.viewerError){ refs.viewerError.classList.add('hidden'); }
    if(refs.viewerLoading){
      refs.viewerLoading.classList.remove('hidden');
    }
    if(refs.viewerLoadingTitle){
      const copy = typeof options.loaderCopy.title === 'function'
        ? options.loaderCopy.title()
        : options.loaderCopy.title;
      refs.viewerLoadingTitle.textContent = title || copy;
    }
    if(refs.viewerLoadingText){
      refs.viewerLoadingText.textContent = subtitle || options.loaderCopy.subtitle;
    }
  }

  function hideLoader(refs, options){
    if(refs.viewerLoading){ refs.viewerLoading.classList.add('hidden'); }
    if(refs.viewerLoadingTitle){
      const copy = typeof options.loaderCopy.title === 'function'
        ? options.loaderCopy.title()
        : options.loaderCopy.title;
      refs.viewerLoadingTitle.textContent = copy;
    }
    if(refs.viewerLoadingText){ refs.viewerLoadingText.textContent = options.loaderCopy.subtitle; }
  }

  function showModuleError(refs, label, detail){
    if(!refs.viewerError){ return; }
    if(refs.viewerErrorTitle){ refs.viewerErrorTitle.textContent = `No pudimos abrir ${label}.`; }
    if(refs.viewerErrorText){ refs.viewerErrorText.textContent = detail || 'Revisá tu conexión y reintentá.'; }
    refs.viewerError.classList.remove('hidden');
    hideLoader(refs, DEFAULT_OPTIONS);
  }

  function updateHeader(refs, route){
    if(refs.pageTitle){ refs.pageTitle.textContent = route.label || ''; }
    if(refs.pageSubtitle){
      const subtitle = route.subtitle || (route.page
        ? 'Tu sesión sigue activa, cargamos el módulo seleccionado en este panel.'
        : 'Resumen general y accesos rápidos.');
      refs.pageSubtitle.textContent = subtitle;
    }
    setNavActive(refs, `#${route.key}`);
  }

  function applySessionState(session){
    const body = document.body;
    if(!body){ return; }
    const role = normalizeRole(session && session.role);
    const status = session ? (session.status || 'authenticated') : 'signed-out';
    body.dataset.gsSessionState = session ? 'authenticated' : 'signed-out';
    if(role){ body.dataset.gsRole = role; }
    else{ delete body.dataset.gsRole; }
    if(session && session.user){ body.classList.add('gs-authenticated'); }
    else{ body.classList.remove('gs-authenticated'); }
    analytics.log('session_state', { status, role });
  }

  function normalizeRole(value){
    if(!value){ return null; }
    return String(value).toLowerCase();
  }

  function hasPermission(route){
    if(!route || route.type === 'home'){ return true; }
    const abilities = state.abilities || {};
    const modulePermission = abilities[route.moduleKey];
    if(modulePermission === false){ return false; }
    return true;
  }

  function hydrateAbilities(session){
    const abilities = (session && session.abilities && session.abilities.modulePermissions)
      || (global.gsAuth && typeof global.gsAuth.getModulePermissions === 'function' && global.gsAuth.getModulePermissions())
      || {};
    state.abilities = abilities;
  }

  async function ensureSession(){
    if(!global.gsAuth || typeof global.gsAuth.onSession !== 'function'){ return; }
    global.gsAuth.onSession((session)=>{
      state.session = session;
      hydrateAbilities(session);
      applySessionState(session);
      if(state.ready){
        navigate(location.hash, state.refs, state.options);
      }
    });
  }

  function navigate(hash, refs, options){
    const route = getRouteFromHash(hash);
    state.activeRoute = route;
    if(!hasPermission(route)){
      showModuleError(refs, route.label, 'No tenés permisos para este módulo.');
      if(location.hash !== '#/'){ location.hash = '#/'; }
      return;
    }

    updateHeader(refs, route);
    persistRoute(route, options.storageKey);

    if(route.type === 'home' || !route.page){
      state.frames.forEach((frame)=>{ frame.classList.add('hidden'); });
      if(refs.homeView){ refs.homeView.classList.remove('hidden'); }
      hideLoader(refs, options);
      analytics.log('route_change', { module: 'home' });
      return;
    }

    if(refs.homeView){ refs.homeView.classList.add('hidden'); }
    const frame = ensureFrame(route, refs, options);
    if(!frame){
      showModuleError(refs, route.label, 'No pudimos inicializar el módulo.');
      return;
    }

    hideFrames(frame);
    frame.classList.remove('hidden');
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');

    const currentSrc = frame.getAttribute('src');
    if(currentSrc !== route.page){
      showLoader(refs, options, `Abriendo ${route.label}`, 'Sincronizando datos con tu sesión.');
      frame.dataset.loaded = '';
      frame.classList.remove(options.iframeLoadedClass);
      frame.setAttribute('src', route.page);
    }else if(frame.dataset.loaded !== 'true'){
      showLoader(refs, options, `Abriendo ${route.label}`, 'Sincronizando datos con tu sesión.');
      if(!currentSrc){ frame.setAttribute('src', route.page); }
    }else{
      hideLoader(refs, options);
    }
    analytics.log('route_change', { module: route.moduleKey });
  }

  function restoreInitialRoute(options){
    const target = location.hash ? getRouteFromHash(location.hash) : readPersistedRoute(options.storageKey);
    if(!location.hash && target && target.key !== '/'){
      location.hash = `#${target.key}`;
    }else{
      navigate(location.hash || '#/', state.refs, options);
    }
  }

  function prefetchRoutes(){
    const links = document.querySelectorAll('link[rel="prefetch"][as="document"]');
    if(links && links.length){ return; }
    Object.values(ROUTES).forEach((route)=>{
      if(!route.page){ return; }
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'document';
      link.href = route.page;
      document.head.appendChild(link);
    });
  }

  function bootstrap(customOptions){
    const options = Object.assign({}, DEFAULT_OPTIONS, customOptions || {});
    const refs = buildDomRefs(options);
    state.options = options;
    state.refs = refs;

    prefetchRoutes();
    ensureSession();
    restoreInitialRoute(options);

    window.addEventListener('hashchange', ()=> navigate(location.hash, refs, options));
    state.ready = true;
    analytics.log('app_boot', { demo: isDemoSession() });
  }

  global.gsApp = Object.freeze({ bootstrap, analytics, ROUTES });
})(window);
