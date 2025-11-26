(function(global){
  'use strict';

  let activeTheme = null;
  let pendingTheme = null;
  const THEME_EVENT = 'gs:theme:update';
  const STORAGE_KEY = 'gs:theme:mode';
  const DEFAULT_PALETTE = Object.freeze({
    accent: '#1DBF73',
    accent2: '#16a062',
    accent3: '#0f8a5b',
    accentSoft: '#E8FFF5',
    nav: '#0f3346',
    nav2: '#0b2a3b',
    navContrast: '#ffffff',
    navContrastSoft: 'rgba(255,255,255,.85)',
    navContrastMuted: 'rgba(255,255,255,.65)',
    ink: '#0D2B3D',
    ink2: '#0b1f2a',
    muted: '#6b7c8a',
    line: '#dfe8f1',
    bg: '#f3f7fb',
    bg2: '#ffffff',
    card: '#ffffff',
    overlay: 'rgba(15,51,70,.55)'
  });

  function userStorageKey(){
    const user = global.gsSession && typeof global.gsSession.getCurrentUser === 'function'
      ? global.gsSession.getCurrentUser()
      : null;
    return user && user.uid ? `${STORAGE_KEY}:${user.uid}` : STORAGE_KEY;
  }

  function setCssVars(palette){
    if(!palette){ return; }
    const appRoot = document.getElementById('appView');
    const target = appRoot || document.documentElement;
    Object.entries(palette).forEach(([key, value])=>{
      if(typeof value === 'string'){ target.style.setProperty(`--${key}`, value); }
    });
  }

  function applyBrandAssets(theme){
    if(!theme || !document.body.classList.contains('app-ready')){ return; }
    const side = document.getElementById('sideBrand');
    const nameEl = document.getElementById('sideBrandName');
    const logoEl = document.getElementById('sideBrandLogo');
    const brandName = theme.brandName || (theme.logo && theme.logo.name) || 'Gestión Sostenible';
    if(nameEl){ nameEl.textContent = brandName; }
    if(side){ side.dataset.hasLogo = theme.logo && theme.logo.url ? 'true' : 'false'; }
    if(logoEl){
      if(theme.logo && theme.logo.url){ logoEl.src = theme.logo.url; logoEl.alt = brandName; logoEl.style.opacity = '1'; }
      else{ logoEl.removeAttribute('src'); logoEl.style.opacity = '0'; }
    }
  }

  function broadcastTheme(theme){
    const payload = { type:'gs:theme', theme };
    try{
      const frames = document.querySelectorAll('iframe[data-page]');
      frames.forEach((frame)=>{
        try{ frame.contentWindow.postMessage(payload, '*'); }
        catch(err){ /* ignored */ }
      });
    }catch(err){ /* ignored */ }
    if('BroadcastChannel' in global){
      try{ new BroadcastChannel('gs-theme').postMessage(payload); }
      catch(err){ /* ignored */ }
    }
  }

  function applyTheme(theme){
    const next = theme || activeTheme || null;
    activeTheme = next;
    const themeId = typeof next === 'string' ? next : (next && (next.id || next.mode)) || null;
    if(themeId){
      const appRoot = document.getElementById('appView');
      if(appRoot){ appRoot.setAttribute('data-theme', themeId); }
      try{ localStorage.setItem(userStorageKey(), themeId); }catch(err){ /* storage unavailable */ }
    }
    const palette = (next && next.palette) || DEFAULT_PALETTE;
    setCssVars(palette);
    const appRoot = document.getElementById('appView');
    if(appRoot){ appRoot.classList.add('theme-applied'); }
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: activeTheme }));
    applyBrandAssets(next);
    broadcastTheme(activeTheme);
  }

  function initTheme(){
    const stored = (()=>{ try{ return localStorage.getItem(userStorageKey()); }catch(err){ return null; }})();
    const snap = global.gsAuth && typeof global.gsAuth.getTheme === 'function'
      ? global.gsAuth.getTheme()
      : null;
    const initial = snap || stored || null;
    if(document.body.classList.contains('app-ready')){ applyTheme(initial); }
    else{ pendingTheme = initial; }
    if(global.gsAuth && typeof global.gsAuth.onTheme === 'function'){
      try{ global.gsAuth.onTheme((theme)=> applyTheme(theme)); }
      catch(err){ console.warn('No se pudo suscribir al tema', err); }
    }
    if(global.gsSession && global.gsSession.SESSION_EVENT){
      document.addEventListener(global.gsSession.SESSION_EVENT, ()=>{
        if(pendingTheme){ applyTheme(pendingTheme); pendingTheme = null; }
      });
    }
    const readyCheck = setInterval(()=>{
      if(document.body.classList.contains('app-ready')){
        if(pendingTheme){ applyTheme(pendingTheme); pendingTheme = null; }
        clearInterval(readyCheck);
      }
    }, 350);
  }

  function setTheme(theme){
    if(global.gsAuth && typeof global.gsAuth.previewTheme === 'function'){
      global.gsAuth.previewTheme(theme);
    }
    applyTheme(theme);
  }

  function getCurrentTheme(){ return activeTheme; }

  global.gsTheme = Object.freeze({
    initTheme,
    setTheme,
    getCurrentTheme,
    THEME_EVENT
  });
})(window);
