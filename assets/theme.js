(function(global){
  'use strict';

  let activeTheme = null;
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

  function setCssVars(palette){
    if(!palette){ return; }
    const appRoot = document.getElementById('appView');
    const target = appRoot || document.documentElement;
    Object.entries(palette).forEach(([key, value])=>{
      if(typeof value === 'string'){ target.style.setProperty(`--${key}`, value); }
    });
  }

  function applyBrandAssets(theme){
    const appRoot = document.getElementById('appView');
    if(!appRoot){ return; }
    const brandName = theme && (theme.brandName || theme.name || (theme.logo && theme.logo.name));
    const logoUrl = theme && (theme.logoUrl || theme.logo || theme.logoSrc || (theme.logo && theme.logo.url));
    const logoShape = theme && (theme.logoShape || (theme.logo && theme.logo.shape));
    const targets = appRoot.querySelectorAll('.side-brand, .brand');
    targets.forEach((target)=>{
      const nameEl = target.querySelector('[data-brand-name]');
      if(nameEl && brandName){ nameEl.textContent = brandName; }
      const logoBox = target.querySelector('.logo');
      const logoImg = target.querySelector('.logo-img');
      if(logoImg && logoUrl){
        logoImg.src = logoUrl;
        logoImg.alt = brandName || 'Marca';
        target.dataset.hasLogo = 'true';
        if(logoShape){ target.dataset.logoShape = logoShape; }
      }
      if(logoBox && logoUrl && target.dataset){
        target.dataset.hasLogo = 'true';
      }
    });
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
      try{ localStorage.setItem(STORAGE_KEY, themeId); }catch(err){ /* storage unavailable */ }
    }
    const palette = (next && next.palette) || DEFAULT_PALETTE;
    setCssVars(palette);
    const appRoot = document.getElementById('appView');
    if(appRoot){ appRoot.classList.add('theme-applied'); }
    applyBrandAssets(next || {});
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: activeTheme }));
    broadcastTheme(activeTheme);
  }

  function initTheme(){
    const stored = (()=>{ try{ return localStorage.getItem(STORAGE_KEY); }catch(err){ return null; }})();
    const snap = global.gsAuth && typeof global.gsAuth.getTheme === 'function'
      ? global.gsAuth.getTheme()
      : null;
    applyTheme(snap || stored || null);
    if(global.gsAuth && typeof global.gsAuth.onTheme === 'function'){
      try{ global.gsAuth.onTheme((theme)=> applyTheme(theme)); }
      catch(err){ console.warn('No se pudo suscribir al tema', err); }
    }
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
