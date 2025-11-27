(function(global){
  'use strict';

  const state = {
    period: 'today',
    charts: {},
    metrics: null,
    predictions: null,
    aiDataset: null,
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

  function setAiStatus(text, active=true){
    const status = q(selectors.aiStatus);
    if(!status){ return; }
    const dot = status.querySelector('.status-dot');
    if(dot){ dot.classList.toggle('active', !!active); }
    const label = status.querySelector('span:last-child');
    if(label && text){ label.textContent = text; }
  }

  function q(sel){ return document.querySelector(sel); }
  function qa(sel){ return Array.from(document.querySelectorAll(sel)); }

  function getDb(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore() : null; }
  function getDemo(){ return global.GS_DEMO_DATA || global.demoData || {}; }

  function buildMetricsFromDemo(){
    const demo = getDemo();
    const retiros = Array.isArray(demo.retiros?.items) ? demo.retiros.items : [];
    const pagos = Array.isArray(demo.pagos?.items) ? demo.pagos.items : [];
    const clientes = Array.isArray(demo.clientes) ? demo.clientes : [];
    const retirosSeries = retiros.map((r)=> r.estado === 'realizado' ? 1 : 0);
    const ingresosSeries = pagos.map((p)=> Number(String(p.monto||'').replace(/[^0-9.-]/g,'')) || 0);
    const eficienciaBase = clientes.length ? Math.min(97, 70 + (retiros.length/Math.max(clientes.length,1))*22) : 86;
    return {
      period: state.period,
      retiros: {
        value: retiros.length,
        change: computeChange(retirosSeries),
        series: normalizeSeries(retirosSeries, 12)
      },
      ingresos: {
        value: ingresosSeries.reduce((a,b)=> a+b,0),
        change: computeChange(ingresosSeries),
        series: normalizeSeries(ingresosSeries, 12)
      },
      eficiencia: {
        value: eficienciaBase,
        change: +(Math.random()*2.4).toFixed(1),
        series: normalizeSeries([eficienciaBase-3, eficienciaBase-1, eficienciaBase, eficienciaBase+1], 8)
      },
      clientesActivos: clientes.length,
      ultimasFechas: retiros.map((r)=> r.fecha || r.slot || '')
    };
  }

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
      const sample = demo.analytics || buildMetricsFromDemo();
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
      const sample = demo.analytics || buildMetricsFromDemo();
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
    const root = document.getElementById('appView') || document.documentElement;
    const styles = getComputedStyle(root);
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
    const retirosSeries = normalizeSeries(base.retiros?.series || [], 8);
    const ingresosSeries = normalizeSeries(base.ingresos?.series || [], 8);
    const efficiencySeries = normalizeSeries(base.eficiencia?.series || [], 8);
    const smooth = (series)=>{
      return series.reduce((acc, val, idx)=>{
        const weight = 0.6 + (idx/series.length)*0.4;
        return acc + weight * Number(val || 0);
      }, 0) / Math.max(series.length,1);
    };
    const trend = (series)=>{
      const n = series.length;
      if(!n){ return 0; }
      const mean = series.reduce((a,b)=> a+b,0)/n;
      const num = series.reduce((acc, val, idx)=> acc + (idx- n/2)*(val-mean), 0);
      return num / Math.max(n,1);
    };
    const retirosForecast = Math.max(0, Math.round(smooth(retirosSeries) + trend(retirosSeries)));
    const ingresosForecast = Math.max(0, Math.round(smooth(ingresosSeries) * 1.05 + trend(ingresosSeries)*2));
    const eficienciaForecast = Math.min(99, Math.round(smooth(efficiencySeries) + 1.5));
    return {
      retiros: { value: retirosForecast, confidence: 0.83 },
      ingresos: { value: ingresosForecast, confidence: 0.8 },
      eficiencia: { value: eficienciaForecast, confidence: 0.78 }
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
    setAiStatus('Análisis en tiempo real', true);
  }

  function renderAlerts(alerts){
    const container = q('#alertsContent');
    if(!container){ return; }
    container.innerHTML = '';
    if(!alerts.length){
      container.innerHTML = '<div class="alert-item">Sin alertas activas.</div>';
      return;
    }
    alerts.forEach((alert)=>{
      const div = document.createElement('div');
      div.className = `alert-item priority-${alert.priority || 'medium'}`;
      div.innerHTML = `
        <div class="alert-title">${alert.title}</div>
        <div class="alert-desc">${alert.description}</div>
      `;
      container.appendChild(div);
    });
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
    },
    churn_risk: {
      title: 'Clientes con riesgo de baja',
      description: 'Contactá a clientes con baja frecuencia de retiros y pagos atrasados.',
      module: 'clientes'
    },
    high_value: {
      title: 'Clientes de alto valor',
      description: 'Ofrecé upgrade a clientes con alto ticket promedio y baja incidencia.',
      module: 'clientes'
    },
    cashflow_alert: {
      title: 'Refinanciar cobranzas',
      description: 'Detectamos brecha de caja en 2 semanas. Activá recordatorios y escalamiento.',
      module: 'finanzas'
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
    setAiStatus('Sincronizando datos...', true);
    fetchMetrics().then((metrics)=>{
      state.metrics = metrics;
      updateKpiCards(metrics);
      state.predictions = computePredictions(metrics);
      renderPredictions(state.predictions);
      loadAiLayer();
    }).catch((err)=>{
      console.warn('No se pudieron obtener métricas en vivo, usando demo', err);
      const demoMetrics = buildMetricsFromDemo();
      state.metrics = demoMetrics;
      updateKpiCards(demoMetrics);
      state.predictions = computePredictions(demoMetrics);
      renderPredictions(state.predictions);
      setAiStatus('Modo demo (datos locales)', false);
    });
  }

  function loadAiLayer(){
    setAiStatus('Procesando IA...', true);
    collectAiDataset().then((dataset)=>{
      state.aiDataset = dataset;
      const insights = runAiInsights(dataset);
      renderAlerts(insights.alerts);
      renderPredictions(insights.predictions || state.predictions || {});
      renderRecommendations(insights.recommendations);
      setAiStatus('Análisis en tiempo real', true);
    }).catch((err)=>{
      console.warn('AI dataset fallback', err);
      setAiStatus('IA en modo demo', false);
    });
  }

  function collectAiDataset(){
    const demo = getDemo();
    const db = getDb();
    if(!db){
      return Promise.resolve({
        clients: demo.clientes || [],
        retiros: demo.retiros?.items || [],
        pagos: demo.pagos?.items || []
      });
    }
    return Promise.all([
      db.collection('clientes').limit(200).get(),
      db.collection('retiros').orderBy('fecha','desc').limit(200).get().catch(()=> db.collection('retiros').limit(200).get()),
      db.collection('finanzas').orderBy('fecha','desc').limit(200).get().catch(()=> db.collection('finanzas').limit(200).get())
    ]).then(([clientesSnap, retirosSnap, pagosSnap])=>{
      return {
        clients: clientesSnap ? clientesSnap.docs.map((d)=> ({ id: d.id, ...d.data() })) : [],
        retiros: retirosSnap ? retirosSnap.docs.map((d)=> ({ id: d.id, ...d.data() })) : [],
        pagos: pagosSnap ? pagosSnap.docs.map((d)=> ({ id: d.id, ...d.data() })) : []
      };
    }).catch(()=>({
      clients: demo.clientes || [],
      retiros: demo.retiros?.items || [],
      pagos: demo.pagos?.items || []
    }));
  }

  function runAiInsights(dataset){
    const engineered = engineerFeatures(dataset);
    const models = runMlModels(engineered);

    const alerts = buildAlerts(engineered, models);
    const aiPreds = Object.assign({}, state.predictions, {
      ingresos: models.revenueForecast,
      retiros: models.routeForecast,
      eficiencia: models.operationalForecast
    });

    const recommendations = models.recommendations.length ? models.recommendations : ['optimize_routes','adjust_schedule'];

    return { alerts, predictions: aiPreds, recommendations };
  }

  function engineerFeatures(dataset){
    const clients = dataset.clients || [];
    const retiros = dataset.retiros || [];
    const pagos = dataset.pagos || [];

    const avgTicket = pagos.length ? pagos.reduce((a,b)=> a + Number(b.monto || b.valor || 0),0)/pagos.length : 0;
    const churnSignals = clients.map((c)=>{
      const inactivity = Number(c.inactividadDias || c.inactiveDays || 0);
      const freq = Number(c.frecuencia || c.visitasMes || 1);
      return { id:c.id, inactivity, freq, value: Number(c.valorMensual || c.monto || avgTicket) };
    });
    const routeLoads = retiros.reduce((acc,r)=>{ const zona = r.zona || r.barrio || 'general'; acc[zona]=(acc[zona]||0)+1; return acc; },{});
    const paymentDelays = pagos.map((p)=> Number(p.atrasoDias || p.diasAtraso || 0));

    return { clients, retiros, pagos, avgTicket, churnSignals, routeLoads, paymentDelays };
  }

  function logistic(x){ return 1/(1+Math.exp(-x)); }

  function runMlModels(features){
    const churnScores = features.churnSignals.map((c)=>{
      const score = logistic(0.8*(c.inactivity/30) - 0.4*(c.freq/4) + 0.2);
      return Object.assign({}, c, { score });
    });
    const churnHigh = churnScores.filter((c)=> c.score > 0.55);

    const seasonalDemand = Object.values(features.routeLoads).map((count)=> count || 0);
    const seasonality = seasonalDemand.length ? seasonalDemand.reduce((a,b)=>a+b,0)/Math.max(seasonalDemand.length,1) : 0;

    const revenueForecast = {
      value: Math.round((features.avgTicket * (features.pagos.length || 8)) * 1.12),
      confidence: 0.82
    };
    const routeForecast = {
      value: Math.round((features.retiros.length || 10) * (1 + (seasonality/50))),
      confidence: 0.79
    };
    const operationalForecast = {
      value: Math.min(98, 88 + Math.max(0, 6 - (features.paymentDelays.reduce((a,b)=> a+b,0)/Math.max(features.paymentDelays.length||1,1)))),
      confidence: 0.77
    };

    const recommendations = [];
    if(churnHigh.length){ recommendations.push('churn_risk'); }
    if(features.avgTicket > 20000){ recommendations.push('high_value'); }
    if(features.paymentDelays.some((d)=> d>5)){ recommendations.push('cashflow_alert'); }
    if(Object.keys(features.routeLoads).some((k)=> features.routeLoads[k] > 8)){ recommendations.push('optimize_routes'); }
    recommendations.push('adjust_schedule');

    return { churnScores, revenueForecast, routeForecast, operationalForecast, recommendations };
  }

  function buildAlerts(features, models){
    const alerts = [];
    const latePayments = features.paymentDelays.filter((d)=> d>5).length;
    if(models.churnScores.some((c)=> c.score > 0.65)){
      alerts.push({ priority:'high', title:'Riesgo de churn', description:'Hay clientes con inactividad prolongada. Contactá para retener.' });
    }
    if(latePayments){
      alerts.push({ priority:'medium', title:'Cobranzas pendientes', description:`${latePayments} pagos con más de 5 días de atraso.` });
    }
    if(Object.keys(features.routeLoads).some((k)=> features.routeLoads[k] > 8)){
      alerts.push({ priority:'medium', title:'Rutas cargadas', description:'Rebalanceá zonas para reducir tiempos de entrega.' });
    }
    if(!alerts.length){ alerts.push({ priority:'low', title:'IA estable', description:'Sin anomalías críticas detectadas.' }); }
    return alerts;
  }

  function renderRecommendations(keys){
    const list = q(selectors.recommendations);
    if(!list){ return; }
    list.innerHTML = '';
    (keys && keys.length ? keys : Object.keys(recommendationCopy)).forEach((key)=>{
      const rec = recommendationCopy[key];
      if(!rec){ return; }
      const div = document.createElement('div');
      div.className = 'recommendation-item priority-medium';
      div.innerHTML = `
        <div class="rec-priority">${rec.priority || 'Medio'}</div>
        <div class="rec-content">
          <div class="rec-title">${rec.title}</div>
          <div class="rec-description">${rec.description}</div>
          <div class="rec-actions">
            <button class="rec-btn primary" data-key="${key}" data-action="implement">Implementar</button>
            <button class="rec-btn secondary" data-key="${key}" data-action="details">Detalles</button>
          </div>
        </div>`;
      list.appendChild(div);
    });
    list.querySelectorAll('button[data-action]').forEach((btn)=>{
      btn.addEventListener('click', ()=>{
        const key = btn.dataset.key;
        if(btn.dataset.action === 'implement'){ implementRecommendation(key); }
        else{ viewRecommendationDetails(key); }
      });
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
    setAiStatus('Sincronizando IA...', true);

    const ensureReadyAndRefresh = ()=>{
      const isAppReady = document.body.classList.contains('app-ready');
      if(!isAppReady){ return; }
      refreshMetrics();
    };

    ensureReadyAndRefresh();
    const refreshTimer = setInterval(refreshMetrics, 60 * 1000);

    if(global.gsTheme){
      document.addEventListener(global.gsTheme.THEME_EVENT, onThemeUpdate);
    }
    if(global.gsSession && global.gsSession.SESSION_EVENT){
      document.addEventListener(global.gsSession.SESSION_EVENT, ()=> ensureReadyAndRefresh());
    }
    document.addEventListener('gs:route', (evt)=>{
      if(evt && evt.detail && evt.detail.key === '/'){ ensureReadyAndRefresh(); }
    });

    window.addEventListener('beforeunload', ()=> clearInterval(refreshTimer));
  }

  document.addEventListener('DOMContentLoaded', bootstrapHome);

  global.openModuleAndSendAction = openModuleAndSendAction;
  global.downloadKPIReport = downloadKPIReport;
  global.implementRecommendation = implementRecommendation;
  global.viewRecommendationDetails = viewRecommendationDetails;
  global.setupDrilldownModal = setupDrilldownModal;
})(window);
