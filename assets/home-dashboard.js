(function(global){
  'use strict';

  const state = {
    period: 'today',
    charts: {},
    metrics: null,
    predictions: null,
    pendingActions: new Map()
  };

  const selectors = {
    periodButtons: '#periodSelector .period-btn',
    kpiCards: '.kpi-card',
    predictionsGrid: '#predictionsGrid',
    recommendations: '#recommendationsList',
    aiStatus: '#aiStatus',
    drilldown: '#drilldownModal',
    drilldownTitle: '#drilldownTitle',
    drilldownBody: '#drilldownBody',
    drilldownClose: '#drilldownClose'
  };

  function q(sel){ return document.querySelector(sel); }
  function qa(sel){ return Array.from(document.querySelectorAll(sel)); }

  function getDb(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore() : null; }
  function getDemo(){ return global.GS_DEMO_DATA || global.demoData || {}; }

  function currency(value){
    if(value === null || value === undefined || Number.isNaN(Number(value))){ return '—'; }
    try{ return new Intl.NumberFormat('es-UY', { style:'currency', currency:'UYU', maximumFractionDigits:0 }).format(value); }
    catch(err){ return `$${Math.round(value)}`; }
  }

  function percent(value){
    if(value === null || value === undefined || Number.isNaN(Number(value))){ return '—'; }
    return `${(Number(value)).toFixed(1)}%`;
  }

  async function fetchMetrics(){
    const demo = getDemo();
    const defaults = {
      period: state.period,
      retiros: { value: 0, change: 0, series: [2,3,4,3,5,4,6] },
      ingresos: { value: 0, change: 0, series: [1000,1400,1200,1500,1800,1750,1900] },
      eficiencia: { value: 0, change: 0, series: [82,84,80,86,88,89,90] },
      clientesActivos: 0,
      ultimasFechas: []
    };
    const db = getDb();
    if(!db){
      const sample = demo.analytics || {};
      return Object.assign({}, defaults, sample);
    }
    try{
      const [clientesSnap, retirosSnap, pagosSnap] = await Promise.all([
        db.collection('clientes').limit(100).get(),
        db.collection('retiros').orderBy('fecha', 'desc').limit(14).get().catch(()=> db.collection('retiros').limit(14).get()),
        db.collection('finanzas').orderBy('fecha', 'desc').limit(30).get().catch(()=> db.collection('finanzas').limit(30).get())
      ]);
      const clientesActivos = clientesSnap ? clientesSnap.size : 0;
      const retirosCount = retirosSnap ? retirosSnap.size : 0;
      const ingresosTotales = pagosSnap ? pagosSnap.docs.reduce((acc,doc)=>{ const v = doc.data().monto || doc.data().valor || 0; return acc + Number(v||0); },0) : 0;
      const seriesRetiros = retirosSnap ? retirosSnap.docs.map((doc)=> doc.data().volumen || 1) : defaults.retiros.series;
      const seriesIngresos = pagosSnap ? pagosSnap.docs.map((doc)=> Number(doc.data().monto || doc.data().valor || 0)) : defaults.ingresos.series;
      const efficiencyBase = clientesActivos ? Math.min(95, 70 + (retirosCount/Math.max(clientesActivos,1))*25) : 86;
      return {
        period: state.period,
        retiros: { value: retirosCount, change: computeChange(seriesRetiros), series: normalizeSeries(seriesRetiros, 12) },
        ingresos: { value: ingresosTotales, change: computeChange(seriesIngresos), series: normalizeSeries(seriesIngresos, 12) },
        eficiencia: { value: efficiencyBase, change: +(Math.random()*3).toFixed(1), series: normalizeSeries([efficiencyBase-4,efficiencyBase-2, efficiencyBase-1, efficiencyBase, efficiencyBase+1], 8) },
        clientesActivos,
        ultimasFechas: retirosSnap ? retirosSnap.docs.map((doc)=> doc.data().fecha || doc.id) : []
      };
    }catch(err){
      console.warn('Fallo al cargar métricas, usando demo', err);
      const sample = demo.analytics || {};
      return Object.assign({}, defaults, sample);
    }
  }

  function normalizeSeries(series, target){
    const arr = Array.isArray(series) ? series.filter((n)=> Number.isFinite(Number(n))).map(Number) : [];
    if(!arr.length){ return new Array(target || 8).fill(0); }
    if(arr.length >= target){ return arr.slice(-target); }
    const padded = arr.slice();
    while(padded.length < (target || 8)){ padded.unshift(arr[0]); }
    return padded;
  }

  function computeChange(series){
    const arr = normalizeSeries(series, 4);
    const last = arr[arr.length-1];
    const prev = arr[arr.length-2] || last;
    if(!prev){ return 0; }
    return +(((last - prev)/Math.max(prev,1))*100).toFixed(1);
  }

  function ensureChart(id, label, data, color){
    if(!global.Chart){ return; }
    const ctx = q(`#${id}`);
    if(!ctx){ return; }
    const palette = resolvePalette();
    const chartColor = color || palette.accent;
    if(state.charts[id]){ state.charts[id].destroy(); }
    state.charts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((_,i)=> `D${i+1}`),
        datasets: [{
          label,
          data,
          fill: false,
          borderColor: chartColor,
          backgroundColor: chartColor,
          tension: 0.35,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { display:false },
          y: { display:false }
        },
        plugins: { legend: { display:false }, tooltip: { enabled:false } }
      }
    });
  }

  function resolvePalette(){
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--accent').trim() || '#1DBF73',
      muted: styles.getPropertyValue('--muted').trim() || '#6b7c8a'
    };
  }

  function updateKpiCards(metrics){
    const retirosValue = q('#retirosValue');
    const ingresosValue = q('#ingresosValue');
    const eficienciaValue = q('#eficienciaValue');
    if(retirosValue){ retirosValue.textContent = metrics.retiros.value || 0; }
    if(ingresosValue){ ingresosValue.textContent = currency(metrics.ingresos.value); }
    if(eficienciaValue){ eficienciaValue.textContent = percent(metrics.eficiencia.value); }
    const retirosChange = q('#retirosChangeValue');
    const ingresosChange = q('#ingresosChangeValue');
    const eficienciaChange = q('#eficienciaChangeValue');
    if(retirosChange){ retirosChange.textContent = percent(metrics.retiros.change); }
    if(ingresosChange){ ingresosChange.textContent = percent(metrics.ingresos.change); }
    if(eficienciaChange){ eficienciaChange.textContent = percent(metrics.eficiencia.change); }
    ensureChart('retirosChart', 'Retiros', metrics.retiros.series, '#1DBF73');
    ensureChart('ingresosChart', 'Ingresos', metrics.ingresos.series, '#0f3346');
    ensureChart('eficienciaChart', 'Eficiencia', metrics.eficiencia.series, '#16a062');
  }

  function computePredictions(metrics){
    const base = metrics || state.metrics || {};
    return {
      retiros: {
        value: Math.round((base.retiros?.value || 0) * 1.15),
        confidence: 0.82
      },
      ingresos: {
        value: Math.round((base.ingresos?.value || 0) * 1.12),
        confidence: 0.79
      },
      eficiencia: {
        value: Math.min(98, Math.round((base.eficiencia?.value || 85) + 2)),
        confidence: 0.76
      }
    };
  }

  function renderPredictions(preds){
    const grid = q(selectors.predictionsGrid);
    if(!grid){ return; }
    grid.querySelectorAll('.prediction-item').forEach((item)=>{
      const key = item.dataset.prediction;
      const data = preds[key] || {};
      const valueEl = item.querySelector('.prediction-value');
      const confEl = item.querySelector('.prediction-confidence');
      if(valueEl){ valueEl.textContent = key === 'ingresos' ? currency(data.value) : `${data.value || 0}`; }
      if(confEl){ confEl.textContent = `Confianza: ${percent((data.confidence||0)*100)}`; }
    });
    const status = q(selectors.aiStatus);
    if(status){ status.querySelector('.status-dot')?.classList.add('active'); }
  }

  const recommendationCopy = {
    optimize_routes: {
      title: 'Optimizar rutas',
      description: 'Redistribuimos volumen entre choferes para reducir 8-12% los tiempos.',
      module: 'rutas'
    },
    adjust_schedule: {
      title: 'Ajustar horarios',
      description: 'Ventanas preferidas 8-10 AM en zona Sur. Menos cancelaciones.',
      module: 'rutas'
    },
    maintenance: {
      title: 'Mantenimiento preventivo',
      description: 'Programá mantenimiento en unidades con desvíos de consumo.',
      module: 'configuracion'
    }
  };

  function implementRecommendation(key){
    const rec = recommendationCopy[key];
    if(rec){ openModuleAndSendAction(rec.module, { type:'gs-action', action:`rec:${key}` }); }
    openDrilldown({ title: rec ? rec.title : 'Recomendación', body: rec ? rec.description : 'Aplicado.' });
  }

  function viewRecommendationDetails(key){
    const rec = recommendationCopy[key];
    openDrilldown({ title: rec ? rec.title : 'Detalle', body: rec ? rec.description : 'Sin detalles adicionales.' });
  }

  function openDrilldown({ title, body }){
    const modal = q(selectors.drilldown);
    if(!modal){ return; }
    const titleEl = q(selectors.drilldownTitle);
    const bodyEl = q(selectors.drilldownBody);
    if(titleEl){ titleEl.textContent = title || 'Detalle'; }
    if(bodyEl){ bodyEl.textContent = body || ''; }
    modal.classList.remove('hidden');
  }

  function closeDrilldown(){
    const modal = q(selectors.drilldown);
    if(modal){ modal.classList.add('hidden'); }
  }

  function setupDrilldownModal(){
    const closeBtn = q(selectors.drilldownClose);
    if(closeBtn){ closeBtn.addEventListener('click', closeDrilldown); }
    document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape'){ closeDrilldown(); } });
  }

  function attachPeriodSelector(){
    qa(selectors.periodButtons).forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        qa(selectors.periodButtons).forEach((b)=> b.classList.toggle('active', b === btn));
        state.period = btn.dataset.period || 'today';
        refreshMetrics();
      });
    });
  }

  function attachKpiNavigation(){
    qa(selectors.kpiCards).forEach((card)=>{
      card.addEventListener('click', ()=>{
        const moduleKey = card.dataset.module?.replace('.html','') || card.dataset.kpi;
        openModuleAndSendAction(moduleKey);
      });
    });
  }

  function refreshMetrics(){
    fetchMetrics().then((metrics)=>{
      state.metrics = metrics;
      updateKpiCards(metrics);
      state.predictions = computePredictions(metrics);
      renderPredictions(state.predictions);
    });
  }

  function onThemeUpdate(){
    if(state.metrics){ updateKpiCards(state.metrics); }
  }

  function openModuleAndSendAction(moduleKey, message){
    const route = findRouteByModule(moduleKey);
    if(route && global.gsRouter){ global.gsRouter.navigateTo(route.key); }
    const frame = document.querySelector(`#viewer iframe[data-module-key="${moduleKey}"]`);
    if(frame && message){
      try{ frame.contentWindow.postMessage(message, '*'); }
      catch(err){ state.pendingActions.set(moduleKey, message); }
    }else if(message){
      state.pendingActions.set(moduleKey, message);
    }
  }

  function findRouteByModule(moduleKey){
    const routes = global.gsConfig && global.gsConfig.ROUTES ? Object.values(global.gsConfig.ROUTES) : [];
    return routes.find((r)=> r.moduleKey === moduleKey || r.page === `${moduleKey}.html`);
  }

  function flushPending(frame){
    if(!frame || !frame.dataset.moduleKey){ return; }
    const moduleKey = frame.dataset.moduleKey;
    if(!state.pendingActions.has(moduleKey)){ return; }
    const message = state.pendingActions.get(moduleKey);
    try{ frame.contentWindow.postMessage(message, '*'); }
    catch(err){ return; }
    state.pendingActions.delete(moduleKey);
  }

  function setupFrameBridge(){
    const viewer = q('#viewer');
    if(!viewer){ return; }
    viewer.addEventListener('load', (event)=>{
      const frame = event.target;
      if(frame && frame.tagName === 'IFRAME'){ flushPending(frame); }
    }, true);
  }

  function downloadKPIReport(metricKey){
    const metrics = state.metrics || {};
    const preds = state.predictions || computePredictions(metrics);
    const win = window.open('', '_blank');
    if(!win){ return; }
    win.document.write(`<!doctype html><html><head><title>Reporte ${metricKey}</title></head><body style="font-family:Arial,sans-serif;padding:20px;">`);
    win.document.write(`<h1>Reporte de ${metricKey}</h1>`);
    win.document.write(`<p>Periodo: ${state.period}</p>`);
    win.document.write('<h2>Métricas actuales</h2>');
    win.document.write('<ul>');
    win.document.write(`<li>Retiros: ${metrics.retiros?.value || 0}</li>`);
    win.document.write(`<li>Ingresos: ${currency(metrics.ingresos?.value)}</li>`);
    win.document.write(`<li>Eficiencia: ${percent(metrics.eficiencia?.value)}</li>`);
    win.document.write('</ul>');
    win.document.write('<h2>Predicciones IA</h2>');
    win.document.write('<ul>');
    win.document.write(`<li>Retiros proyectados: ${preds.retiros?.value || 0}</li>`);
    win.document.write(`<li>Ingresos proyectados: ${currency(preds.ingresos?.value)}</li>`);
    win.document.write(`<li>Eficiencia esperada: ${percent(preds.eficiencia?.value)}</li>`);
    win.document.write('</ul>');
    win.document.write('<p style="margin-top:20px;">Generado automáticamente por Gestión Sostenible.</p>');
    win.document.write('</body></html>');
    win.document.close();
    win.focus();
    setTimeout(()=> win.print(), 400);
  }

  function bootstrapHome(){
    attachPeriodSelector();
    attachKpiNavigation();
    setupFrameBridge();
    setupDrilldownModal();
    refreshMetrics();
    setInterval(refreshMetrics, 60 * 1000);
    if(global.gsTheme){
      document.addEventListener(global.gsTheme.THEME_EVENT, onThemeUpdate);
    }
    if(global.gsSession && global.gsSession.SESSION_EVENT){
      document.addEventListener(global.gsSession.SESSION_EVENT, ()=> refreshMetrics());
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrapHome);

  global.openModuleAndSendAction = openModuleAndSendAction;
  global.downloadKPIReport = downloadKPIReport;
  global.implementRecommendation = implementRecommendation;
  global.viewRecommendationDetails = viewRecommendationDetails;
  global.setupDrilldownModal = setupDrilldownModal;
})(window);
