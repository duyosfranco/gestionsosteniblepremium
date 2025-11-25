(function(global){
  'use strict';

  if(!global.firebase){
    throw new Error('Firebase SDK no cargado. Incluí firebase-app-compat.js antes de gs-auth.js');
  }

  const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyAWsDJlyls1DnprGf3bBvEkYfrLdLQ3WCg",
    authDomain: "gestion-sostenible.firebaseapp.com",
    projectId: "gestion-sostenible",
    storageBucket: "gestion-sostenible.firebasestorage.app",
    messagingSenderId: "109584279347",
    appId: "1:109584279347:web:f6f8abe742c84daf8d8046"
  };

  const DOMAIN_CONFIGS = {
    'gestion-sostenible.freemyip.com': DEFAULT_FIREBASE_CONFIG
  };

  function readEnvConfig(){
    const env = (global.__GS_ENV__ || (typeof process !== 'undefined' && process.env) || {});
    const cfg = {
      apiKey: env.GS_API_KEY,
      authDomain: env.GS_AUTH_DOMAIN,
      projectId: env.GS_PROJECT_ID,
      storageBucket: env.GS_STORAGE_BUCKET,
      messagingSenderId: env.GS_MESSAGING_SENDER_ID,
      appId: env.GS_APP_ID
    };
    const hasValues = Object.values(cfg).some(Boolean);
    return hasValues ? cfg : null;
  }

  function readMetaConfig(){
    if(!global.document){ return null; }
    const meta = global.document.querySelector('meta[name="gs:firebase-config"]');
    if(meta && meta.content){
      try{ return JSON.parse(meta.content); }
      catch(err){ console.warn('Config meta inválida', err); }
    }
    return null;
  }

  function readDomainConfig(){
    const host = (global.location && global.location.hostname) || '';
    return DOMAIN_CONFIGS[host] || null;
  }

  function resolveFirebaseConfig(){
    return readEnvConfig() || readMetaConfig() || readDomainConfig() || DEFAULT_FIREBASE_CONFIG;
  }

  const firebaseConfig = resolveFirebaseConfig();

  if(!firebase.apps.length){
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const hasFirestore = typeof firebase.firestore === 'function';
  const db = hasFirestore ? firebase.firestore() : null;
  const FieldValue = hasFirestore && firebase.firestore.FieldValue ? firebase.firestore.FieldValue : null;
  const EmailAuthProvider = firebase.auth && firebase.auth.EmailAuthProvider ? firebase.auth.EmailAuthProvider : null;

  applySecurityHeaders();
  ensureCsrfToken();

  let adminApiBase = (global.__GS_ENV__ && global.__GS_ENV__.GS_ADMIN_API_BASE) || '';
  let remoteConfigOrigin = (global.__GS_ENV__ && global.__GS_ENV__.GS_REMOTE_CONFIG_ORIGIN) || '';
  let remoteConfigPromise = null;

  function setAdminApiBase(value){
    const clean = sanitizeUrl(value);
    if(clean){ adminApiBase = clean; }
  }

  async function hydrateRemoteConfig(){
    if(remoteConfigPromise){ return remoteConfigPromise; }
    if(!firebase.remoteConfig || typeof firebase.remoteConfig !== 'function'){ return Promise.resolve(null); }
    const rc = firebase.remoteConfig();
    rc.settings = Object.assign({}, rc.settings || {}, {
      minimumFetchIntervalMillis: 60 * 60 * 1000
    });
    rc.defaultConfig = Object.assign({}, rc.defaultConfig || {}, {
      gs_admin_api_base: adminApiBase,
      gs_remote_config_origin: remoteConfigOrigin
    });
    remoteConfigPromise = rc.fetchAndActivate()
      .then(()=>{
        try{
          const apiBase = rc.getString('gs_admin_api_base');
          if(apiBase){ setAdminApiBase(apiBase); }
          const origin = rc.getString('gs_remote_config_origin');
          if(origin){ remoteConfigOrigin = sanitizeUrl(origin); }
        }catch(err){ console.warn('No se pudo aplicar Remote Config', err); }
        return rc;
      })
      .catch((err)=>{
        console.warn('No se pudo obtener Remote Config', err);
        return null;
      });
    return remoteConfigPromise;
  }

  hydrateRemoteConfig().catch(()=>{});

  const AUDIT_COLLECTION = 'auditLogs';
  const AUDIT_CACHE_PREFIX = 'gs:audit:';
  const AUDIT_CACHE_LIMIT = 40;

  const DEFAULT_BRAND_NAME = 'Gestión Sostenible';
  const DEFAULT_MODULE_LABELS = Object.freeze({
    home: 'Inicio',
    clientes: 'Clientes',
    rutas: 'Calendario / Rutas',
    finanzas: 'Finanzas y DGI',
    temas: 'Temas',
    usuarios: 'Gestión de Cuentas',
    configuracion: 'Configuración'
  });
  const DEMO_MODE_KEY = 'gs:demo:mode';
  const DEMO_DATA_KEY = 'gs:demo:data';

  function createDefaultTheme(){
    return {
      palette: {
        accent: '#1DBF73',
        accent2: '#16a062',
        accent3: '#13a660',
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
        bg: '#f2f6fb',
        bg2: '#ffffff',
        card: '#ffffff',
        overlay: 'rgba(15,51,70,.55)'
      },
      logo: null,
      brandName: DEFAULT_BRAND_NAME,
      modules: Object.assign({}, DEFAULT_MODULE_LABELS),
      updatedAt: null
    };
  }

  const THEME_KEYS = [
    'accent','accent2','accent3','accentSoft',
    'nav','nav2','navContrast','navContrastSoft','navContrastMuted',
    'ink','ink2','muted','line','bg','bg2','card','overlay'
  ];

  const MODULE_KEYS = Object.keys(DEFAULT_MODULE_LABELS);

  const THEME_STORAGE_KEY = 'gs:theme:snapshot';
  const THEME_MESSAGE_FLAG = '__gsThemeMessage__';
  const themeListeners = new Set();
  let themeStyleEl = null;
  let activeTheme = createDefaultTheme();
  let previewThemeBackup = null;
  const runtimeId = Math.random().toString(36).slice(2);
  let themeBroadcast = null;
  let demoMode = false;
  let demoDataset = {};

  const DEFAULT_ORG_ID = 'default';
  const DEFAULT_ORG_NAME = 'General';
  const ORG_COLLECTION = 'organizaciones';
  const ORG_CACHE_LIMIT = 200;

  const recaptchaCache = new Map();
  const organizationCache = new Map();
  const rateLimiters = new Map();

  function sanitizeUrl(value){
    if(typeof value !== 'string'){ return ''; }
    return value.trim().replace(/\s+/g, '').replace(/\/$/, '');
  }

  function resolveAdminApiBase(){
    return sanitizeUrl(adminApiBase);
  }

  function withRateLimit(key, options, action){
    const opts = Object.assign({ windowMs: 15000, max: 5, message: 'Demasiados intentos, esperá un momento.' }, options);
    const now = Date.now();
    const entry = rateLimiters.get(key) || { count: 0, start: now };
    if(now - entry.start > opts.windowMs){
      entry.count = 0;
      entry.start = now;
    }
    entry.count += 1;
    rateLimiters.set(key, entry);
    if(entry.count > opts.max){
      const err = new Error(opts.message);
      err.code = 'rate-limit';
      throw err;
    }
    return typeof action === 'function' ? action() : null;
  }

  async function callAdminApi(path, payload){
    await hydrateRemoteConfig().catch(()=>{});
    const base = resolveAdminApiBase();
    if(!base){
      throw new Error('Configurá GS_ADMIN_API_BASE o Remote Config para habilitar acciones administrativas seguras.');
    }
    if(typeof fetch !== 'function'){
      throw new Error('El entorno no admite solicitudes de red.');
    }
    const user = auth.currentUser;
    if(!user){
      throw new Error('No hay una sesión administrativa activa.');
    }
    const idToken = await user.getIdToken(true);
    if(!validateIdTokenClaims(idToken)){
      throw new Error('Token inválido o expirado. Reautenticá tu sesión.');
    }
    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const csrf = ensureCsrfToken();
    const response = await withRateLimit('adminApi:'+path, { windowMs: 60000, max: 12 }, ()=> fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
        'X-CSRF-Token': csrf || ''
      },
      body: JSON.stringify(payload || {})
    }));
    if(!response.ok){
      let message = response.statusText || 'No se pudo completar la acción administrativa.';
      try{
        const data = await response.json();
        if(data && data.error){
          message = data.error.message || data.error || message;
        }
      }catch(err){ /* cuerpo opcional */ }
      throw new Error(message);
    }
    try{ return await response.json(); }
    catch(_){ return {}; }
  }

  function sanitizeOrganizationId(value){
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  function sanitizeOrganizationName(value){
    return typeof value === 'string' ? value.trim() : '';
  }

  function sanitizeEmail(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim().toLowerCase();
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return pattern.test(trimmed) ? trimmed : '';
  }

  function sanitizePassword(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    return trimmed.length >= 8 ? trimmed : '';
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const localStore = (()=>{
    try{
      const probe = '__gs_session_probe__';
      global.localStorage.setItem(probe,'1');
      global.localStorage.removeItem(probe);
      return global.localStorage;
    }catch(err){
      return null;
    }
  })();

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  applySecurityHeaders();
  ensureCsrfToken();

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const buildDefaultCsp = ()=>[
      "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:",
      "frame-ancestors 'self'",
      "script-src 'self' https://www.gstatic.com 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src ${requiredConnectSrc.join(' ')}`,
      "img-src 'self' data:"
    ].join('; ');

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = buildDefaultCsp();
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;
    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com; img-src 'self' data:";
      head.appendChild(meta);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const localStore = (()=>{
    try{
      const probe = '__gs_session_probe__';
      global.localStorage.setItem(probe,'1');
      global.localStorage.removeItem(probe);
      return global.localStorage;
    }catch(err){
      return null;
    }
  })();

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  applySecurityHeaders();
  ensureCsrfToken();

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const buildDefaultCsp = ()=>[
      "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:",
      "frame-ancestors 'self'",
      "script-src 'self' https://www.gstatic.com 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      `connect-src ${requiredConnectSrc.join(' ')}`,
      "img-src 'self' data:"
    ].join('; ');

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = buildDefaultCsp();
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const localStore = (()=>{
    try{
      const probe = '__gs_session_probe__';
      global.localStorage.setItem(probe,'1');
      global.localStorage.removeItem(probe);
      return global.localStorage;
    }catch(err){
      return null;
    }
  })();

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  applySecurityHeaders();
  ensureCsrfToken();

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:";
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const localStore = (()=>{
    try{
      const probe = '__gs_session_probe__';
      global.localStorage.setItem(probe,'1');
      global.localStorage.removeItem(probe);
      return global.localStorage;
    }catch(err){
      return null;
    }
  })();

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  applySecurityHeaders();
  ensureCsrfToken();

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:";
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const localStore = (()=>{
    try{
      const probe = '__gs_session_probe__';
      global.localStorage.setItem(probe,'1');
      global.localStorage.removeItem(probe);
      return global.localStorage;
    }catch(err){
      return null;
    }
  })();

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  applySecurityHeaders();
  ensureCsrfToken();

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:";
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;

    const requiredConnectSrc = [
      "'self'",
      'https://firestore.googleapis.com',
      'https://www.googleapis.com',
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com'
    ];

    const ensureConnectSrc = (meta)=>{
      const content = (meta && meta.content) || '';
      const connectRegex = /connect-src\s+([^;]+)/i;
      if(connectRegex.test(content)){
        const current = connectRegex.exec(content)[1].split(/\s+/).filter(Boolean);
        requiredConnectSrc.forEach((src)=>{
          if(!current.includes(src)){ current.push(src); }
        });
        meta.content = content.replace(connectRegex, `connect-src ${current.join(' ')}`);
      } else {
        const prefix = content ? content.replace(/;?\s*$/, '; ') : '';
        meta.content = `${prefix}connect-src ${requiredConnectSrc.join(' ')};`;
      }
    };

    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    let csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:";
      head.appendChild(meta);
      csp = meta;
    } else {
      ensureConnectSrc(csp);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeInputValue(value){
    if(typeof value !== 'string'){ return ''; }
    const trimmed = value.trim();
    const blocked = /(\b(select|update|delete|insert|drop|union|--|#)\b)/i;
    if(blocked.test(trimmed)){ return ''; }
    return trimmed.replace(/[<>"'`;]/g, '').slice(0, 2800);
  }

  function sanitizeObjectPayload(obj){
    if(!obj || typeof obj !== 'object'){ return {}; }
    return Object.keys(obj).reduce((acc,key)=>{
      const value = obj[key];
      if(typeof value === 'string'){
        acc[key] = sanitizeInputValue(value);
      }else if(value && typeof value === 'object'){
        acc[key] = sanitizeObjectPayload(value);
      }else{
        acc[key] = value;
      }
      return acc;
    },{});
  }

  const CSRF_TOKEN_KEY = 'gs:csrf-token';
  function ensureCsrfToken(){
    if(!localStore){ return null; }
    let token = localStore.getItem(CSRF_TOKEN_KEY);
    if(!token){
      token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStore.setItem(CSRF_TOKEN_KEY, token);
    }
    return token;
  }

  const SECURE_KEY = (firebaseConfig && firebaseConfig.projectId ? firebaseConfig.projectId : 'gs') + ':secure:v1';
  function deriveKeyBytes(){
    const base = SECURE_KEY + ':' + (global.navigator ? navigator.userAgent : '');
    return Array.from(base).map((ch)=> ch.charCodeAt(0) % 255);
  }

  function encryptLocalPayload(data){
    try{
      const raw = JSON.stringify(data || {});
      const key = deriveKeyBytes();
      const encoded = Array.from(raw).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return btoa(encoded);
    }catch(err){
      return null;
    }
  }

  function decryptLocalPayload(payload){
    try{
      const decoded = atob(payload);
      const key = deriveKeyBytes();
      const original = Array.from(decoded).map((ch,idx)=> String.fromCharCode(ch.charCodeAt(0) ^ key[idx % key.length])).join('');
      return JSON.parse(original);
    }catch(err){
      return null;
    }
  }

  function validateIdTokenClaims(token){
    if(typeof token !== 'string'){ return false; }
    const parts = token.split('.');
    if(parts.length !== 3){ return false; }
    try{
      const payload = JSON.parse(atob(parts[1]));
      const now = Math.floor(Date.now()/1000);
      if(payload.exp && payload.exp < now){ return false; }
      if(payload.aud && firebaseConfig && firebaseConfig.projectId && !String(payload.aud).includes(firebaseConfig.projectId)){
        return false;
      }
      return true;
    }catch(err){
      return false;
    }
  }

  function applySecurityHeaders(){
    if(!global.document){ return; }
    const head = document.head || document.getElementsByTagName('head')[0];
    if(!head) return;
    const appendIfMissing = (selector, tag)=>{
      if(!document.querySelector(selector)){
        head.appendChild(tag);
      }
    };
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if(!csp){
      const meta = document.createElement('meta');
      meta.httpEquiv = 'Content-Security-Policy';
codex/verify-main-for-file-presence-ejcrqy
      meta.content = "default-src 'self' https://www.gstatic.com https://firestore.googleapis.com https://www.googleapis.com data: blob:; frame-ancestors 'self'; script-src 'self' https://www.gstatic.com 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:";
      
      head.appendChild(meta);
    }
    appendIfMissing('meta[http-equiv="Strict-Transport-Security"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='Strict-Transport-Security'; meta.content='max-age=63072000; includeSubDomains'; return meta; })());
    appendIfMissing('meta[http-equiv="X-Content-Type-Options"]', (()=>{ const meta = document.createElement('meta'); meta.httpEquiv='X-Content-Type-Options'; meta.content='nosniff'; return meta; })());
    appendIfMissing('meta[name="referrer"]', (()=>{ const meta = document.createElement('meta'); meta.name='referrer'; meta.content='same-origin'; return meta; })());
  }

  function hardenFormSecurity(form){
    if(!form || typeof form.addEventListener !== 'function'){ return; }
    form.addEventListener('submit',(ev)=>{
      if(ev && ev.target){
        const elements = ev.target.elements || [];
        Array.from(elements).forEach((el)=>{
          if(el && 'value' in el){
            el.value = sanitizeInputValue(String(el.value||''));
          }
        });
      }
    });
    form.addEventListener('input',(ev)=>{
      const target = ev && ev.target;
      if(target && 'value' in target){
        target.value = sanitizeInputValue(String(target.value||''));
      }
    });
  }

  function sanitizeDisplayName(value){
    if(typeof value !== 'string'){ return ''; }
    return value.trim().slice(0, 140);
  }

  function slugifyOrganization(value){
    const name = sanitizeOrganizationName(value);
    if(!name){ return ''; }
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 64);
  }

  function getDefaultOrganizationMeta(){
    return { id: DEFAULT_ORG_ID, name: DEFAULT_ORG_NAME, isDefault: true };
  }

  function cacheOrganizationMeta(meta){
    if(!meta || !meta.id){ return meta; }
    organizationCache.set(meta.id, Object.assign({}, meta));
    if(organizationCache.size > ORG_CACHE_LIMIT){
      const keys = Array.from(organizationCache.keys());
      while(organizationCache.size > ORG_CACHE_LIMIT){
        const key = keys.shift();
        if(!key){ break; }
        organizationCache.delete(key);
      }
    }
    return meta;
  }

  async function fetchOrganizationMeta(id){
    const orgId = sanitizeOrganizationId(id) || DEFAULT_ORG_ID;
    if(orgId === DEFAULT_ORG_ID){
      return cacheOrganizationMeta(getDefaultOrganizationMeta());
    }
    if(organizationCache.has(orgId)){ return organizationCache.get(orgId); }
    if(!db){ return null; }
    try{
      const doc = await db.collection(ORG_COLLECTION).doc(orgId).get();
      if(doc.exists){
        const meta = Object.assign({ id: doc.id }, doc.data() || {});
        return cacheOrganizationMeta(meta);
      }
    }catch(err){
      console.warn('No se pudo obtener la organización', err);
    }
    return null;
  }

  async function findOrganizationBySlug(slug){
    const normalized = slugifyOrganization(slug);
    if(!normalized || !db){ return null; }
    try{
      const snap = await db.collection(ORG_COLLECTION).where('slug','==',normalized).limit(1).get();
      if(!snap.empty){
        const doc = snap.docs[0];
        const meta = Object.assign({ id: doc.id }, doc.data() || {});
        return cacheOrganizationMeta(meta);
      }
    }catch(err){
      console.warn('No se pudo buscar la organización por slug', err);
    }
    return null;
  }

  async function ensureOrganization(options){
    if(!db){ throw new Error('Firestore no está disponible para gestionar organizaciones.'); }
    const opts = Object.assign({ id: null, name: '', slug: null }, options);
    let organizationId = sanitizeOrganizationId(opts.id);
    const name = sanitizeOrganizationName(opts.name);
    let slug = opts.slug ? slugifyOrganization(opts.slug) : '';
    if(!slug && name){ slug = slugifyOrganization(name); }

    if(organizationId){
      const existing = await fetchOrganizationMeta(organizationId);
      if(existing){ return existing; }
    }

    if(slug){
      const fromSlug = await findOrganizationBySlug(slug);
      if(fromSlug){ return fromSlug; }
    }

    if(!name){
      return cacheOrganizationMeta(getDefaultOrganizationMeta());
    }

    const payload = {
      name,
      slug: slug || null,
      createdAt: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
      updatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
      createdBy: auth.currentUser ? auth.currentUser.uid : null
    };

    const docRef = await db.collection(ORG_COLLECTION).add(payload);
    let data = payload;
    try{
      const snap = await docRef.get();
      if(snap.exists){ data = snap.data() || payload; }
    }catch(err){ /* sin lectura inmediata */ }
    data.slug = data.slug || slug || null;
    return cacheOrganizationMeta(Object.assign({ id: docRef.id }, data));
  }

  async function listOrganizations(options){
    const opts = Object.assign({ includeDefault: true, limit: 100 }, options);
    const results = [];
    if(opts.includeDefault !== false){
      results.push(getDefaultOrganizationMeta());
    }
    if(!db){
      return results;
    }
    try{
      let query = db.collection(ORG_COLLECTION);
      if(typeof query.orderBy === 'function'){ query = query.orderBy('name'); }
      if(opts.limit && typeof query.limit === 'function'){ query = query.limit(opts.limit); }
      const snap = await query.get();
      snap.forEach((doc)=>{
        const meta = Object.assign({ id: doc.id }, doc.data() || {});
        cacheOrganizationMeta(meta);
        if(!results.some((item)=> item && item.id === meta.id)){ results.push(meta); }
      });
    }catch(err){
      console.warn('No se pudieron listar las organizaciones', err);
    }
    return results;
  }

  function applyOrganizationToProfile(profile, organization){
    if(!profile){ return; }
    const meta = organization || (profile.organizationId ? organizationCache.get(profile.organizationId) : null);
    if(meta){
      profile.organizationId = meta.id || profile.organizationId || DEFAULT_ORG_ID;
      profile.organization = Object.assign({}, meta);
      if(meta.name){ profile.organizationName = meta.name; }
    }else{
      profile.organizationId = profile.organizationId || DEFAULT_ORG_ID;
      if(profile.organizationId === DEFAULT_ORG_ID){
        profile.organization = getDefaultOrganizationMeta();
        profile.organizationName = profile.organizationName || DEFAULT_ORG_NAME;
      }else if(profile.organizationName){
        profile.organization = { id: profile.organizationId, name: profile.organizationName };
      }
    }
  }

  async function adminCreateUser(options){
    if(isDemoSession()){
      throw new Error('La demo es de solo lectura.');
    }
    const opts = Object.assign({ email: '', password: '', displayName: '', role: null, organizationId: null, organizationName: null }, options);
    const email = (opts.email || '').trim().toLowerCase();
    const password = (opts.password || '').trim();
    const displayName = (opts.displayName || '').trim();
    const requestedRole = normalizeRole(opts.role || DEFAULT_ROLE);
    let organizationId = sanitizeOrganizationId(opts.organizationId);
    const organizationName = sanitizeOrganizationName(opts.organizationName);
    let organizationMeta = null;
    if(db){
      try{
        if(organizationId){
          organizationMeta = await ensureOrganization({ id: organizationId });
          organizationId = organizationMeta ? organizationMeta.id : organizationId;
        }else if(organizationName){
          organizationMeta = await ensureOrganization({ name: organizationName });
          organizationId = organizationMeta ? organizationMeta.id : null;
        }
      }catch(err){
        console.warn('No se pudo preparar la organización para el nuevo usuario', err);
        throw new Error('No se pudo preparar la organización seleccionada.');
      }
    }
    if(!organizationId){
      organizationId = getActiveOrganizationId();
      if(db && organizationId && organizationId !== DEFAULT_ORG_ID && !organizationMeta){
        try{ organizationMeta = await fetchOrganizationMeta(organizationId); }
        catch(err){ console.warn('No se pudo obtener la organización activa', err); }
      }
    }
    if(!organizationId){
      organizationId = DEFAULT_ORG_ID;
    }
    if(!organizationMeta && organizationId === DEFAULT_ORG_ID){
      organizationMeta = getDefaultOrganizationMeta();
    }
    const safeEmail = sanitizeEmail(email);
    const safePassword = sanitizePassword(password);
    const safeDisplayName = sanitizeDisplayName(displayName || '');
    if(!safeEmail){ throw new Error('Ingresá un correo válido.'); }
    if(!safePassword){ throw new Error('La contraseña debe tener al menos 8 caracteres.'); }

    const payload = {
      email: safeEmail,
      password: safePassword,
      displayName: safeDisplayName,
      role: requestedRole,
      organizationId,
      organizationName: organizationMeta && organizationMeta.name ? organizationMeta.name : undefined
    };

    const snapshot = await withRateLimit('adminCreateUser', { windowMs: 15000, max: 4 }, async ()=>{
      const response = await callAdminApi('/users', payload);
      const result = Object.assign({}, response || {}, payload);
      result.uid = result.uid || response?.localId || response?.uid || '';
      result.welcomeEmailSent = !!response?.welcomeEmailSent;
      result.welcomeEmailError = response?.welcomeEmailError || null;
      return result;
    });
    if(db && snapshot.uid){
      try{
        const now = FieldValue ? FieldValue.serverTimestamp() : Date.now();
        const profilePayload = {
          email,
          role: requestedRole,
          displayName: snapshot.displayName,
          organizationId,
          updatedAt: now,
          createdAt: now
        };
        if(organizationMeta && organizationMeta.name){ profilePayload.organizationName = organizationMeta.name; }
        await db.collection('usuarios').doc(snapshot.uid).set(profilePayload, { merge: true });
      }catch(err){
        console.warn('No se pudo guardar el perfil del nuevo usuario', err);
      }
    }
    logAuditEvent('users.create', {
      targetUid: snapshot.uid || null,
      targetEmail: email,
      targetRole: requestedRole,
      organizationId,
      welcomeEmailSent: !!snapshot.welcomeEmailSent
    }).catch(()=>{});
    logAuditEvent('account.provisioned', {
      invitedBy: (auth.currentUser && auth.currentUser.email) || null,
      targetRole: requestedRole,
      organizationId
    }, { uid: snapshot.uid || null, email, displayName: snapshot.displayName }).catch(()=>{});
    return snapshot;
  }

  async function adminDeleteUser(options){
    if(isDemoSession()){
      throw new Error('La demo es de solo lectura.');
    }
    const opts = Object.assign({ uid: '', email: '', displayName: '' }, options);
    const uid = (opts.uid || '').trim();
    const email = (opts.email || '').trim().toLowerCase();
    const displayName = (opts.displayName || '').trim();
    if(!uid && !email){
      throw new Error('Indicá un uid o un correo para eliminar la cuenta.');
    }
    try{
      await withRateLimit('adminDeleteUser', { windowMs: 15000, max: 5 }, async ()=>{
        await callAdminApi('/users/delete', { uid, email });
      });
    }catch(err){
      return { success: false, authDeleted: false, error: err && err.message ? err.message : String(err) };
    }
    logAuditEvent('users.delete', {
      targetUid: uid || null,
      targetEmail: email || null
    }).catch(()=>{});
    if(uid){
      logAuditEvent('account.removed', {
        removedBy: (auth.currentUser && auth.currentUser.email) || null
      }, { uid, email: email || null, displayName: displayName || null }).catch(()=>{});
    }
    return { success: true, authDeleted: true };
  }

  async function updateOwnPassword(currentPassword, newPassword){
    const user = auth.currentUser;
    if(!user){ throw new Error('No hay sesión activa.'); }
    const email = user.email;
    if(!email){ throw new Error('Tu cuenta no tiene correo asociado.'); }
    if(!EmailAuthProvider || typeof user.reauthenticateWithCredential !== 'function'){
      throw new Error('La plataforma no admite actualización de contraseña en este entorno.');
    }
    const credential = EmailAuthProvider.credential(email, currentPassword);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);
    try{ await user.reload(); }
    catch(err){ /* sin recarga */ }
    logAuditEvent('security.password.change', { method: 'self-service' }).catch(()=>{});
    return true;
  }

  async function updateOwnProfile(updates){
    if(!updates || typeof updates !== 'object'){
      throw new Error('No se proporcionaron datos para actualizar.');
    }
    const session = getSessionSnapshot();
    const user = session && session.user ? session.user : null;
    if(!user || !user.uid){
      throw new Error('No hay sesión activa.');
    }
    if(!db || typeof db.collection !== 'function'){
      throw new Error('Firestore no está disponible en este momento.');
    }

    const uid = user.uid;
    const fields = {};
    if(Object.prototype.hasOwnProperty.call(updates, 'displayName')){
      fields.displayName = (updates.displayName || '').trim();
    }
    if(Object.prototype.hasOwnProperty.call(updates, 'responsableName')){
      const responsable = (updates.responsableName || '').trim();
      fields.responsableName = responsable;
      if(!Object.prototype.hasOwnProperty.call(fields, 'displayName') && !Object.prototype.hasOwnProperty.call(updates, 'displayName')){
        fields.displayName = responsable;
      }
    }
    if(Object.prototype.hasOwnProperty.call(updates, 'phone')){
      fields.phone = (updates.phone || '').trim();
    }
    if(Object.prototype.hasOwnProperty.call(updates, 'phoneNumber')){
      fields.phone = (updates.phoneNumber || '').trim();
    }
    if(Object.prototype.hasOwnProperty.call(updates, 'phoneVerified')){
      fields.phoneVerified = !!updates.phoneVerified;
    }
    if(Object.prototype.hasOwnProperty.call(updates, 'notes')){
      fields.notes = updates.notes;
    }

    const previousProfile = sessionState.profile || {};
    if(Object.prototype.hasOwnProperty.call(fields, 'phone')){
      const trimmedPhone = fields.phone;
      const previousPhone = previousProfile && previousProfile.phone ? String(previousProfile.phone).trim() : '';
      if(trimmedPhone !== previousPhone && !Object.prototype.hasOwnProperty.call(fields, 'phoneVerified')){
        fields.phoneVerified = false;
      }
    }

    const keys = Object.keys(fields);
    if(keys.length === 0){
      return false;
    }

    const changedKeys = keys.filter((key)=>{
      if(!Object.prototype.hasOwnProperty.call(fields, key)){ return false; }
      const previousValue = previousProfile ? previousProfile[key] : undefined;
      return (previousValue || '') !== (fields[key] || '');
    });

    const docRef = db.collection('usuarios').doc(uid);
    const writePayload = Object.assign({}, fields);
    if(FieldValue){
      writePayload.updatedAt = FieldValue.serverTimestamp();
    }else{
      writePayload.updatedAt = Date.now();
    }

    await docRef.set(writePayload, { merge: true });

    if(fields.displayName && auth.currentUser && typeof auth.currentUser.updateProfile === 'function'){
      try{ await auth.currentUser.updateProfile({ displayName: fields.displayName }); }
      catch(err){ console.warn('No se pudo actualizar el nombre del perfil en Firebase Auth', err); }
    }

    const localProfile = Object.assign({}, sessionState.profile || {}, fields, { updatedAt: Date.now() });
    const patch = { profile: localProfile, fromCache: false };
    if(fields.displayName){
      patch.user = Object.assign({}, sessionState.user || {}, { displayName: fields.displayName });
    }
    updateSession(patch);

    if(changedKeys.length){
      logAuditEvent('profile.update', { fields: changedKeys }).catch(()=>{});
    }

    return true;
  }

  async function saveTheme(themeInput){
    const user = auth.currentUser;
    if(!user){ throw new Error('No hay sesión activa.'); }
    if(!db || typeof db.collection !== 'function'){ throw new Error('Firestore no está disponible en este momento.'); }
    const sanitized = sanitizeTheme(themeInput);
    if(!sanitized || (!sanitized.palette && !sanitized.logo && !sanitized.brandName && !sanitized.modules)){
      throw new Error('No se detectaron cambios de tema para guardar.');
    }

    const currentTheme = (sessionState.profile && sessionState.profile.theme) || activeTheme;
    const merged = mergeThemeState(currentTheme, sanitized);
    const timestamp = Date.now();
    merged.updatedAt = timestamp;

    const docRef = db.collection('usuarios').doc(user.uid);
    const themePayload = {
      palette: Object.assign({}, merged.palette || {}),
      brandName: merged.brandName || DEFAULT_BRAND_NAME,
      modules: Object.assign({}, DEFAULT_MODULE_LABELS, merged.modules || {})
    };
    if(merged.logo){
      themePayload.logo = Object.assign({}, merged.logo);
    }
    if(FieldValue && typeof FieldValue.serverTimestamp === 'function'){
      themePayload.updatedAt = FieldValue.serverTimestamp();
    }else{
      themePayload.updatedAt = timestamp;
    }

    await docRef.set({ theme: themePayload }, { merge: true });

    const localTheme = Object.assign({}, merged, {
      palette: Object.assign({}, merged.palette || {}),
      modules: Object.assign({}, DEFAULT_MODULE_LABELS, merged.modules || {}),
      logo: merged.logo ? Object.assign({}, merged.logo) : null,
      updatedAt: timestamp
    });

    const profile = Object.assign({}, sessionState.profile || {}, { theme: localTheme });
    updateSession({ profile });

    logAuditEvent('theme.update', {
      accent: localTheme.palette && localTheme.palette.accent ? localTheme.palette.accent : null,
      hasLogo: !!localTheme.logo,
      brandName: localTheme.brandName,
      modulesUpdated: sanitized.modules ? Object.keys(sanitized.modules) : undefined
    }).catch(()=>{});

    return localTheme;
  }

  async function resetTheme(){
    const user = auth.currentUser;
    if(!user){ throw new Error('No hay sesión activa.'); }
    if(!db || typeof db.collection !== 'function'){ throw new Error('Firestore no está disponible en este momento.'); }

    const docRef = db.collection('usuarios').doc(user.uid);
    if(FieldValue && typeof FieldValue.delete === 'function'){
      await docRef.set({ theme: FieldValue.delete() }, { merge: true });
    }else{
      await docRef.set({ theme: null }, { merge: true });
    }

    const profile = Object.assign({}, sessionState.profile || {});
    if(profile.theme){ delete profile.theme; }
    updateSession({ profile });

    logAuditEvent('theme.update', { reset: true }).catch(()=>{});

    return createDefaultTheme();
  }

  function ensureRecaptchaVerifier(containerId, options){
    if(!firebase.auth || typeof firebase.auth.RecaptchaVerifier !== 'function'){
      throw new Error('La verificación telefónica no está disponible en este entorno.');
    }
    const key = containerId || '_default';
    if(recaptchaCache.has(key)){ return recaptchaCache.get(key); }
    const config = Object.assign({ size: 'invisible' }, options || {});
    const verifier = new firebase.auth.RecaptchaVerifier(containerId, config);
    recaptchaCache.set(key, verifier);
    return verifier;
  }

  async function startPhoneVerification(phoneNumber, options){
    if(isDemoSession()){
      throw new Error('La demo es de solo lectura.');
    }
    const user = auth.currentUser;
    if(!user){ throw new Error('Necesitás iniciar sesión para vincular tu teléfono.'); }
    if(!firebase.auth || !firebase.auth.PhoneAuthProvider){
      throw new Error('La verificación telefónica no está disponible en este momento.');
    }
    const phone = (phoneNumber || '').trim();
    if(!phone){ throw new Error('Ingresá un número telefónico con prefijo internacional.'); }
    const opts = Object.assign({ containerId: null, recaptchaOptions: null }, options);
    if(!opts.containerId){
      throw new Error('No se encontró el contenedor de verificación de seguridad.');
    }
    const verifier = ensureRecaptchaVerifier(opts.containerId, opts.recaptchaOptions);
    if(typeof verifier.render === 'function'){
      try{ await verifier.render(); }
      catch(err){ /* continuar igualmente */ }
    }
    try{
      const provider = new firebase.auth.PhoneAuthProvider(auth);
      const verificationId = await provider.verifyPhoneNumber(phone, verifier);
      logAuditEvent('security.phone.challenge', { phone }).catch(()=>{});
      return { verificationId };
    }catch(err){
      if(typeof verifier.reset === 'function'){
        try{ verifier.reset(); }
        catch(resetErr){ /* ignorar */ }
      }
      throw err;
    }
  }

  async function confirmPhoneVerification(verificationId, code){
    if(isDemoSession()){
      throw new Error('La demo es de solo lectura.');
    }
    const user = auth.currentUser;
    if(!user){ throw new Error('Necesitás iniciar sesión para confirmar tu teléfono.'); }
    if(!firebase.auth || !firebase.auth.PhoneAuthProvider){
      throw new Error('La verificación telefónica no está disponible en este momento.');
    }
    if(!verificationId){ throw new Error('Solicitá un código de verificación antes de confirmarlo.'); }
    const smsCode = (code || '').trim();
    if(!smsCode){ throw new Error('Ingresá el código SMS recibido.'); }
    const credential = firebase.auth.PhoneAuthProvider.credential(verificationId, smsCode);
    let phoneNumber = null;
    try{
      const result = await user.linkWithCredential(credential);
      phoneNumber = (result && result.user && result.user.phoneNumber) || null;
    }catch(err){
      if(err && err.code === 'auth/provider-already-linked'){
        await user.updatePhoneNumber(credential);
        phoneNumber = auth.currentUser ? auth.currentUser.phoneNumber : null;
      }else if(err && err.code === 'auth/credential-already-in-use'){
        throw new Error('Este número de teléfono ya está vinculado a otra cuenta.');
      }else if(err && err.message){
        throw err;
      }else{
        throw new Error('No se pudo confirmar el código recibido.');
      }
    }
    if(!phoneNumber){
      phoneNumber = auth.currentUser ? auth.currentUser.phoneNumber : null;
    }
    if(phoneNumber){
      await updateOwnProfile({ phone: phoneNumber, phoneVerified: true });
      logAuditEvent('security.phone.enrolled', { phone: phoneNumber }).catch(()=>{});
    }
    return { phoneNumber };
  }

  async function importClients(records, options){
    if(!Array.isArray(records)){ throw new Error('Indicá un listado de clientes para importar.'); }
    if(!records.length){ return { imported: 0, skipped: 0, errors: [] }; }
    if(!db || typeof db.collection !== 'function'){ throw new Error('Firestore no está disponible en este momento.'); }
    const canManage = !!(sessionState && sessionState.abilities && sessionState.abilities.manageClients);
    if(!canManage){ throw new Error('No tenés permisos para importar clientes.'); }
    const opts = Object.assign({ source: 'archivo' }, options);
    const errors = [];
    const sanitized = [];
    const organizationId = getActiveOrganizationId();
    if(!organizationId){
      throw new Error('Tu perfil no tiene una organización asignada.');
    }
    const actor = auth.currentUser ? (auth.currentUser.email || auth.currentUser.uid || null) : null;

    function normalizeString(value){
      return typeof value === 'string' ? value.trim() : '';
    }

    function normalizeRutValue(value){
      return normalizeString(value).replace(/[^0-9kK]/g,'').toUpperCase();
    }

    function toBoolean(value){
      if(typeof value === 'boolean'){ return value; }
      if(typeof value === 'number'){ return value > 0; }
      const normalized = normalizeString(value).toLowerCase();
      if(!normalized){ return false; }
      return ['si','sí','true','1','mensual','contrato','abonado','suscripcion','suscripción','yes'].includes(normalized);
    }

    records.forEach((entry, index)=>{
      const nombre = normalizeString(entry && entry.nombre);
      if(!nombre){
        errors.push({ index, reason: 'Falta el nombre del cliente.' });
        return;
      }
      const rut = normalizeString(entry && (entry.rut || entry.documento || entry.identificacion));
      const rutNormalized = normalizeRutValue(rut);
      const direccion = normalizeString(entry && (entry.direccion || entry['dirección'] || entry.address));
      const telefono = normalizeString(entry && (entry.telefono || entry['teléfono'] || entry.phone));
      const notas = normalizeString(entry && (entry.notas || entry.notes));
      const contrato = toBoolean(entry && (entry.contrato || entry.plan || entry.mensual));
      let monto = entry && entry.monto !== undefined ? entry.monto : (entry && entry.importe !== undefined ? entry.importe : '');
      if(typeof monto === 'number' && Number.isFinite(monto)){
        monto = Math.round(monto * 100) % 100 === 0 ? Math.round(monto).toString() : monto.toString();
      }else{
        monto = normalizeString(monto);
      }

      const payload = {
        nombre,
        rut,
        rutNormalized,
        direccion,
        contrato,
        monto,
        telefono,
        notas,
        importado: true,
        importFuente: opts.source,
        actualizadoPor: actor
      };

      sanitized.push({
        id: normalizeString(entry && (entry.id || entry.uid || entry.ID)),
        payload
      });
    });

    if(!sanitized.length){
      throw new Error('No se encontraron registros válidos para importar.');
    }

    const collection = db.collection('clientes');
    const chunkSize = 400;
    let imported = 0;

    while(sanitized.length){
      const chunk = sanitized.splice(0, chunkSize);
      const batch = db.batch();
      chunk.forEach((entry)=>{
        const docRef = entry.id ? collection.doc(entry.id) : collection.doc();
        const writePayload = Object.assign({}, entry.payload, { organizationId });
        if(FieldValue && typeof FieldValue.serverTimestamp === 'function'){
          writePayload.updatedAt = FieldValue.serverTimestamp();
          writePayload.importedAt = FieldValue.serverTimestamp();
        }else{
          const now = Date.now();
          writePayload.updatedAt = now;
          writePayload.importedAt = now;
        }
        batch.set(docRef, writePayload, { merge: true });
      });
      await batch.commit();
      imported += chunk.length;
    }

    logAuditEvent('clients.import', { total: imported, skipped: errors.length, source: opts.source }, { organizationId }).catch(()=>{});

    return { imported, skipped: errors.length, errors };
  }

  const DEFAULT_MODULE_PERMISSIONS = Object.freeze({
    home: 'read',
    clientes: 'read',
    retiros: 'read',
    finanzas: 'read',
    configuracion: 'read',
    usuarios: 'read',
    temas: 'read'
  });

  const ROLE_MATRIX = {
    admin: {
      manageClients: true,
      manageRetiros: true,
      managePagos: true,
      manageChecklist: true,
      manageUsers: true,
      manageTheme: true,
      customizeModules: true,
      exportData: true,
      completeForms: true,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        home: 'write', clientes: 'write', retiros: 'write', finanzas: 'write', configuracion: 'write', usuarios: 'write', temas: 'write'
      })
    },
    manager: {
      manageClients: true,
      manageRetiros: true,
      managePagos: true,
      manageChecklist: true,
      manageUsers: false,
      manageTheme: false,
      customizeModules: false,
      exportData: true,
      completeForms: true,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        clientes: 'write', retiros: 'write', finanzas: 'write', configuracion: 'write', usuarios: 'read', temas: 'read'
      })
    },
    operator: {
      manageClients: true,
      manageRetiros: true,
      managePagos: true,
      manageChecklist: false,
      manageUsers: false,
      manageTheme: false,
      customizeModules: false,
      exportData: false,
      completeForms: true,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        clientes: 'write', retiros: 'write', finanzas: 'write', configuracion: 'read', usuarios: 'read', temas: 'read'
      })
    },
    viewer: {
      manageClients: false,
      manageRetiros: false,
      managePagos: false,
      manageChecklist: false,
      manageUsers: false,
      manageTheme: false,
      customizeModules: false,
      exportData: false,
      completeForms: false,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        clientes: 'read', retiros: 'read', finanzas: 'read', configuracion: 'read', usuarios: 'read', temas: 'read'
      })
    },
    control: {
      manageClients: true,
      manageRetiros: true,
      managePagos: true,
      manageChecklist: true,
      manageUsers: false,
      manageTheme: false,
      customizeModules: false,
      exportData: true,
      completeForms: true,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        clientes: 'write', retiros: 'write', finanzas: 'write', configuracion: 'write', usuarios: 'read', temas: 'read'
      })
    },
    demo: {
      manageClients: false,
      manageRetiros: false,
      managePagos: false,
      manageChecklist: false,
      manageUsers: true,
      manageTheme: true,
      customizeModules: false,
      exportData: false,
      completeForms: false,
      modulePermissions: Object.assign({}, DEFAULT_MODULE_PERMISSIONS, {
        home: 'write', temas: 'write', configuracion: 'read'
      })
    }
  };

  const ROLE_ALIASES = {
    administrador: 'admin',
    administradora: 'admin',
    administradores: 'admin',
    'administrador/a': 'admin',
    administracion: 'admin',
    administrator: 'admin',
    administrateur: 'admin',
    superadmin: 'admin',
    superadministrador: 'admin',
    superadministradora: 'admin',
    gerencia: 'admin',
    'gerencia general': 'admin',
    controladora: 'control',
    controlador: 'control',
    controladores: 'control',
    control: 'control',
    viewer: 'viewer',
    lectura: 'viewer',
    auditor: 'viewer',
    auditoria: 'viewer',
    gerente: 'manager',
    manager: 'manager',
    supervisora: 'manager',
    supervisor: 'manager',
    operadora: 'operator',
    operador: 'operator',
    operacion: 'operator',
    demo: 'demo'
  };

  const EMAIL_ROLE_OVERRIDES = {
    'prueba@gestionsostenible.com': 'admin'
  };

  const DEFAULT_ROLE = 'viewer';
  const SESSION_STORAGE_KEY = 'gs:session:snapshot';

  function clone(value){
    if(value === null || value === undefined) return value;
    try{
      return JSON.parse(JSON.stringify(value));
    }catch(err){
      return value;
    }
  }

  function describeAuthError(err, options){
    const opts = options || {};
    const code = typeof err === 'object' && err && typeof err.code === 'string' ? err.code : '';
    const message = typeof err === 'object' && err && typeof err.message === 'string' ? err.message : '';
    const host = opts.host || (typeof location !== 'undefined' ? location.hostname : 'este dominio');

    if(code === 'auth/operation-not-allowed' || message.includes('origin is not whitelisted')){
      return `El dominio “${host}” no está autorizado en Firebase Authentication. Agrégalo en Auth > Settings > Authorized domains y reintentá, o usá el modo demo mientras tanto.`;
    }
    if(code === 'auth/network-request-failed'){
      return 'No pudimos contactar a Firebase. Revisá la conexión o la configuración del hosting.';
    }
    if(code === 'auth/invalid-api-key'){
      return 'La clave de Firebase es inválida o no está habilitada para este dominio.';
    }
    if(code === 'auth/user-not-found' || code === 'auth/wrong-password'){
      return 'Correo o contraseña incorrectos. Verificá los datos e intentá nuevamente.';
    }
    return message || 'Error de autenticación. Intentá de nuevo más tarde.';
  }

  function setDemoStorage(enabled, data){
    if(!localStore) return;
    try{
      if(enabled){
        localStore.setItem(DEMO_MODE_KEY, 'enabled');
        if(data){
          localStore.setItem(DEMO_DATA_KEY, JSON.stringify(data));
        }
      }else{
        localStore.removeItem(DEMO_MODE_KEY);
        localStore.removeItem(DEMO_DATA_KEY);
      }
    }catch(err){ /* almacenamiento no disponible */ }
  }

  function readDemoStorage(){
    if(!localStore) return null;
    try{
      const flag = localStore.getItem(DEMO_MODE_KEY);
      if(flag !== 'enabled'){ return null; }
      const raw = localStore.getItem(DEMO_DATA_KEY);
      return raw ? JSON.parse(raw) : {};
    }catch(err){
      return {};
    }
  }

  function sanitizeDemoData(payload){
    if(!payload || typeof payload !== 'object'){ return {}; }
    const data = clone(payload) || {};
    if(data.pagos && Array.isArray(data.pagos.items)){ // ensure monto formatting
      data.pagos.items = data.pagos.items.map(item=>{
        if(item && typeof item === 'object' && !item.mes){
          const mes = data.pagos.mes;
          return Object.assign({ mes }, item);
        }
        return item;
      });
    }
    if(data.dgi && !data.dgi.mes){
      const now = new Date();
      data.dgi.mes = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    }
    return data;
  }

  function sanitizeColorString(value){
    if(!value || typeof value !== 'string'){ return null; }
    const trimmed = value.trim();
    if(!trimmed){ return null; }
    if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)){ return trimmed.startsWith('#') ? trimmed : `#${trimmed}`; }
    if(/^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed)){ return trimmed; }
    return null;
  }

  function sanitizeModuleLabels(input){
    const modules = {};
    if(!input || typeof input !== 'object'){ return modules; }
    MODULE_KEYS.forEach((key)=>{
      if(!Object.prototype.hasOwnProperty.call(input, key)){ return; }
      const raw = input[key];
      if(typeof raw !== 'string'){ return; }
      const trimmed = raw.trim();
      if(!trimmed){ return; }
      modules[key] = trimmed.slice(0, 80);
    });
    return modules;
  }

  function sanitizeTheme(input){
    if(!input || typeof input !== 'object'){ return null; }
    const theme = { palette: {}, logo: null, updatedAt: null };
    const paletteSource = input.palette && typeof input.palette === 'object' ? input.palette : input;
    THEME_KEYS.forEach((key)=>{
      const raw = paletteSource && paletteSource[key] !== undefined ? paletteSource[key] : undefined;
      if(typeof raw === 'string'){
        const value = sanitizeColorString(raw);
        if(value){ theme.palette[key] = value; }
      }
    });

    if(input.logo && typeof input.logo === 'object'){
      const logo = {};
      if(typeof input.logo.dataUrl === 'string'){ logo.dataUrl = input.logo.dataUrl; }
      if(typeof input.logo.name === 'string'){
        const trimmed = input.logo.name.trim();
        if(trimmed){ logo.name = trimmed.slice(0, 120); }
      }
      if(typeof input.logo.aspect === 'number'){ logo.aspect = input.logo.aspect; }
      const updatedAt = toMillis(input.logo.updatedAt);
      if(updatedAt){ logo.updatedAt = updatedAt; }
      if(Object.keys(logo).length){ theme.logo = logo; }
    }

    let brandName = null;
    if(typeof input.brandName === 'string'){
      const trimmed = input.brandName.trim();
      if(trimmed){ brandName = trimmed.slice(0, 120); }
    }
    if(!brandName && input.logo && typeof input.logo.name === 'string'){
      const trimmed = input.logo.name.trim();
      if(trimmed){ brandName = trimmed.slice(0, 120); }
    }
    if(brandName){ theme.brandName = brandName; }

    const modulesSource = input.modules || input.moduleLabels || null;
    const modules = sanitizeModuleLabels(modulesSource);
    if(Object.keys(modules).length){ theme.modules = modules; }

    const updatedAt = toMillis(input.updatedAt);
    if(updatedAt){ theme.updatedAt = updatedAt; }

    if(!Object.keys(theme.palette).length && !theme.logo && !theme.brandName && !theme.modules){
      return null;
    }
    return theme;
  }

  function buildTheme(theme){
    const base = createDefaultTheme();
    const sanitized = sanitizeTheme(theme);
    if(sanitized){
      if(sanitized.palette){
        base.palette = Object.assign({}, base.palette, sanitized.palette);
      }
      if(sanitized.logo){
        base.logo = sanitized.logo;
      }
      if(sanitized.brandName){
        base.brandName = sanitized.brandName;
      }else if(sanitized.logo && sanitized.logo.name){
        base.brandName = sanitized.logo.name;
      }
      if(sanitized.modules){
        base.modules = Object.assign({}, base.modules || {}, sanitized.modules);
      }
      if(sanitized.updatedAt){
        base.updatedAt = sanitized.updatedAt;
      }
    }
    return base;
  }

  function mergeThemeState(baseTheme, updates){
    const base = buildTheme(baseTheme);
    const merged = createDefaultTheme();
    if(base.palette){
      merged.palette = Object.assign({}, merged.palette, clone(base.palette));
    }
    if(base.logo){
      merged.logo = Object.assign({}, base.logo);
    }else{
      merged.logo = null;
    }
    if(base.brandName){
      merged.brandName = base.brandName;
    }
    if(base.modules){
      merged.modules = Object.assign({}, merged.modules, clone(base.modules));
    }
    if(base.updatedAt){
      merged.updatedAt = base.updatedAt;
    }
    if(updates){
      if(updates.palette){
        merged.palette = Object.assign({}, merged.palette, clone(updates.palette));
      }
      if(Object.prototype.hasOwnProperty.call(updates, 'logo')){
        merged.logo = updates.logo ? Object.assign({}, updates.logo) : null;
      }
      if(updates.brandName){
        merged.brandName = updates.brandName;
      }
      if(updates.modules){
        merged.modules = Object.assign({}, merged.modules, clone(updates.modules));
      }
      if(updates.updatedAt){
        merged.updatedAt = updates.updatedAt;
      }
    }
    return merged;
  }

  function themesEqual(a, b){
    if(a === b){ return true; }
    try{
      return JSON.stringify(a) === JSON.stringify(b);
    }catch(err){
      return false;
    }
  }

  function ensureThemeStyle(){
    if(themeStyleEl){ return themeStyleEl; }
    themeStyleEl = document.createElement('style');
    themeStyleEl.id = 'gs-theme';
    document.head.appendChild(themeStyleEl);
    return themeStyleEl;
  }

  function applyThemePalette(palette){
    const styleEl = ensureThemeStyle();
    const merged = Object.assign({}, createDefaultTheme().palette, palette || {});
    const selector = 'html.theme-applied, body.theme-applied';
    styleEl.textContent = `${selector}{`
      + THEME_KEYS.map((key)=> `--${key.replace(/([A-Z])/g,'-$1').toLowerCase()}:${merged[key]};`).join('')
      + `}`;
  }

  function ensureThemeBroadcast(){
    if(themeBroadcast || typeof BroadcastChannel !== 'function'){ return themeBroadcast; }
    try{
      themeBroadcast = new BroadcastChannel('gs-theme');
      themeBroadcast.addEventListener('message', (event)=>{
        const data = event && event.data ? event.data : null;
        if(!data || data.source === runtimeId){ return; }
        if(data.type === 'theme:update'){
          updateThemeState(data.theme || null, { persist: false, silent: false, broadcast: false });
        }else if(data.type === 'theme:reset'){
          previewThemeBackup = null;
          updateThemeState(null, { persist: false, silent: false, broadcast: false });
        }
      });
    }catch(err){
      themeBroadcast = null;
    }
    return themeBroadcast;
  }

  function broadcastThemeSnapshot(theme, action, options){
    const opts = Object.assign({
      skipParent: false,
      skipOpener: false,
      skipFrames: false,
      excludeSource: null
    }, options || {});
    const payload = {
      [THEME_MESSAGE_FLAG]: true,
      type: action || 'theme:update',
      source: runtimeId,
      theme: theme ? clone(theme) : null
    };
    const channel = ensureThemeBroadcast();
    if(channel){
      try{
        channel.postMessage(payload);
      }catch(err){
        /* ignorar fallos de canal */
      }
    }
    const targetOrigin = '*';
    if(!opts.skipParent && global.parent && global.parent !== global && typeof global.parent.postMessage === 'function'){
      try{ global.parent.postMessage(payload, targetOrigin); }
      catch(err){ /* ignorar */ }
    }
    if(!opts.skipOpener && global.opener && typeof global.opener.postMessage === 'function'){
      try{ global.opener.postMessage(payload, targetOrigin); }
      catch(err){ /* ignorar */ }
    }
    if(!opts.skipFrames && global.frames && global.frames.length){
      for(let index = 0; index < global.frames.length; index += 1){
        const frame = global.frames[index];
        if(!frame || frame === global || frame === opts.excludeSource){ continue; }
        if(typeof frame.postMessage === 'function'){
          try{ frame.postMessage(payload, targetOrigin); }
          catch(err){ /* ignorar */ }
        }
      }
    }
  }

  function notifyThemeListeners(){
    const snapshot = getThemeSnapshot();
    themeListeners.forEach((listener)=>{
      try{ listener(snapshot); }
      catch(err){ console.error('gsAuth theme listener error', err); }
    });
  }

  function persistTheme(theme){
    if(!localStore) return;
    try{
      localStore.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    }catch(err){ /* almacenamiento no disponible */ }
  }

  function restoreThemeFromStorage(){
    if(!localStore) return null;
    try{
      const raw = localStore.getItem(THEME_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(err){
      return null;
    }
  }

  function isTrustedThemeMessage(event){
    if(!event){ return false; }
    if(typeof event.origin === 'undefined'){ return true; }
    if(event.origin === null || event.origin === 'null' || event.origin === ''){ return true; }
    if(global.location && event.origin === global.location.origin){ return true; }
    return false;
  }

  if(typeof window !== 'undefined' && typeof window.addEventListener === 'function'){
    window.addEventListener('storage', (event)=>{
      if(!event){ return; }
      if(event.key !== THEME_STORAGE_KEY){ return; }
      if(event.newValue === event.oldValue){ return; }
      try{
        const parsed = event.newValue ? JSON.parse(event.newValue) : null;
        if(parsed){
          updateThemeState(parsed, { persist: false, broadcast: false });
        }else{
          updateThemeState(null, { persist: false, broadcast: false });
        }
      }catch(err){ /* ignorar */ }
    });
    window.addEventListener('message', (event)=>{
      const data = event && event.data ? event.data : null;
      if(!data || data[THEME_MESSAGE_FLAG] !== true){ return; }
      if(data.source === runtimeId){ return; }
      if(!isTrustedThemeMessage(event)){ return; }
      const sourceWin = event && event.source ? event.source : null;
      const broadcastOptions = {
        excludeSource: sourceWin,
        skipParent: sourceWin && (sourceWin === window.parent || sourceWin === window) ? true : false,
        skipOpener: sourceWin && sourceWin === window.opener ? true : false
      };
      updateThemeState(data.theme || null, {
        persist: false,
        silent: false,
        broadcast: true,
        broadcastOptions
      });
    });
  }

  function updateThemeState(theme, options){
    const opts = Object.assign({ persist: true, silent: false, broadcast: true, broadcastOptions: null }, options);
    const next = buildTheme(theme);
    if(themesEqual(activeTheme, next)){ return activeTheme; }
    activeTheme = next;
    applyThemePalette(activeTheme.palette);
    if(opts.persist){
      persistTheme(activeTheme);
    }
    if(opts.persist){
      previewThemeBackup = null;
    }
    if(opts.broadcast !== false){
      const snapshot = getThemeSnapshot();
      const isReset = !theme;
      broadcastThemeSnapshot(isReset ? null : snapshot, isReset ? 'theme:reset' : 'theme:update', opts.broadcastOptions);
    }
    if(!opts.silent){
      notifyThemeListeners();
    }
    return activeTheme;
  }

  function getThemeSnapshot(){
    return clone(activeTheme);
  }

  function subscribeTheme(callback){
    if(typeof callback !== 'function'){ return ()=>{}; }
    themeListeners.add(callback);
    try{ callback(getThemeSnapshot()); }
    catch(err){ console.error('gsAuth theme listener error', err); }
    return ()=> themeListeners.delete(callback);
  }

  function previewTheme(theme){
    if(theme){
      const sanitized = sanitizeTheme(theme);
      if(!sanitized){ return getThemeSnapshot(); }
      if(!previewThemeBackup){
        previewThemeBackup = getThemeSnapshot();
      }
      const base = previewThemeBackup || getThemeSnapshot();
      const merged = mergeThemeState(base, sanitized);
      return updateThemeState(merged, { persist: false });
    }
    if(previewThemeBackup){
      const snapshot = previewThemeBackup;
      previewThemeBackup = null;
      return updateThemeState(snapshot, { persist: false });
    }
    syncThemeWithSessionState();
    return getThemeSnapshot();
  }

  const cachedTheme = restoreThemeFromStorage();
  if(cachedTheme){
    activeTheme = buildTheme(cachedTheme);
  }
  applyThemePalette(activeTheme.palette);

  function toMillis(value){
    if(value === null || value === undefined){ return null; }
    if(typeof value === 'number' && Number.isFinite(value)){ return value; }
    if(typeof value === 'string'){ const parsed = Date.parse(value); return Number.isNaN(parsed) ? null : parsed; }
    if(value && typeof value.toDate === 'function'){ return value.toDate().getTime(); }
    if(value && typeof value.seconds === 'number'){ return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0)/1e6); }
    return null;
  }

  function sanitizeAuditMetadata(meta){
    if(!meta || typeof meta !== 'object'){ return {}; }
    const output = {};
    Object.keys(meta).forEach((key)=>{
      if(typeof key !== 'string'){ return; }
      const lower = key.toLowerCase();
      if(lower.includes('password') || lower.includes('passcode') || lower.includes('secret')){ return; }
      const value = meta[key];
      if(value === undefined){ return; }
      if(value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'){
        output[key] = value;
        return;
      }
      if(Array.isArray(value)){
        output[key] = value.slice(0, 10).map((entry)=>{
          if(entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean'){
            return entry;
          }
          if(typeof entry === 'object'){
            return sanitizeAuditMetadata(entry);
          }
          try{ return JSON.parse(JSON.stringify(entry)); }
          catch(err){ return String(entry); }
        });
        return;
      }
      if(typeof value === 'object'){
        output[key] = sanitizeAuditMetadata(value);
        return;
      }
      output[key] = String(value);
    });
    return output;
  }

  function normalizeAuditItem(item){
    if(!item || typeof item !== 'object'){ return null; }
    const occurredAt = toMillis(item.occurredAt || item.createdAt || Date.now());
    const createdAt = toMillis(item.createdAt || item.occurredAt || Date.now());
    return {
      id: item.id || null,
      uid: item.uid || null,
      email: item.email || null,
      event: item.event || '',
      meta: item.meta && typeof item.meta === 'object' ? item.meta : {},
      actor: item.actor && typeof item.actor === 'object' ? item.actor : null,
      contextRole: item.contextRole || null,
      occurredAt: occurredAt || createdAt || Date.now(),
      createdAt: createdAt || occurredAt || Date.now()
    };
  }

  function readAuditCache(uid){
    if(!localStore || !uid){ return null; }
    try{
      const raw = localStore.getItem(AUDIT_CACHE_PREFIX + uid);
      if(!raw){ return null; }
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed.items)
        ? parsed.items.map(normalizeAuditItem).filter(Boolean)
        : [];
      return {
        items,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null
      };
    }catch(err){
      return null;
    }
  }

  function writeAuditCache(uid, items){
    if(!localStore || !uid){ return; }
    const list = Array.isArray(items) ? items.map(normalizeAuditItem).filter(Boolean) : [];
    try{
      const payload = {
        updatedAt: Date.now(),
        items: list.slice(0, AUDIT_CACHE_LIMIT)
      };
      localStore.setItem(AUDIT_CACHE_PREFIX + uid, JSON.stringify(payload));
    }catch(err){
      /* sin cache */
    }
  }

  function appendAuditCacheEntry(uid, entry){
    if(!uid){ return; }
    const cached = readAuditCache(uid);
    const existing = cached && Array.isArray(cached.items) ? cached.items : [];
    const normalized = normalizeAuditItem(entry);
    if(!normalized){ return; }
    const items = [normalized].concat(existing.filter((item)=> item && item.id !== normalized.id));
    writeAuditCache(uid, items);
  }

  async function logAuditEvent(eventName, metadata, overrides){
    if(!eventName){ return null; }
    const session = getSessionSnapshot();
    const actorOverride = overrides && overrides.actor ? overrides.actor : null;
    const actor = actorOverride || (session && session.user ? session.user : null);
    const target = (()=>{
      if(overrides && (overrides.uid || (overrides.user && overrides.user.uid))){
        return {
          uid: overrides.uid || (overrides.user && overrides.user.uid) || null,
          email: overrides.email || (overrides.user && overrides.user.email) || null,
          displayName: overrides.displayName || (overrides.user && overrides.user.displayName) || null
        };
      }
      if(actor){
        return {
          uid: actor.uid || null,
          email: actor.email || null,
          displayName: actor.displayName || null
        };
      }
      return null;
    })();

    if(!target || !target.uid){ return null; }

    const contextRole = overrides && overrides.contextRole
      ? overrides.contextRole
      : (session ? normalizeRole(session.role, session.user) : null);

    const organizationId = overrides && overrides.organizationId
      ? sanitizeOrganizationId(overrides.organizationId)
      : (session && session.profile && session.profile.organizationId)
        ? sanitizeOrganizationId(session.profile.organizationId)
        : DEFAULT_ORG_ID;

    const payload = {
      uid: target.uid,
      email: target.email || null,
      event: eventName,
      meta: sanitizeAuditMetadata(metadata || {}),
      actor: actor ? {
        uid: actor.uid || null,
        email: actor.email || null,
        displayName: actor.displayName || null
      } : null,
      contextRole: contextRole || null,
      organizationId: organizationId || DEFAULT_ORG_ID,
      occurredAt: FieldValue ? FieldValue.serverTimestamp() : Date.now(),
      createdAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };

    const fallback = normalizeAuditItem(Object.assign({}, payload, {
      id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      occurredAt: Date.now(),
      createdAt: Date.now()
    }));

    if(db && typeof db.collection === 'function'){
      try{
        const ref = await db.collection(AUDIT_COLLECTION).add(payload);
        fallback.id = ref.id || fallback.id;
        appendAuditCacheEntry(target.uid, fallback);
        return ref;
      }catch(err){
        console.warn('No se pudo registrar el evento de auditoría', err);
        appendAuditCacheEntry(target.uid, fallback);
        return null;
      }
    }

    appendAuditCacheEntry(target.uid, fallback);
    return null;
  }

  async function fetchAuditLog(options){
    const opts = Object.assign({ scope: 'current-user', uid: null, limit: 20 }, options);
    const session = getSessionSnapshot();
    let targetUid = opts.uid || null;
    if(!targetUid && opts.scope !== 'all'){
      targetUid = session && session.user ? session.user.uid : null;
    }
    if(!targetUid){
      return { items: [], fromCache: true };
    }

    if(!db || typeof db.collection !== 'function'){
      const cachedOnly = readAuditCache(targetUid);
      return { items: cachedOnly ? cachedOnly.items : [], fromCache: true };
    }

    let query = db.collection(AUDIT_COLLECTION).where('uid','==', targetUid).orderBy('occurredAt','desc');
    if(opts.limit && opts.limit > 0){
      query = query.limit(opts.limit);
    }

    const snapshot = await query.get();
    const items = [];
    snapshot.forEach((doc)=>{
      const data = doc.data() || {};
      items.push(normalizeAuditItem(Object.assign({}, data, { id: doc.id })));
    });
    writeAuditCache(targetUid, items);
    const metadata = snapshot && snapshot.metadata ? snapshot.metadata : null;
    return { items, fromCache: metadata ? metadata.fromCache : false };
  }

  function subscribeAuditLog(options, callback){
    if(typeof callback !== 'function'){ return ()=>{}; }
    const opts = Object.assign({ scope: 'current-user', uid: null, limit: 20 }, options);
    const session = getSessionSnapshot();
    let targetUid = opts.uid || null;
    if(!targetUid && opts.scope !== 'all'){
      targetUid = session && session.user ? session.user.uid : null;
    }
    if(!targetUid){
      callback({ items: [], fromCache: true });
      return ()=>{};
    }

    const cached = readAuditCache(targetUid);
    if(cached && Array.isArray(cached.items)){
      callback({ items: cached.items, fromCache: true });
    }

    if(!db || typeof db.collection !== 'function'){
      return ()=>{};
    }

    let query = db.collection(AUDIT_COLLECTION).where('uid','==', targetUid).orderBy('occurredAt','desc');
    if(opts.limit && opts.limit > 0){
      query = query.limit(opts.limit);
    }

    const unsubscribe = query.onSnapshot((snapshot)=>{
      const items = [];
      snapshot.forEach((doc)=>{
        const data = doc.data() || {};
        items.push(normalizeAuditItem(Object.assign({}, data, { id: doc.id })));
      });
      writeAuditCache(targetUid, items);
      callback({ items, fromCache: snapshot.metadata ? snapshot.metadata.fromCache : false });
    }, (error)=>{
      console.error('No se pudo sincronizar el historial de actividad', error);
      callback({ items: cached && Array.isArray(cached.items) ? cached.items : [], error });
    });

    return unsubscribe;
  }

  function pickRoleValue(candidate){
    if(typeof candidate === 'string'){
      return candidate;
    }
    if(candidate && typeof candidate === 'object'){
      if(typeof candidate.role === 'string'){
        return candidate.role;
      }
      if(typeof candidate.value === 'string'){
        return candidate.value;
      }
      if(typeof candidate.name === 'string'){
        return candidate.name;
      }
    }
    return '';
  }

  function extractEmail(context){
    if(!context){ return ''; }
    if(typeof context === 'string'){
      return context.trim().toLowerCase();
    }
    if(typeof context === 'object'){
      if(typeof context.email === 'string'){
        return context.email.trim().toLowerCase();
      }
      if(typeof context.userEmail === 'string'){
        return context.userEmail.trim().toLowerCase();
      }
      if(context.user && typeof context.user.email === 'string'){
        return context.user.email.trim().toLowerCase();
      }
      if(context.profile && typeof context.profile.email === 'string'){
        return context.profile.email.trim().toLowerCase();
      }
    }
    return '';
  }

  function normalizeRole(role, context){
    const email = extractEmail(context);
    let candidate = pickRoleValue(role);
    if(!candidate && context && typeof context === 'object'){
      candidate = pickRoleValue(context.role);
    }
    if(email && EMAIL_ROLE_OVERRIDES[email]){
      candidate = EMAIL_ROLE_OVERRIDES[email];
    }

    if(typeof candidate === 'string'){
      const raw = candidate.trim();
      if(!raw){ return DEFAULT_ROLE; }

      const lower = raw.toLowerCase();
      if(lower === 'guest'){
        return 'guest';
      }
      if(ROLE_MATRIX[lower]){
        return lower;
      }
      if(ROLE_ALIASES[lower]){
        return ROLE_ALIASES[lower];
      }

      const sanitized = typeof raw.normalize === 'function'
        ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        : lower;

      if(ROLE_MATRIX[sanitized]){
        return sanitized;
      }
      if(ROLE_ALIASES[sanitized]){
        return ROLE_ALIASES[sanitized];
      }

      if(lower.includes('admin') || sanitized.includes('admin')){
        return 'admin';
      }
      if(lower.includes('control') || sanitized.includes('control')){
        return 'control';
      }
    }

    if(email && EMAIL_ROLE_OVERRIDES[email]){
      return normalizeRole(EMAIL_ROLE_OVERRIDES[email]);
    }

    return DEFAULT_ROLE;
  }

  function computeAbilities(role){
    const key = normalizeRole(role);
    const abilities = ROLE_MATRIX[key] || ROLE_MATRIX[DEFAULT_ROLE];
    const modulePermissions = Object.assign({}, DEFAULT_MODULE_PERMISSIONS, abilities.modulePermissions || {});
    return Object.assign({}, abilities, { modulePermissions });
  }

  function ready(fn){
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }else{
      fn();
    }
  }

  function safeUserSnapshot(user){
    if(!user){ return null; }
    const metadata = user.metadata || {};
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      phoneNumber: user.phoneNumber || '',
      emailVerified: !!user.emailVerified,
      metadata: {
        creationTime: metadata.creationTime || null,
        lastSignInTime: metadata.lastSignInTime || null
      }
    };
  }

  let sessionState = {
    status: 'initial',
    user: null,
    profile: null,
    role: 'guest',
    abilities: computeAbilities(null),
    organizationId: DEFAULT_ORG_ID,
    fromCache: false
  };

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const SESSION_IDLE_LIMIT_MS_DEFAULT = 45 * 60 * 1000;
  let idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
  let idleTimeoutHandle = null;
  let idleEventsBound = false;

  function bindIdleEvents(){
    if(idleEventsBound || !global.document){ return; }
    ['visibilitychange','pointermove','keydown','focus'].forEach((evt)=>{
      document.addEventListener(evt, resetIdleTimer, { passive: true });
    });
    idleEventsBound = true;
  }

  function setIdleTimeoutMs(value){
    const parsed = Number(value);
    if(Number.isFinite(parsed) && parsed >= 5 * 60 * 1000){
      idleTimeoutMs = parsed;
    }else{
      idleTimeoutMs = SESSION_IDLE_LIMIT_MS_DEFAULT;
    }
    resetIdleTimer();
  }

  function resetIdleTimer(){
    if(idleTimeoutHandle){
      clearTimeout(idleTimeoutHandle);
    }
    if(demoMode || !sessionState || sessionState.status !== 'authenticated' || !sessionState.user){ return; }
    if(idleTimeoutMs <= 0){ return; }
    idleTimeoutHandle = setTimeout(()=>{
      logAuditEvent('session.timeout', { idleTimeoutMs }, { uid: sessionState.user.uid, email: sessionState.user.email || null }).catch(()=>{});
      auth.signOut().catch(()=>{});
    }, idleTimeoutMs);
  }

  function getIdleTimeoutMs(){
    return idleTimeoutMs;
  }

  function hasModulePermission(moduleKey, level){
    const normalized = (typeof moduleKey === 'string') ? moduleKey.replace('#/','').replace('.html','') : '';
    const targetLevel = level || 'read';
    const perms = (sessionState && sessionState.abilities && sessionState.abilities.modulePermissions)
      ? sessionState.abilities.modulePermissions
      : DEFAULT_MODULE_PERMISSIONS;
    const current = perms[normalized] || perms[moduleKey] || 'none';
    if(targetLevel === 'write'){
      return current === 'write';
    }
    return current === 'write' || current === 'read';
  }

  async function sendPasswordRecovery(email){
    if(isDemoSession()){
      return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión en el entorno real.'));
    }
    const safeEmail = sanitizeEmail(email);
    if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
    return withRateLimit(`reset:${safeEmail}`, { windowMs: 120000, max: 3 }, ()=> auth.sendPasswordResetEmail(safeEmail));
  }

  function resolveTargetUid(uid){
    if(uid){ return uid; }
    if(sessionState && sessionState.user && sessionState.user.uid){
      return sessionState.user.uid;
    }
    return null;
  }

  async function enableTwoFactor(options){
    const opts = Object.assign({ uid: null, phoneNumber: null, verificationId: null, code: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para habilitar 2FA.')); }
    if(opts.verificationId && opts.code){
      await confirmPhoneVerification(opts.verificationId, opts.code);
    }
    const payload = {
      twoFactorEnabled: true,
      twoFactorPhone: opts.phoneNumber || (sessionState && sessionState.user ? sessionState.user.phoneNumber : null) || null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.enabled', { phone: payload.twoFactorPhone }, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  async function disableTwoFactor(options){
    const opts = Object.assign({ uid: null }, options);
    if(isDemoSession()){
      return Promise.reject(new Error('La demo no admite 2FA.'));
    }
    const targetUid = resolveTargetUid(opts.uid);
    if(!targetUid){ return Promise.reject(new Error('No hay sesión activa para deshabilitar 2FA.')); }
    const payload = {
      twoFactorEnabled: false,
      twoFactorPhone: null,
      twoFactorUpdatedAt: FieldValue ? FieldValue.serverTimestamp() : Date.now()
    };
    if(db && typeof db.collection === 'function'){
      await db.collection('usuarios').doc(targetUid).set(payload, { merge: true });
    }
    logAuditEvent('auth.2fa.disabled', {}, { uid: targetUid }).catch(()=>{});
    return payload;
  }

  const sessionListeners = new Set();
  let profileUnsub = null;
  let lastAuthUser = null;

  function isDemoSession(){
    return demoMode;
  }

  function getActiveOrganizationId(){
    if(demoMode){
      const demoOrg = demoDataset && demoDataset.session && demoDataset.session.organizationId;
      return sanitizeOrganizationId(demoOrg) || 'demo';
    }
    if(sessionState && sessionState.profile && sessionState.profile.organizationId){
      return sanitizeOrganizationId(sessionState.profile.organizationId) || DEFAULT_ORG_ID;
    }
    if(sessionState && sessionState.organizationId){
      return sanitizeOrganizationId(sessionState.organizationId) || DEFAULT_ORG_ID;
    }
    return DEFAULT_ORG_ID;
  }

  function startDemoSession(payload, options){
    const opts = Object.assign({ persist: true }, options);
    const data = sanitizeDemoData(payload);
    demoMode = true;
    demoDataset = data;
    if(opts.persist !== false){
      setDemoStorage(true, data);
    }
    if(profileUnsub){
      profileUnsub();
      profileUnsub = null;
    }
    const sessionInfo = data.session || {};
    const displayName = typeof sessionInfo.displayName === 'string' && sessionInfo.displayName.trim()
      ? sessionInfo.displayName.trim()
      : 'Cuenta demo';
    const email = typeof sessionInfo.email === 'string' && sessionInfo.email.trim()
      ? sessionInfo.email.trim().toLowerCase()
      : 'demo@gestionsostenible.com';
    const phone = typeof sessionInfo.phoneNumber === 'string' ? sessionInfo.phoneNumber : '';
    const user = {
      uid: 'demo-user',
      email,
      displayName,
      photoURL: sessionInfo.photoURL || '',
      phoneNumber: phone,
      emailVerified: true,
      metadata: {
        creationTime: sessionInfo.metadata && sessionInfo.metadata.creationTime || null,
        lastSignInTime: new Date().toISOString()
      }
    };
    const demoOrganizationId = sanitizeOrganizationId(sessionInfo.organizationId) || 'demo';
    const demoOrganizationName = sanitizeOrganizationName(sessionInfo.organizationName)
      || (sessionInfo.brandName || DEFAULT_BRAND_NAME);
    const profile = {
      email,
      role: 'demo',
      responsable: sessionInfo.responsable || displayName,
      phoneNumber: phone,
      telefono: phone,
      brandName: sessionInfo.brandName || DEFAULT_BRAND_NAME,
      organizationId: demoOrganizationId,
      organizationName: demoOrganizationName,
      organization: { id: demoOrganizationId, name: demoOrganizationName, isDemo: true }
    };
    let theme = null;
    if(sessionInfo.theme){
      theme = buildTheme(sessionInfo.theme);
      if(theme){
        profile.theme = theme;
        if(theme.brandName){ profile.brandName = theme.brandName; }
      }
    }

    updateSession({
      status: 'demo',
      user,
      profile,
      role: 'demo',
      abilities: computeAbilities('demo'),
      organizationId: demoOrganizationId,
      fromCache: false
    });

    if(theme){
      updateThemeState(theme, { persist: true });
    }

    return clone(demoDataset);
  }

  function endDemoSession(options){
    const opts = Object.assign({ resetTheme: true, clearStorage: true }, options);
    demoMode = false;
    demoDataset = {};
    if(opts.clearStorage){
      setDemoStorage(false);
    }
    if(opts.resetTheme){
      updateThemeState(null, { persist: true });
    }
    updateSession({
      status: 'signed-out',
      user: null,
      profile: null,
      role: 'guest',
      abilities: computeAbilities(null),
      fromCache: false
    });
  }

  function getDemoDataSnapshot(key){
    if(!demoMode){ return key ? null : {}; }
    if(!key){ return clone(demoDataset); }
    const value = demoDataset ? demoDataset[key] : undefined;
    return clone(value);
  }

  function syncThemeWithSessionState(){
    if(sessionState && sessionState.profile && sessionState.profile.theme){
      updateThemeState(sessionState.profile.theme, { persist: true });
    }else if(sessionState && sessionState.status === 'authenticated'){
      updateThemeState(null, { persist: true });
    }
  }

  function persistSession(){
    if(!localStore) return;
    try{
      if(sessionState.status === 'authenticated' && sessionState.user){
        const envelope = {
          user: sessionState.user,
          profile: sessionState.profile,
          role: sessionState.role,
          abilities: sessionState.abilities,
          organizationId: sessionState.organizationId,
          timestamp: Date.now()
        };
        const encrypted = encryptLocalPayload(envelope);
        localStore.setItem(SESSION_STORAGE_KEY, encrypted ? JSON.stringify({ secure: true, payload: encrypted }) : JSON.stringify(envelope));
      }else{
        localStore.removeItem(SESSION_STORAGE_KEY);
      }
    }catch(err){ /* almacenamiento no disponible */ }
  }

  function getSessionSnapshot(){
    return {
      status: sessionState.status,
      user: clone(sessionState.user),
      profile: clone(sessionState.profile),
      role: sessionState.role,
      abilities: clone(sessionState.abilities),
      fromCache: !!sessionState.fromCache
    };
  }

  function emitSession(){
    const snapshot = getSessionSnapshot();
    sessionListeners.forEach((listener)=>{
      try{ listener(snapshot); }
      catch(err){ console.error('gsAuth listener error', err); }
    });
  }

  function updateSession(patch){
    sessionState = Object.assign({}, sessionState, patch);
    if(sessionState && sessionState.profile){
      const orgMeta = sessionState.profile.organization || organizationCache.get(sessionState.profile.organizationId);
      applyOrganizationToProfile(sessionState.profile, orgMeta);
      sessionState.organizationId = sessionState.profile.organizationId || DEFAULT_ORG_ID;
    }else{
      sessionState.organizationId = DEFAULT_ORG_ID;
    }
    syncThemeWithSessionState();
    persistSession();
    emitSession();
  }

  function hydrateDemoSession(){
    if(demoMode){ return; }
    const stored = readDemoStorage();
    if(!stored){ return; }
    try{
      startDemoSession(stored, { persist: false, resetTheme: false });
    }catch(err){
      setDemoStorage(false);
    }
  }

  function hydrateCachedSession(){
    if(!localStore) return;
    try{
      const raw = localStore.getItem(SESSION_STORAGE_KEY);
      if(!raw) return;
      const cached = JSON.parse(raw);
      const resolvedRole = normalizeRole(cached.role, cached.user);
      sessionState = Object.assign({}, sessionState, {
        status: 'restoring',
        user: cached.user || null,
        profile: cached.profile || null,
        role: resolvedRole,
        abilities: computeAbilities(resolvedRole),
        organizationId: sanitizeOrganizationId(cached.organizationId) || (cached.profile && cached.profile.organizationId) || DEFAULT_ORG_ID,
        fromCache: true
      });
      if(sessionState.profile){
        applyOrganizationToProfile(sessionState.profile, sessionState.profile.organization);
        sessionState.organizationId = sessionState.profile.organizationId || sessionState.organizationId;
      }
      syncThemeWithSessionState();
      emitSession();
    }catch(err){ /* sin sesión previa */ }
  }

  hydrateDemoSession();
  hydrateCachedSession();

  function ensureOverlay(message, options){
    const opts = options && typeof options === 'object' ? options : {};
    let overlay = document.getElementById('gs-auth-required');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.id = 'gs-auth-required';
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'text-align:center',
        'padding:32px',
        'z-index:9999',
        'font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,sans-serif'
      ].join(';');
      overlay.setAttribute('role', 'alert');
      overlay.setAttribute('aria-live', 'assertive');
      overlay.setAttribute('aria-modal', 'true');
      overlay.tabIndex = -1;

      overlay.innerHTML = '<div style="max-width:520px">\n        <h2 id="gs-auth-required-title" style="margin:0 0 12px;font-size:26px"></h2>\n        <p id="gs-auth-required-message" style="margin:0;font-size:17px;line-height:1.5"></p>\n        <p id="gs-auth-required-helper" style="margin-top:18px;font-size:15px"></p>\n      </div>';
      overlay.setAttribute('aria-labelledby', 'gs-auth-required-title');
      overlay.setAttribute('aria-describedby', 'gs-auth-required-message');
      document.body.appendChild(overlay);
      setTimeout(()=>overlay.focus(), 0);
    }
    // Mantener el overlay alineado con la marca y la paleta activa.
    const theme = typeof getThemeSnapshot === 'function' ? getThemeSnapshot() : null;
    const palette = theme && theme.palette ? theme.palette : null;
    const brandName = theme && theme.brandName ? theme.brandName : DEFAULT_BRAND_NAME;
    const overlayColor = palette && palette.overlay ? palette.overlay : 'rgba(15,51,70,.94)';
    const textColor = palette && palette.navContrast ? palette.navContrast : '#fff';
    const accentColor = palette && palette.accent ? palette.accent : null;
    const embedded = typeof global !== 'undefined' ? global.self !== global.top : false;
    const isDenied = opts.variant === 'denied';
    const overlayMessage = (!isDenied && embedded)
      ? `${brandName ? brandName + ' · ' : ''}Cargando sesión…`
      : (message || (!isDenied ? (brandName ? `Ingresá en ${brandName}` : 'Necesitás iniciar sesión') : ''));
    overlay.style.background = overlayColor;
    overlay.style.color = textColor;
    overlay.setAttribute('data-variant', opts.variant || 'signin');

    const titleEl = overlay.querySelector('#gs-auth-required-title');
    if(titleEl){
      if(isDenied){
        titleEl.textContent = 'Acceso restringido';
      }else{
        titleEl.textContent = brandName || DEFAULT_BRAND_NAME;
      }
      titleEl.style.color = accentColor || textColor;
    }

    const paragraph = overlay.querySelector('#gs-auth-required-message');
    if(paragraph){
      paragraph.textContent = overlayMessage || '';
    }

    const helper = overlay.querySelector('#gs-auth-required-helper');
    if(helper){
      if(isDenied){
        helper.textContent = 'Contactá a un administrador para solicitar acceso.';
      }else if(embedded){
        helper.textContent = '';
      }else{
        helper.textContent = brandName
          ? `Volvé a la pestaña principal de ${brandName} y completá el formulario de inicio de sesión.`
          : 'Volvé a la pestaña principal y completá el formulario de inicio de sesión.';
      }
      helper.style.color = textColor;
    }

    return overlay;
  }

  function hideOverlay(){
    const overlay = document.getElementById('gs-auth-required');
    if(overlay){
      overlay.remove();
    }
  }

  function attachProfileListener(user){
    if(profileUnsub){
      profileUnsub();
      profileUnsub = null;
    }

    if(!user){
      updateSession({
        status: 'signed-out',
        user: null,
        profile: null,
        role: 'guest',
        abilities: computeAbilities(null),
        fromCache: false
      });
      return;
    }

    const safeUser = safeUserSnapshot(user);

    if(!db){
      updateSession({
        status: 'authenticated',
        user: safeUser,
        profile: null,
        role: DEFAULT_ROLE,
        abilities: computeAbilities(DEFAULT_ROLE),
        fromCache: false
      });
      return;
    }

    const docRef = db.collection('usuarios').doc(user.uid);
    let touched = false;

    profileUnsub = docRef.onSnapshot(async (doc)=>{
      let profile = doc.exists ? doc.data() : null;
      if(!profile){
        profile = {
          email: user.email || '',
          role: DEFAULT_ROLE,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        try{
          await docRef.set(profile, { merge: true });
        }catch(err){
          console.warn('No se pudo inicializar el perfil de usuario', err);
        }
      }

      if(profile.theme){
        const normalizedTheme = sanitizeTheme(profile.theme);
        if(normalizedTheme){
          profile.theme = normalizedTheme;
        }else{
          delete profile.theme;
        }
      }

      if(!profile.organizationId){
        profile.organizationId = DEFAULT_ORG_ID;
        try{ await docRef.set({ organizationId: DEFAULT_ORG_ID }, { merge: true }); }
        catch(err){ console.warn('No se pudo asignar organización por defecto', err); }
      }

      let organizationMeta = null;
      try{
        organizationMeta = await fetchOrganizationMeta(profile.organizationId);
      }catch(err){
        console.warn('No se pudo obtener la organización del perfil', err);
      }
      applyOrganizationToProfile(profile, organizationMeta);

      const role = normalizeRole(profile.role, safeUser);

      updateSession({
        status: 'authenticated',
        user: safeUser,
        profile: Object.assign({}, profile, { id: docRef.id }),
        role,
        abilities: computeAbilities(role),
        fromCache: false
      });

      if(!touched && FieldValue){
        touched = true;
        try{
          docRef.set({
            lastAccessAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            email: user.email || ''
          }, { merge: true });
        }catch(err){
          console.warn('No se pudo registrar el último acceso', err);
        }
      }
    }, (error)=>{
      console.error('Error obteniendo perfil del usuario', error);
      updateSession({
        status: 'authenticated',
        user: safeUser,
        profile: null,
        role: DEFAULT_ROLE,
        abilities: computeAbilities(DEFAULT_ROLE),
        fromCache: false
      });
    });
  }

  auth.onAuthStateChanged((user)=>{
    if(isDemoSession()){
      return;
    }
    if(!user){
      const previous = lastAuthUser;
      if(profileUnsub){
        profileUnsub();
        profileUnsub = null;
      }
      if(previous && previous.uid){
        logAuditEvent('session.logout', {
          reason: 'sign-out'
        }, { uid: previous.uid, email: previous.email || null, displayName: previous.displayName || null, actor: previous }).catch(()=>{});
      }
      recaptchaCache.forEach((verifier)=>{
        if(verifier && typeof verifier.clear === 'function'){
          try{ verifier.clear(); }
          catch(err){ /* ignorar */ }
        }
      });
      recaptchaCache.clear();
      lastAuthUser = null;
      if(idleTimeoutHandle){
        clearTimeout(idleTimeoutHandle);
      }
      updateSession({
        status: 'signed-out',
        user: null,
        profile: null,
        role: 'guest',
        abilities: computeAbilities(null),
        fromCache: false
      });
    }else{
      const safeUser = safeUserSnapshot(user);
      bindIdleEvents();
      resetIdleTimer();
      if(!lastAuthUser || lastAuthUser.uid !== safeUser.uid){
        let provider = 'password';
        if(Array.isArray(user.providerData) && user.providerData.length){
          provider = user.providerData[0] && user.providerData[0].providerId
            ? user.providerData[0].providerId
            : provider;
        }
        logAuditEvent('session.login', { provider }, {
          uid: safeUser.uid,
          email: safeUser.email || null,
          displayName: safeUser.displayName || null,
          actor: safeUser
        }).catch(()=>{});
      }
      lastAuthUser = safeUser;
      attachProfileListener(user);
    }
  });

  const gsAuth = {
    signInWithEmailAndPassword: (email, password) => {
      if(isDemoSession()){
        return Promise.reject(new Error('La demo es de solo lectura. Iniciá sesión desde la versión completa.'));
      }
      const safeEmail = sanitizeEmail(email);
      const safePassword = typeof password === 'string' ? password.trim() : '';
      if(!safeEmail){ return Promise.reject(new Error('Ingresá un correo válido.')); }
      if(!safePassword){ return Promise.reject(new Error('Ingresá tu contraseña.')); }
      return withRateLimit('login', { windowMs: 120000, max: 8 }, ()=>
        auth.signInWithEmailAndPassword(safeEmail, safePassword).catch(err=>{
          const friendly = describeAuthError(err);
          const wrapped = new Error(friendly);
          wrapped.code = err?.code || '';
          wrapped.original = err;
          return Promise.reject(wrapped);
        })
      );
    },
    sanitizeInput: (value)=> sanitizeInputValue(value),
    sanitizePayload: (obj)=> sanitizeObjectPayload(obj),
    hardenForm: (form)=> { hardenFormSecurity(form); return form; },
    ensureCsrfToken: ()=> ensureCsrfToken(),
    validateIdToken: (token)=> validateIdTokenClaims(token),
    signOut: () => {
      if(isDemoSession()){
        endDemoSession();
        return Promise.resolve();
      }
      return auth.signOut();
    },
    setIdleTimeout: (ms)=> setIdleTimeoutMs(ms),
    getIdleTimeout: ()=> getIdleTimeoutMs(),
    resetIdleTimer: ()=> resetIdleTimer(),
    onAuthStateChanged: (callback) => auth.onAuthStateChanged(callback),
    onSession: (callback)=>{
      if(typeof callback !== 'function'){ return ()=>{}; }
      sessionListeners.add(callback);
      try{ callback(getSessionSnapshot()); }
      catch(err){ console.error('gsAuth listener error', err); }
      return ()=> sessionListeners.delete(callback);
    },
    getSession: ()=> getSessionSnapshot(),
    getCachedSession: ()=>{
      if(!localStore) return null;
      try{
        const raw = localStore.getItem(SESSION_STORAGE_KEY);
        if(!raw){ return null; }
        const parsed = JSON.parse(raw);
        if(parsed && parsed.secure && parsed.payload){
          const decrypted = decryptLocalPayload(parsed.payload);
          return decrypted || null;
        }
        return parsed;
      }catch(err){
        return null;
      }
    },
    getAuth: () => auth,
    getApp: () => firebase.app(),
    describeError: (err, options)=> describeAuthError(err, options),
    config: firebaseConfig,
    can: (ability)=> !!(sessionState.abilities && sessionState.abilities[ability]),
    getPermissions: ()=> clone(sessionState.abilities),
    getOrganizationId: ()=> getActiveOrganizationId(),
    getOrganization: ()=> clone(sessionState && sessionState.profile && sessionState.profile.organization ? sessionState.profile.organization : null),
    listOrganizations: (options)=> listOrganizations(options),
    ensureOrganization: (options)=>{
      if(isDemoSession()){ return Promise.reject(new Error('La demo es de solo lectura.')); }
      return ensureOrganization(options || {});
    },
    roles: Object.keys(ROLE_MATRIX),
    roleLabels: {
      admin: 'Administrador',
      manager: 'Manager',
      operator: 'Operador',
      viewer: 'Lector',
      control: 'Control',
      guest: 'Invitado',
      demo: 'Demo'
    },
    roleOverrides: Object.assign({}, EMAIL_ROLE_OVERRIDES),
    ROLE_MATRIX: clone(ROLE_MATRIX),
    hasModulePermission: (moduleKey, level)=> hasModulePermission(moduleKey, level),
    getModulePermissions: ()=> clone((sessionState && sessionState.abilities && sessionState.abilities.modulePermissions) || DEFAULT_MODULE_PERMISSIONS),
    normalizeRole,
    logEvent: (eventName, metadata, overrides)=> logAuditEvent(eventName, metadata, overrides),
    fetchAuditLog: (options)=> fetchAuditLog(options),
    subscribeAuditLog: (options, callback)=> subscribeAuditLog(options, callback),
    enableTwoFactor: (opts)=> enableTwoFactor(opts),
    disableTwoFactor: (opts)=> disableTwoFactor(opts),
    adminCreateUser,
    adminDeleteUser,
    updatePassword: (currentPassword, newPassword)=>{
      if(isDemoSession()){
        return Promise.reject(new Error('La demo es de solo lectura.'));
      }
      return updateOwnPassword(currentPassword, newPassword);
    },
    updateProfile: (updates)=>{
      if(isDemoSession()){
        return Promise.reject(new Error('La demo es de solo lectura.'));
      }
      return updateOwnProfile(updates);
    },
    saveTheme: (theme)=>{
      if(isDemoSession()){
        return Promise.reject(new Error('La demo no permite guardar temas.'));
      }
      return saveTheme(theme);
    },
    resetTheme: ()=>{
      if(isDemoSession()){
        return Promise.reject(new Error('La demo es de solo lectura.'));
      }
      return resetTheme();
    },
    getTheme: ()=> getThemeSnapshot(),
    onTheme: (callback)=> subscribeTheme(callback),
    previewTheme: (theme)=> previewTheme(theme),
    startPhoneVerification: (phone, options)=> startPhoneVerification(phone, options),
    confirmPhoneVerification: (verificationId, code)=> confirmPhoneVerification(verificationId, code),
    importClients: (records, options)=>{
      if(isDemoSession()){
        return Promise.reject(new Error('La demo no admite importaciones.'));
      }
      return importClients(records, options);
    },
    isDemoSession,
    getDemoData: (key)=> getDemoDataSnapshot(key),
    startDemoSession: (data)=> startDemoSession(data),
    endDemoSession: (options)=>{ endDemoSession(options); }
  };

  function requireLogin(options){
    const opts = Object.assign({
      message: 'Iniciá sesión desde la pantalla principal para acceder a este módulo.',
      deniedMessage: 'Tu cuenta no tiene permisos suficientes para usar este módulo.',
      onlyEmbedded: true,
      allowedRoles: null,
      redirectTo: 'index.html',
      redirectDelay: 80,
      onStateChange: null
    }, options);

    const allowedRoles = Array.isArray(opts.allowedRoles) && opts.allowedRoles.length
      ? opts.allowedRoles.map(normalizeRole)
      : null;
    const body = document && document.body ? document.body : null;
    if(body){
      body.setAttribute('data-gs-session-state', 'checking');
    }

    const unsubscribe = gsAuth.onSession((session)=>{
      ready(()=>{
        const user = session && session.user;
        const role = normalizeRole(session && session.role, session && session.user);
        const status = session ? session.status : 'signed-out';
        const inSession = !!user && (status === 'authenticated' || status === 'demo');
        const shouldOverlay = opts.onlyEmbedded ? global.self !== global.top : true;
        const roleAllowed = !allowedRoles || allowedRoles.includes(role);
        const deniedMessage = typeof opts.deniedMessage === 'function'
          ? opts.deniedMessage(role, session)
          : opts.deniedMessage;
        const shouldRedirect = opts.redirectTo && (!opts.onlyEmbedded || global.self === global.top);
        const sessionState = inSession
          ? (roleAllowed ? 'allowed' : 'denied')
          : 'signed-out';

        if(body){
          if(inSession){
            body.classList.add('gs-authenticated');
            body.setAttribute('data-gs-role', role);
          }else{
            body.classList.remove('gs-authenticated');
            body.removeAttribute('data-gs-role');
          }
          body.setAttribute('data-gs-session-state', sessionState);
        }

        if(inSession && roleAllowed){
          hideOverlay();
        }else if(inSession && !roleAllowed){
          if(shouldOverlay){
            ensureOverlay(deniedMessage, { variant: 'denied', session, role });
          }else{
            hideOverlay();
          }
        }else{
          if(shouldRedirect){
            setTimeout(()=>{
              try{
                if(global.location && typeof global.location.replace === 'function'){
                  global.location.replace(opts.redirectTo);
                }else{
                  global.location.href = opts.redirectTo;
                }
              }catch(err){
                try{ global.location.href = opts.redirectTo; }
                catch(_){ /* noop */ }
              }
            }, Math.max(0, Number(opts.redirectDelay) || 0));
          }
          if(shouldOverlay){
            ensureOverlay(opts.message, { variant: 'signin', session: null });
          }else{
            hideOverlay();
          }
        }

        // Compartir el estado del guard con cualquier listener embebido.
        const detail = {
          session,
          role,
          allowed: inSession && roleAllowed,
          denied: inSession && !roleAllowed,
          status: sessionState,
          message: inSession && roleAllowed ? null : (inSession ? deniedMessage : opts.message),
          overlayVisible: shouldOverlay && (!inSession || !roleAllowed),
          redirectTo: !inSession && shouldRedirect ? opts.redirectTo : null
        };

        if(typeof opts.onStateChange === 'function'){
          try{ opts.onStateChange(detail); }
          catch(err){ console.error('requireLogin onStateChange error', err); }
        }

        try{
          document.dispatchEvent(new CustomEvent('gs:auth:guard-state', { detail }));
        }catch(eventErr){
          console.warn('No se pudo despachar el estado de requireLogin', eventErr);
        }
      });
    });

    return unsubscribe;
  }

  global.gsAuth = gsAuth;
  global.requireLogin = requireLogin;

})(window);
