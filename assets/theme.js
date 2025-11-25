(function(global){
  'use strict';

  let activeTheme = null;
  const THEME_EVENT = 'gs:theme:update';

  function applyTheme(theme){
    activeTheme = theme || null;
    document.documentElement.classList.add('theme-applied');
    document.body.classList.add('theme-applied');
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: activeTheme }));
  }

  function initTheme(){
    const snap = global.gsAuth && typeof global.gsAuth.getTheme === 'function'
      ? global.gsAuth.getTheme()
      : null;
    applyTheme(snap || null);
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
