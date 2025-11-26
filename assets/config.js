(function(global){
  'use strict';

  const DEFAULT_MODULE_LABELS = Object.freeze({
    home: 'Inicio',
    clientes: 'Clientes',
    rutas: 'Calendario / Rutas',
    finanzas: 'Finanzas y DGI',
    temas: 'Temas',
    usuarios: 'Gestión de Cuentas',
    configuracion: 'Configuración'
  });

  const ROUTES = Object.freeze({
    '/': {
      key: '/',
      moduleKey: 'home',
      label: DEFAULT_MODULE_LABELS.home,
      subtitle: 'Resumen ejecutivo de tus indicadores clave.',
      page: null
    },
    '/clientes': {
      key: '/clientes',
      moduleKey: 'clientes',
      label: DEFAULT_MODULE_LABELS.clientes,
      page: 'clientes-firestore.html'
    },
    '/retiros': {
      key: '/retiros',
      moduleKey: 'rutas',
      label: DEFAULT_MODULE_LABELS.rutas,
      page: 'retiros.html'
    },
    '/finanzas': {
      key: '/finanzas',
      moduleKey: 'finanzas',
      label: DEFAULT_MODULE_LABELS.finanzas,
      page: 'finanzas.html'
    },
    '/usuarios': {
      key: '/usuarios',
      moduleKey: 'usuarios',
      label: DEFAULT_MODULE_LABELS.usuarios,
      page: 'usuarios.html',
      permission: 'manageUsers',
      subtitle: 'Creá, desactivá y auditá cuentas corporativas.'
    },
    '/configuracion': {
      key: '/configuracion',
      moduleKey: 'configuracion',
      label: DEFAULT_MODULE_LABELS.configuracion,
      page: 'configuracion.html',
      subtitle: 'Actualizá tus datos de acceso y personalizá la experiencia.'
    },
    '/temas': {
      key: '/temas',
      moduleKey: 'temas',
      label: DEFAULT_MODULE_LABELS.temas,
      page: 'temas.html',
      permission: 'manageTheme',
      subtitle: 'Personalizá colores, logotipo y branding.'
    }
  });

  const SELECTORS = Object.freeze({
    loginView: '#loginView',
    appView: '#appView',
    homeView: '#homeView',
    viewer: '#viewer',
    sideNav: '#sideNav',
    navToggle: '#navToggle',
    navBackdrop: '#navBackdrop',
    viewerLoading: '#viewerLoading',
    viewerLoadingTitle: '#viewerLoadingTitle',
    viewerLoadingText: '#viewerLoadingText',
    viewerError: '#viewerError',
    viewerErrorTitle: '#viewerErrorTitle',
    viewerErrorText: '#viewerErrorText',
    viewerErrorRetry: '#viewerErrorRetry',
    viewerErrorHome: '#viewerErrorHome',
    pageTitle: '#pageTitle',
    pageSubtitle: '#pageSubtitle',
    sessionChip: '#sessionChip',
    sessionRole: '#sessionRole',
    sessionEmail: '#sessionEmail',
    loginForm: '#loginForm',
    emailInput: '#email',
    passInput: '#pass',
    btnLogin: '#btnLogin',
    loginMsg: '#loginMsg',
    btnLogout: '#btnLogout',
    landingShell: '#landingShell',
    loginPanel: '#loginPanel',
    focusLoginBtns: '[data-action="focus-login"]',
    frameLinks: '#sideNav a[data-page]',
    permLinks: '#sideNav a[data-permission]'
  });

  const STORAGE_KEYS = Object.freeze({
    lastRoute: 'gs:lastRoute'
  });

  global.gsConfig = Object.freeze({ ROUTES, SELECTORS, STORAGE_KEYS, DEFAULT_MODULE_LABELS });
})(window);
