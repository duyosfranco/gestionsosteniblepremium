(function(global){
  'use strict';

  const demoData = {
    session: {
      displayName: 'Cuenta demo',
      email: 'demo@gestionsostenible.com',
      phoneNumber: '+598 92 000 000',
      role: 'demo',
      organizationId: 'demo',
      organizationName: 'Gestión Sostenible Demo',
      brandName: 'Gestión Sostenible',
      theme: {
        palette: {
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
        }
      }
    },
    home: {
      agendaHoy: 6,
      agendaRealizados: 2,
      clientesActivos: 28,
      contratosVigentes: 22,
      saldoMes: 186500,
      cobranzasPendientes: 5,
      ultimoCobro: 28000,
      ultimoAcceso: new Date().toISOString()
    },
    clientes: [
      { id: 'cli-eco', organizationId: 'demo', nombre: 'Eco Residuos SRL', rut: '219865420019', direccion: 'Isla de Flores 1335, Montevideo', contrato: true, monto: '$ 28.000', telefono: '+598 94 111 222', lat: -34.90573, lng: -56.18816 },
      { id: 'cli-urb', organizationId: 'demo', nombre: 'Urbano Limpio Coop.', rut: '212345670019', direccion: 'Dr. Joaquín Requena 1220, Montevideo', contrato: true, monto: '$ 18.900', telefono: '+598 97 000 123', lat: -34.89252, lng: -56.17295 },
      { id: 'cli-bar', organizationId: 'demo', nombre: 'Barra Verde SA', rut: '219004560019', direccion: 'Camino de los Molinos 4555, Canelones', contrato: false, monto: '$ 9.500', telefono: '+598 91 555 678', lat: -34.77761, lng: -56.02311 },
      { id: 'cli-pla', organizationId: 'demo', nombre: 'Plaza Rivera', rut: '215678900019', direccion: 'Av. Rivera 2555, Montevideo', contrato: true, monto: '$ 12.400', telefono: '+598 92 333 444', lat: -34.90088, lng: -56.15403 },
      { id: 'cli-mer', organizationId: 'demo', nombre: 'Mercado del Puerto', rut: '210045678019', direccion: 'Piedras 237, Montevideo', contrato: true, monto: '$ 24.800', telefono: '+598 93 444 555', lat: -34.90708, lng: -56.20848 }
    ],
    retiros: {
      fecha: (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
      items: [
        { id: 'ret-1', organizationId: 'demo', clienteId: 'cli-eco', fecha: null, slot: '08:30', estado: 'pendiente', notas: 'Levantar contenedores orgánicos.' },
        { id: 'ret-2', organizationId: 'demo', clienteId: 'cli-urb', fecha: null, slot: '10:15', estado: 'realizado', notas: 'Material reciclable pesado.' },
        { id: 'ret-3', organizationId: 'demo', clienteId: 'cli-pla', fecha: null, slot: '11:45', estado: 'pendiente', notas: 'Retiro semanal.' },
        { id: 'ret-4', organizationId: 'demo', clienteId: 'cli-mer', fecha: null, slot: '14:00', estado: 'pendiente', notas: 'Coordinar acceso por Peatonal Sarandí.' },
        { id: 'ret-5', organizationId: 'demo', clienteId: 'cli-bar', fecha: null, slot: '16:30', estado: 'realizado', notas: 'Chequeo de aceite usado.' },
        { id: 'ret-6', organizationId: 'demo', clienteId: 'cli-eco', fecha: null, slot: '18:00', estado: 'pendiente', notas: 'Carga final del día.' }
      ]
    },
    pagos: {
      mes: (()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; })(),
      items: [
        { id: 'pay-1', organizationId: 'demo', clienteId: 'cli-eco', fecha: '2024-07-02', mes: null, monto: '$ 28.000', estado: 'recibido', concepto: 'Servicio mensual' },
        { id: 'pay-2', organizationId: 'demo', clienteId: 'cli-urb', fecha: '2024-07-05', mes: null, monto: '$ 18.900', estado: 'pendiente', concepto: 'Plan mensual' },
        { id: 'pay-3', organizationId: 'demo', clienteId: 'cli-pla', fecha: '2024-07-07', mes: null, monto: '$ 12.400', estado: 'pendiente', concepto: 'Retiro programado' },
        { id: 'pay-4', organizationId: 'demo', clienteId: 'cli-mer', fecha: '2024-07-09', mes: null, monto: '$ 24.800', estado: 'recibido', concepto: 'Gestión integral' },
        { id: 'pay-5', organizationId: 'demo', clienteId: 'cli-bar', fecha: '2024-07-11', mes: null, monto: '$ 9.500', estado: 'pendiente', concepto: 'Agenda quincenal' }
      ]
    },
    dgi: {
      mes: null,
      items: [
        { id: 'dgi-1', organizationId: 'demo', titulo: 'Formulario 1302 - Declaración mensual IVA', url: 'https://www.dgi.gub.uy/wdgi/page?2,principal,principal,O,es,0,PAG;1943;2;', estado: 'pendiente', notas: 'Recordá adjuntar boletas.' },
        { id: 'dgi-2', organizationId: 'demo', titulo: 'BPS - Aportes patronales', url: 'https://www.bps.gub.uy/1462/planilla-de-trabajo.html', estado: 'presentado', notas: 'Enviada con comprobante digital.' },
        { id: 'dgi-3', organizationId: 'demo', titulo: 'DGI - e-Ticket Residuos', url: 'https://servicios.dgi.gub.uy/portal2017/', estado: 'pendiente', notas: 'Coordinar datos con contable.' }
      ]
    },
    usuarios: {
      cuentas: [
        { id: 'usr-admin', email: 'demo@gestionsostenible.com', displayName: 'Administración Demo', role: 'admin', status: 'activo', organizationId: 'demo', createdAt: '2023-01-12T10:05:00Z' },
        { id: 'usr-control', email: 'control@gestionsostenible.com', displayName: 'Control Operativo', role: 'control', status: 'activo', organizationId: 'demo', createdAt: '2023-05-27T08:40:00Z' }
      ],
      invitaciones: [
        { id: 'inv-01', email: 'nueva.cuenta@empresa.com', role: 'control', status: 'invitado', organizationId: 'demo', createdAt: '2024-06-30T13:00:00Z', notes: 'Supervisión logística.' }
      ]
    },
    auditoria: [
      { id: 'audit-1', event: 'session.login', createdAt: Date.now() - 86400000, metadata: { actor: 'Administración Demo', provider: 'demo' } },
      { id: 'audit-2', event: 'theme.update', createdAt: Date.now() - 43200000, metadata: { actor: 'Administración Demo' } }
    ]
  };

  global.GS_DEMO_DATA = demoData;
})(window);
