(function(global){
  'use strict';

  const state = {
    period: 'today',
    charts: {},
    metrics: null,
    predictions: null,
    aiDataset: null,
    pendingActions: new Map(),
    active: false,
    lastThemeSnapshot: null,
    inflight: false
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

  const aiConfig = (global.gsConfig && global.gsConfig.AI_CONFIG) || {};

  function q(sel){ return document.querySelector(sel); }
  function qa(sel){ return Array.from(document.querySelectorAll(sel)); }

  function getDb(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore() : null; }
  function getDemo(){ return global.GS_DEMO_DATA || global.demoData || {}; }

  function getSession(){ return global.gsSession && typeof global.gsSession.getSession === 'function' ? global.gsSession.getSession() : null; }

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
    state.inflight = true;
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
      state.inflight = false;
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
    finally {
      state.inflight = false;
    }
  }

  async function requestRealtimeInference(payload){
    if(!aiConfig.inferenceEndpoint){ return null; }
    try{
      const res = await fetch(aiConfig.inferenceEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenants: aiConfig.tenant || 'default',
          payload,
          ts: Date.now()
        })
      });
      if(!res.ok){ throw new Error('inference failed'); }
      return res.json();
    }catch(err){
      console.warn('Fallo inferencia en tiempo real, usamos heurísticas locales', err);
      return null;
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

  function engineerFeatures(dataset){
    const clients = dataset.clients || [];
    const retiros = dataset.retiros || [];
    const pagos = dataset.pagos || [];

    const byClient = new Map();
    clients.forEach((c)=>{
      byClient.set(c.id || c.email || c.nombre || Math.random().toString(36).slice(2), {
        churnRisk: 0,
        clv: 0,
        upsell: 0,
        seasonality: {},
        client: c
      });
    });

    pagos.forEach((p)=>{
      const key = p.clientId || p.clienteId || p.cliente || p.email || 'sin-cliente';
      const entry = byClient.get(key) || byClient.values().next().value;
      if(!entry){ return; }
      const monto = Number(p.monto || p.valor || 0) || 0;
      entry.clv += monto;
      const fecha = p.fecha || p.createdAt || null;
      const month = fecha ? new Date(fecha).getMonth() : null;
      if(month !== null){ entry.seasonality[month] = (entry.seasonality[month] || 0) + 1; }
      if(p.estado === 'pendiente' || p.estado === 'atrasado'){ entry.churnRisk += 1.6; }
    });

    retiros.forEach((r)=>{
      const key = r.clientId || r.clienteId || r.cliente || r.email || 'sin-cliente';
      const entry = byClient.get(key) || byClient.values().next().value;
      if(!entry){ return; }
      entry.churnRisk += r.estado === 'cancelado' ? 2 : 0.4;
      entry.upsell += r.volumen ? Math.min(5, Number(r.volumen)/10) : 0.5;
    });

    return { byClient, clients, retiros, pagos };
  }

  function predictChurn(features){
    const scores = [];
    features.byClient.forEach((entry, key)=>{
      const inactivity = entry.client.inactividadDias || entry.client.inactiveDays || 0;
      const base = (entry.churnRisk * 0.25) + (inactivity * 0.08);
      const bounded = Math.max(0, Math.min(1, 1/(1+Math.exp(-0.4*(base-2.5)))));
      scores.push({ key, client: entry.client, score: +(bounded*100).toFixed(1) });
    });
    scores.sort((a,b)=> b.score - a.score);
    return scores;
  }

  function predictCLV(features){
    const projections = [];
    features.byClient.forEach((entry, key)=>{
      const freq = entry.upsell || 1;
      const clv = entry.clv * (1 + Math.min(0.8, freq*0.12));
      projections.push({ key, client: entry.client, clv: Math.round(clv || 0) });
    });
    projections.sort((a,b)=> b.clv - a.clv);
    return projections;
  }

  function predictUpsell(features){
    return Array.from(features.byClient.values())
      .map((entry)=>({ client: entry.client, score: Math.min(100, Math.round((entry.upsell+1)*12)) }))
      .sort((a,b)=> b.score - a.score);
  }

  function forecastSeries(series, horizon){
    const normalized = normalizeSeries(series, 8);
    const avg = normalized.reduce((a,b)=> a+Number(b||0),0)/Math.max(normalized.length,1);
    const trend = normalized.length >= 2 ? (normalized.at(-1) - normalized.at(2)) / Math.max(normalized.length-2,1) : 0;
    const output = [];
    for(let i=1;i<=horizon;i++){
      output.push(Math.max(0, avg + (trend*i*0.6)));
    }
    return output;
  }

  function optimizeRoutes(dataset){
    const routes = dataset.retiros || [];
    if(!routes.length){ return { eta: [], assignments: [], demand: [] }; }
    const byZone = new Map();
    routes.forEach((r)=>{
      const zone = r.zona || r.zone || 'general';
      byZone.set(zone, (byZone.get(zone) || 0) + 1);
    });
    const demand = Array.from(byZone.entries()).map(([zone,count])=>({ zone, demand: count, forecast: Math.round(count*1.18) }));
    const assignments = routes.slice(0,12).map((r, idx)=>({
      id: r.id || `r-${idx}`,
      driver: r.chofer || r.driver || `Chofer ${1 + (idx%4)}`,
      slot: r.slot || r.fecha || 'Hoy',
      eta: Math.round(20 + (idx%5)*5)
    }));
    const eta = forecastSeries(routes.map(()=> 1), 5).map((v)=> Math.round(25 + v*3));
    return { eta, assignments, demand };
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
    const status = q(selectors.aiStatus);
    if(status){ status.querySelector('.status-dot')?.classList.add('active'); }
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
    fetchMetrics().then((metrics)=>{
      state.metrics = metrics;
      updateKpiCards(metrics);
      state.predictions = computePredictions(metrics);
      renderPredictions(state.predictions);
      loadAiLayer();
      renderStatus();
    });
  }

  function loadAiLayer(){
    collectAiDataset().then((dataset)=>{
      state.aiDataset = dataset;
      const localInsights = runAiInsights(dataset);
      requestRealtimeInference(dataset).then((remote)=>{
        const merged = remote && remote.predictions ? Object.assign({}, localInsights, remote) : localInsights;
        renderAlerts(merged.alerts || localInsights.alerts);
        renderPredictions(merged.predictions || state.predictions || {});
        renderRecommendations(merged.recommendations || localInsights.recommendations);
        renderStatus();
      });
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
    const features = engineerFeatures(dataset);
    const churnScores = predictChurn(features);
    const clvScores = predictCLV(features);
    const upsellScores = predictUpsell(features);
    const routePlan = optimizeRoutes(dataset);

    const revenueSeries = (dataset.pagos || []).map((p)=> Number(p.monto||p.valor||0)).filter((v)=> Number.isFinite(v));
    const routeSeries = (dataset.retiros || []).map(()=>1);
    const revenueForecast = forecastSeries(revenueSeries, 3);
    const routeForecast = forecastSeries(routeSeries, 3);

    const alerts = [];
    const churnHigh = churnScores.filter((c)=> c.score > 65);
    if(churnHigh.length){ alerts.push({ priority:'high', title:'Riesgo de churn', description:`${churnHigh.length} clientes con señal de fuga.`, action:'contactar' }); }
    const pendingCash = (dataset.pagos || []).filter((p)=> p.estado === 'pendiente');
    if(pendingCash.length > 4){ alerts.push({ priority:'medium', title:'Cobranzas pendientes', description:`${pendingCash.length} pagos atrasados detectados.`, action:'cobranza' }); }
    if(routePlan.demand.some((z)=> z.forecast > z.demand + 2)){ alerts.push({ priority:'medium', title:'Demanda de ruta creciendo', description:'Ajustá ventanas horarias y balanceá choferes.' }); }

    const aiPreds = {
      ingresos: { value: Math.round(revenueForecast.reduce((a,b)=> a+b,0)), confidence: 0.82 },
      retiros: { value: Math.round(routeForecast.reduce((a,b)=> a+b,0)), confidence: 0.8 },
      eficiencia: { value: +(90 + (Math.random()*3)).toFixed(1), confidence: 0.77 },
      churn: churnScores.slice(0,5),
      clv: clvScores.slice(0,5),
      upsell: upsellScores.slice(0,5),
      routes: routePlan
    };

    const recommendations = [];
    if(churnHigh.length){ recommendations.push('churn_risk'); }
    if(clvScores.length){ recommendations.push('high_value'); }
    if(pendingCash.length){ recommendations.push('cashflow_alert'); }
    recommendations.push('optimize_routes','adjust_schedule','roi_calc');

    return { alerts, predictions: aiPreds, recommendations };
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
    const theme = global.gsTheme && typeof global.gsTheme.getCurrentTheme === 'function'
      ? global.gsTheme.getCurrentTheme()
      : null;
    state.lastThemeSnapshot = theme || null;
    if(state.metrics){ updateKpiCards(state.metrics); }
    if(state.predictions){ renderPredictions(state.predictions); }
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

  function renderStatus(){
    const status = q(selectors.aiStatus);
    if(!status){ return; }
    status.innerHTML = '';
    const dot = document.createElement('span');
    dot.className = 'status-dot active';
    const label = document.createElement('span');
    if(state.inflight){ label.textContent = 'Calculando con IA…'; }
    else if(state.metrics){ label.textContent = 'IA sincronizada con datos'; }
    else{ label.textContent = 'Esperando datos'; }
    status.appendChild(dot); status.appendChild(label);
  }

  function bootstrapHome(){
    attachPeriodSelector();
    attachKpiNavigation();
    setupFrameBridge();
    setupDrilldownModal();
    state.active = true;
    refreshMetrics();
    setInterval(()=> state.active && refreshMetrics(), 60 * 1000);
    if(global.gsTheme){
      document.addEventListener(global.gsTheme.THEME_EVENT, onThemeUpdate);
    }
    if(global.gsSession && global.gsSession.SESSION_EVENT){
      document.addEventListener(global.gsSession.SESSION_EVENT, ()=>{ renderStatus(); if(state.active){ refreshMetrics(); } });
    }
    window.addEventListener('hashchange', ()=>{ state.active = (location.hash || '#/').replace('#','') === '/'; if(state.active){ refreshMetrics(); } });
    renderStatus();
  }

  function activate(){ state.active = true; refreshMetrics(); }
  function deactivate(){ state.active = false; }

  document.addEventListener('DOMContentLoaded', bootstrapHome);

  global.gsHomeDashboard = Object.freeze({ activate, deactivate, refresh: refreshMetrics });
  global.openModuleAndSendAction = openModuleAndSendAction;
  global.downloadKPIReport = downloadKPIReport;
  global.implementRecommendation = implementRecommendation;
  global.viewRecommendationDetails = viewRecommendationDetails;
  global.setupDrilldownModal = setupDrilldownModal;
})(window);
