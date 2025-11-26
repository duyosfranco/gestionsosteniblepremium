(function(global){
  'use strict';

  const listeners = new Set();
  const SESSION_EVENT = 'gs:session:ready';
  let currentSession = null;
  let unsubscribeAuth = null;
  let demoAutostartTimer = null;
  let demoRecoveryTimer = null;

  const autoDemoAllowedHosts = ['localhost', '127.0.0.1', ''];
  const autoDemoRequested = new URLSearchParams(location.search).get('autodemo') === '1';
  const allowAutoDemo = autoDemoRequested && ['file:', 'http:'].includes(location.protocol)
    && autoDemoAllowedHosts.includes(location.hostname);

  function notify(session){
    currentSession = session || null;
    listeners.forEach((cb)=>{
      try{ cb(currentSession); }
      catch(err){ console.warn('session listener error', err); }
    });
    document.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: currentSession }));
  }

  function hasFirebaseApp(){
    try{ return !!(global.firebase && Array.isArray(global.firebase.apps) && global.firebase.apps.length); }
    catch(err){ return false; }
  }

  function startDemoFallback(reason){
    const dataset = global.GS_DEMO_DATA || global.demoData;
    if(!dataset || !global.gsAuth || typeof global.gsAuth.startDemoSession !== 'function'){ return; }
    const hostOk = autoDemoAllowedHosts.includes(location.hostname) || location.protocol === 'file:';
    if(!allowAutoDemo && !hostOk && reason !== 'no-auth'){ return; }
    const hasSession = !!(currentSession && currentSession.user);
    if(hasSession || document.body.classList.contains('app-ready')){ return; }
    try{ global.gsAuth.startDemoSession(dataset, { persist: false, resetTheme: false }); }
    catch(err){ console.warn('No se pudo iniciar la demo automática', err); }
  }

  function scheduleDemoAutostart(){
    clearTimeout(demoAutostartTimer);
    demoAutostartTimer = setTimeout(()=> startDemoFallback('requested'), 2600);
  }

  function scheduleDemoRecovery(){
    clearTimeout(demoRecoveryTimer);
    demoRecoveryTimer = setTimeout(()=>{
      const hasSession = !!(currentSession && currentSession.user);
      if(hasSession){ return; }
      if(!hasFirebaseApp() || !global.gsAuth){
        startDemoFallback('no-auth');
      }
    }, 3200);
  }

  function initSession({ onReady, onError }={}){
    if(!global.gsAuth || typeof global.gsAuth.onSession !== 'function'){
      scheduleDemoAutostart();
      scheduleDemoRecovery();
      onError && onError(new Error('gsAuth no está disponible todavía.'));
      return { unsubscribe: ()=>{} };
    }
    scheduleDemoAutostart();
    scheduleDemoRecovery();
    if(unsubscribeAuth){ try{ unsubscribeAuth(); }catch(err){ /* noop */ } }
    unsubscribeAuth = global.gsAuth.onSession((session)=>{
      notify(session);
      if(onReady){ onReady(session); }
    });
    return { unsubscribe: ()=>{ if(unsubscribeAuth){ unsubscribeAuth(); unsubscribeAuth=null; } } };
  }

  function getCurrentUser(){ return currentSession && currentSession.user ? currentSession.user : null; }
  function getSession(){ return currentSession; }
  function isDemoMode(){
    if(global.gsAuth && typeof global.gsAuth.isDemoSession === 'function'){
      return !!global.gsAuth.isDemoSession();
    }
    return currentSession ? currentSession.status === 'demo' : false;
  }

  function subscribe(callback){
    if(typeof callback !== 'function'){ return ()=>{}; }
    listeners.add(callback);
    if(currentSession){ callback(currentSession); }
    return ()=> listeners.delete(callback);
  }

  global.gsSession = Object.freeze({
    initSession,
    getCurrentUser,
    getSession,
    isDemoMode,
    subscribe,
    SESSION_EVENT
  });
})(window);
