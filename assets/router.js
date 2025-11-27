(function(global){
  'use strict';

  const config = global.gsConfig || {};
  const ROUTES = config.ROUTES || {};
  const SELECTORS = config.SELECTORS || {};
  const STORAGE_KEYS = config.STORAGE_KEYS || {};

  const state = {
    refs: {},
    frames: new Map(),
    activeRoute: null,
    session: null,
    options: {
      iframeClass: 'module-frame',
      iframeLoadedClass: 'loaded',
      loaderCopy: {
        title: ()=> `${getBrandName()} · Cargando`,
        subtitle: 'Sincronizando la vista con tu sesión.'
      }
    }
  };

  function select(sel){ return typeof sel === 'string' ? document.querySelector(sel) : sel; }

  function buildRefs(){
    const refs = {};
    Object.entries(SELECTORS).forEach(([key, selector])=>{
      refs[key] = select(selector);
    });
    return refs;
  }

  function getBrandName(){
    return (global.gsAuth && typeof global.gsAuth.getTheme === 'function'
      ? (global.gsAuth.getTheme() && global.gsAuth.getTheme().brandName)
      : null) || 'Gestión Sostenible';
  }

  function normalizeHash(hash){
    const clean = (hash || '').replace(/^#/, '');
    return clean.startsWith('/') ? clean : `/${clean}`;
  }

  function getRouteFromHash(hash){
    const normalized = normalizeHash(hash || '#/');
    return ROUTES[normalized] || ROUTES['/'];
  }

  function persistRoute(route){
    if(!route){ return; }
    try{ localStorage.setItem(STORAGE_KEYS.lastRoute || 'gs:lastRoute', route.key); }
    catch(err){ /* storage unavailable */ }
  }

  function readPersistedRoute(){
    try{
      const val = localStorage.getItem(STORAGE_KEYS.lastRoute || 'gs:lastRoute');
      return val && ROUTES[val] ? ROUTES[val] : ROUTES['/'];
    }catch(err){ return ROUTES['/']; }
  }

  function showLoader(title, subtitle){
    const refs = state.refs;
    if(refs.viewerError){ refs.viewerError.classList.add('hidden'); }
    if(refs.viewerLoading){ refs.viewerLoading.classList.remove('hidden'); }
    if(refs.viewerLoadingTitle){
      const copy = state.options.loaderCopy.title;
      refs.viewerLoadingTitle.textContent = title || (typeof copy === 'function' ? copy() : copy);
    }
    if(refs.viewerLoadingText){ refs.viewerLoadingText.textContent = subtitle || state.options.loaderCopy.subtitle; }
  }

  function hideLoader(){
    const refs = state.refs;
    if(refs.viewerLoading){ refs.viewerLoading.classList.add('hidden'); }
    if(refs.viewerLoadingTitle){
      const copy = state.options.loaderCopy.title;
      refs.viewerLoadingTitle.textContent = typeof copy === 'function' ? copy() : copy;
    }
    if(refs.viewerLoadingText){ refs.viewerLoadingText.textContent = state.options.loaderCopy.subtitle; }
  }

  function showModuleError(label, detail){
    const refs = state.refs;
    if(refs.viewerErrorTitle){ refs.viewerErrorTitle.textContent = `No pudimos abrir ${label}.`; }
    if(refs.viewerErrorText){ refs.viewerErrorText.textContent = detail || 'Revisá tu conexión y reintentá.'; }
    if(refs.viewerError){ refs.viewerError.classList.remove('hidden'); }
    hideLoader();
  }

  function ensureFrame(route){
    const refs = state.refs;
    if(!route || !route.page || !refs.viewer){ return null; }
    const existing = state.frames.get(route.key);
    if(existing && refs.viewer.contains(existing)){ return existing; }
    const iframe = document.createElement('iframe');
    iframe.setAttribute('title', route.label);
    iframe.setAttribute('data-page', route.page);
    iframe.setAttribute('data-page-label', route.label);
    iframe.setAttribute('loading', 'lazy');
    if(route.moduleKey){ iframe.dataset.moduleKey = route.moduleKey; }
    iframe.className = state.options.iframeClass;
    iframe.referrerPolicy = 'no-referrer';
    iframe.addEventListener('load', ()=>{
      iframe.dataset.loaded = 'true';
      iframe.classList.add(state.options.iframeLoadedClass);
      hideLoader();
      global.gsAnalytics && global.gsAnalytics.log && global.gsAnalytics.log('module_loaded', { module: route.moduleKey });
    });
    iframe.addEventListener('error', ()=>{
      showModuleError(route.label, 'No pudimos cargar la vista. Revisá tu conexión e intenta nuevamente.');
      global.gsAnalytics && global.gsAnalytics.log && global.gsAnalytics.log('module_error', { module: route.moduleKey });
    });
    refs.viewer.appendChild(iframe);
    state.frames.set(route.key, iframe);
    return iframe;
  }

  function hideFrames(active){
    state.frames.forEach((frame)=>{
      if(frame === active){ return; }
      frame.classList.add('hidden');
      frame.setAttribute('aria-hidden','true');
      frame.setAttribute('tabindex','-1');
    });
  }

  function setNavActive(hash){
    const refs = state.refs;
    if(!refs.sideNav){ return; }
    const links = refs.sideNav.querySelectorAll('a[href]');
    links.forEach((a)=>{ a.classList.toggle('active', a.getAttribute('href') === hash); });
  }

  function showHome(){
    const refs = state.refs;
    if(refs.homeView){ refs.homeView.classList.remove('hidden'); }
    if(refs.viewer){ refs.viewer.classList.add('hidden'); }
    if(refs.pageSubtitle && ROUTES['/'].subtitle){ refs.pageSubtitle.textContent = ROUTES['/'].subtitle; }
    hideLoader();
  }

  function showModule(route){
    const refs = state.refs;
    if(refs.homeView){ refs.homeView.classList.add('hidden'); }
    if(refs.viewer){ refs.viewer.classList.remove('hidden'); }
    const frame = ensureFrame(route);
    if(!frame){
      showModuleError(route.label || 'el módulo', 'Archivo no encontrado.');
      return;
    }
    hideFrames(frame);
    frame.classList.remove('hidden');
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    if(!frame.src){
      showLoader();
      frame.src = route.page;
    }else{
      hideLoader();
    }
    if(refs.pageSubtitle){ refs.pageSubtitle.textContent = route.subtitle || ''; }
  }

  function updateTitles(route){
    const refs = state.refs;
    if(refs.pageTitle && route && route.label){ refs.pageTitle.textContent = route.label; }
  }

  function handleRouteChange(hash){
    const route = getRouteFromHash(hash || location.hash || '#/');
    state.activeRoute = route;
    persistRoute(route);
    setNavActive(`#${route.key}`);
    updateTitles(route);
    if(route.key === '/'){
      showHome();
    }else{
      showLoader();
      showModule(route);
    }
    try{
      document.dispatchEvent(new CustomEvent('gs:route', { detail: route }));
    }catch(err){ /* noop */ }
  }

  function recoverFromIframeError(){
    if(state.activeRoute){ showModule(state.activeRoute); }
  }

  function initRouter(){
    state.refs = buildRefs();
    const refs = state.refs;

    if(refs.viewerErrorRetry){ refs.viewerErrorRetry.addEventListener('click', ()=> recoverFromIframeError()); }
    if(refs.viewerErrorHome){ refs.viewerErrorHome.addEventListener('click', ()=> navigateTo('/')); }

    window.addEventListener('hashchange', ()=> handleRouteChange());

    const startRoute = location.hash ? getRouteFromHash(location.hash) : readPersistedRoute();
    if(startRoute){ navigateTo(startRoute.key, { replace: true }); }
    handleRouteChange();

    return {
      navigateTo,
      setSession: (session)=>{ state.session = session || null; },
      getActiveRoute: ()=> state.activeRoute
    };
  }

  function navigateTo(routeKey, options={}){
    const normalized = routeKey.startsWith('/') ? `#${routeKey}` : routeKey;
    if(options.replace){
      history.replaceState(null, '', normalized);
    }else{
      window.location.hash = normalized;
    }
    handleRouteChange(normalized.replace('#',''));
  }

  global.gsRouter = Object.freeze({
    initRouter,
    navigateTo,
    getActiveRoute: ()=> state.activeRoute
  });
})(window);
