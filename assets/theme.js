(function(global){
  'use strict';

  let activeTheme = null;
  const THEME_EVENT = 'gs:theme:update';
  const STORAGE_KEY = 'gs:theme:mode';

  function setCssVars(palette){
    if(!palette){ return; }
    const root = document.documentElement;
    Object.entries(palette).forEach(([key, value])=>{
      if(typeof value === 'string'){ root.style.setProperty(`--${key}`, value); }
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
      document.documentElement.setAttribute('data-theme', themeId);
      try{ localStorage.setItem(STORAGE_KEY, themeId); }catch(err){ /* storage unavailable */ }
    }
    if(next && next.palette){ setCssVars(next.palette); }
    document.documentElement.classList.add('theme-applied');
    document.body.classList.add('theme-applied');
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
