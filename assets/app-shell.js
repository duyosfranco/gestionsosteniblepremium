(function(global){
  'use strict';

  const cfg = global.gsConfig || {};
  const SELECTORS = cfg.SELECTORS || {};
  const DEFAULT_LABELS = cfg.DEFAULT_MODULE_LABELS || {};

  function select(sel){ return typeof sel === 'string' ? document.querySelector(sel) : sel; }
  function selectAll(sel){ return Array.from(document.querySelectorAll(sel)); }

  function buildRefs(){
    const refs = {};
    Object.entries(SELECTORS).forEach(([key, selector])=>{ refs[key] = select(selector); });
    return refs;
  }

  function toggleNav(refs, force){
    const sideNav = refs.sideNav;
    if(!sideNav){ return; }
    const next = typeof force === 'boolean' ? force : !sideNav.classList.contains('open');
    sideNav.classList.toggle('open', next);
    if(refs.navBackdrop){ refs.navBackdrop.toggleAttribute('hidden', !next); }
  }

  function bindNavigation(refs){
    if(refs.navToggle){ refs.navToggle.addEventListener('click', ()=> toggleNav(refs)); }
    if(refs.navBackdrop){ refs.navBackdrop.addEventListener('click', ()=> toggleNav(refs, false)); }
    if(refs.sideNav){
      refs.sideNav.addEventListener('click', (event)=>{
        const target = event.target.closest('a[href^="#/"]');
        if(target){ toggleNav(refs, false); }
      });
    }
  }

  function updateSessionUI(refs, session){
    const isReady = !!(session && session.user) || (global.gsSession && global.gsSession.isDemoMode && global.gsSession.isDemoMode());
    document.body.classList.toggle('app-ready', isReady);
    document.body.classList.remove('login-open');
    if(refs.loginPanel){ refs.loginPanel.classList.add('hidden'); }
    if(refs.landingShell){ refs.landingShell.removeAttribute('aria-hidden'); }

    const role = session && session.role ? session.role : (session && session.status ? session.status : 'guest');
    const email = session && session.user ? session.user.email : '';
    if(refs.sessionChip){ refs.sessionChip.textContent = isReady ? 'Sesión activa' : 'Sesión no iniciada'; }
    if(refs.sessionRole){ refs.sessionRole.textContent = role || ''; }
    if(refs.sessionEmail){ refs.sessionEmail.textContent = email || ''; }
    syncPermissions(refs, session);
  }

  function syncPermissions(refs, session){
    const links = selectAll(SELECTORS.permLinks || '');
    if(!links.length){ return; }
    const abilities = session && session.abilities && session.abilities.modulePermissions
      ? session.abilities.modulePermissions
      : null;
    links.forEach((link)=>{
      const perm = link.dataset.permission;
      if(!perm){ return; }
      if(!abilities){
        link.classList.remove('hidden');
        link.removeAttribute('aria-hidden');
        return;
      }
      const allowed = abilities[perm];
      const hide = allowed === false;
      link.classList.toggle('hidden', hide);
      if(hide){ link.setAttribute('aria-hidden','true'); }
      else{ link.removeAttribute('aria-hidden'); }
    });
  }

  function bindLogin(refs){
    const focusBtns = selectAll(SELECTORS.focusLoginBtns || '');
    const focusLoginForm = (event)=>{
      if(event){ event.preventDefault(); }
      document.body.classList.add('login-open');
      if(refs.loginPanel){ refs.loginPanel.classList.remove('hidden'); refs.loginPanel.removeAttribute('aria-hidden'); }
      if(refs.landingShell){ refs.landingShell.setAttribute('aria-hidden','true'); }
      if(refs.emailInput){ try{ refs.emailInput.focus({ preventScroll:true }); }catch(err){ refs.emailInput.focus(); } }
    };
    focusBtns.forEach((btn)=> btn.addEventListener('click', focusLoginForm));
    const wantsLogin = new URLSearchParams(location.search).get('login') === '1';
    if(wantsLogin){ focusLoginForm(); }

    if(refs.loginForm){
      refs.loginForm.addEventListener('submit', async (event)=>{
        event.preventDefault();
        if(!global.gsAuth || typeof global.gsAuth.signInWithEmailAndPassword !== 'function'){ return; }
        const email = refs.emailInput ? refs.emailInput.value : '';
        const pass = refs.passInput ? refs.passInput.value : '';
        if(refs.btnLogin){ refs.btnLogin.disabled = true; }
        if(refs.loginMsg){ refs.loginMsg.textContent = 'Iniciando sesión...'; refs.loginMsg.classList.remove('hidden'); }
        try{
          await global.gsAuth.signInWithEmailAndPassword(email, pass);
          if(refs.loginMsg){ refs.loginMsg.textContent = 'Sesión iniciada. Redirigiendo...'; }
          global.gsAnalytics && global.gsAnalytics.log('login_success');
        }catch(err){
          const friendly = err && err.message ? err.message : 'No pudimos iniciar sesión. Intentá nuevamente.';
          if(refs.loginMsg){ refs.loginMsg.textContent = friendly; refs.loginMsg.classList.remove('hidden'); }
          global.gsAnalytics && global.gsAnalytics.log('login_error', { message: friendly });
        }finally{
          if(refs.btnLogin){ refs.btnLogin.disabled = false; }
        }
      });
    }
    if(refs.btnLogout && global.gsAuth && typeof global.gsAuth.signOut === 'function'){
      refs.btnLogout.addEventListener('click', ()=>{
        global.gsAuth.signOut().catch(()=>{});
      });
    }
  }

  function prefetchModulePage(page){
    try{ fetch(page, { method: 'GET', cache: 'force-cache' }).catch(()=>{}); }
    catch(err){ /* noop */ }
  }

  function warmupModules(){
    if(location.protocol === 'file:'){ return; }
    const pages = ['clientes-firestore.html','finanzas.html','retiros.html','usuarios.html','configuracion.html'];
    if('requestIdleCallback' in window){
      requestIdleCallback(()=> pages.forEach(prefetchModulePage), { timeout: 1500 });
    }else{
      setTimeout(()=> pages.forEach(prefetchModulePage), 1200);
    }
  }

  function registerGsServiceWorker(){
    if(location.protocol === 'file:'){ return; }
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    }
  }

  function applyThemeToggle(){
    const saved = localStorage.getItem('gs:theme:mode');
    if(saved){
      document.documentElement.setAttribute('data-theme', saved);
      if(global.gsTheme && typeof global.gsTheme.setTheme === 'function'){ global.gsTheme.setTheme(saved); }
    }
    const btn = document.createElement('button');
    btn.id = 'themeToggle';
    btn.type = 'button';
    btn.textContent = '🌗 Tema';
    btn.addEventListener('click', ()=>{
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      if(global.gsTheme && typeof global.gsTheme.setTheme === 'function'){
        global.gsTheme.setTheme(next);
      }else{
        document.documentElement.setAttribute('data-theme', next);
      }
      localStorage.setItem('gs:theme:mode', next);
    });
    document.body.appendChild(btn);
  }

  function attachGlobalLoadingStates(){
    document.body.addEventListener('click', (e)=>{
      const target = e.target;
      if(target && target.matches('[data-loading-text]')){
        const original = target.textContent;
        target.dataset.originalText = original;
        target.textContent = target.getAttribute('data-loading-text');
        setTimeout(()=>{ target.textContent = target.dataset.originalText || original; }, 1200);
      }
    });
  }

  function wireTheme(refs){
    if(global.gsTheme && typeof global.gsTheme.initTheme === 'function'){
      global.gsTheme.initTheme();
      document.addEventListener(global.gsTheme.THEME_EVENT, (event)=>{
        const theme = event.detail || {};
        const brandName = theme.brandName || (theme.logo && theme.logo.name) || 'Gestión Sostenible';
        const brandTargets = selectAll('[data-brand-name]');
        brandTargets.forEach((el)=>{ el.textContent = brandName; });
      });
    }
  }

  function bootstrap(){
    const refs = buildRefs();
    wireTheme(refs);
    bindNavigation(refs);
    bindLogin(refs);
    syncPermissions(refs, null);

    const router = global.gsRouter && typeof global.gsRouter.initRouter === 'function'
      ? global.gsRouter.initRouter()
      : null;

    if(global.gsSession && typeof global.gsSession.initSession === 'function'){
      global.gsSession.initSession({
        onReady: (session)=>{
          updateSessionUI(refs, session);
          if(router && router.setSession){ router.setSession(session); }
        },
        onError: ()=>{}
      });
      global.gsSession.subscribe((session)=> updateSessionUI(refs, session));
    }

    warmupModules();
    registerGsServiceWorker();
    applyThemeToggle();
    attachGlobalLoadingStates();
    if(typeof global.setupDrilldownModal === 'function'){
      if(document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', global.setupDrilldownModal, { once: true });
      }else{
        global.setupDrilldownModal();
      }
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})(window);
