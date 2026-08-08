/* =====================================================================
   FlowPos -- Mesero. Vanilla JS, sin frameworks ni CDN. Vista aparte de
   la de escritorio (frontend/), pensada desde cero para un celular:
   objetivos grandes, pocas pantallas, actualización automática para
   que dos meseros viendo la misma mesa no se pisen.
   ===================================================================== */

const API = '/api';
const POLL_MS = 5000;

const state = {
  usuario: null,
  vista: 'mesas',
  pinBuffer: '',
  cuentaAbiertaId: null,
  modalAbierto: false,
};

let pollTimer = null;
let timerBillar = null;

// ---------------------------------------------------------------------
// Utilidades (mismo comportamiento que frontend/app.js)
// ---------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function formatoMoneda(centavos, moneda = 'CUP') {
  const valor = (Number(centavos) / 100).toFixed(2);
  const partes = valor.split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${partes.join('.')} ${moneda}`;
}

function toast(mensaje, tipo = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'error' ? 'toast-error' : tipo === 'exito' ? 'toast-exito' : ''}`;
  el.textContent = mensaje;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

async function apiFetch(path, options = {}) {
  const opts = { ...options };
  opts.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);

  let res;
  try {
    res = await fetch(API + path, opts);
  } catch (e) {
    throw new Error('No se pudo conectar con el sistema. ¿Sigue prendida la PC y en la misma wifi?');
  }

  const texto = await res.text();
  let data = null;
  if (texto) {
    try { data = JSON.parse(texto); } catch { data = null; }
  }
  if (!res.ok) {
    const detalle = (data && data.detail) ? data.detail : `Error ${res.status}`;
    throw new Error(detalle);
  }
  return data;
}

function conUsuario(path) {
  const separador = path.includes('?') ? '&' : '?';
  return `${path}${separador}usuario_id=${state.usuario.id}`;
}

function mostrarModal(contenidoHtml) {
  state.modalAbierto = true;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="overlay-panel">${contenidoHtml}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  document.body.appendChild(overlay);
  function cerrar() {
    overlay.remove();
    state.modalAbierto = false;
  }
  return { overlay, cerrar };
}

// ---------------------------------------------------------------------
// Login (PIN)
// ---------------------------------------------------------------------

const PIN_MAX = 8;

function actualizarPinDots() {
  const cont = document.getElementById('pin-display');
  cont.innerHTML = '';
  const cantidad = Math.max(state.pinBuffer.length, 4);
  for (let i = 0; i < cantidad; i++) {
    const dot = document.createElement('span');
    dot.className = 'pin-dot' + (i < state.pinBuffer.length ? ' lleno' : '');
    cont.appendChild(dot);
  }
}

async function intentarLogin() {
  const errorEl = document.getElementById('pin-error');
  errorEl.textContent = '';
  if (state.pinBuffer.length < 4) {
    errorEl.textContent = 'El PIN debe tener al menos 4 dígitos';
    return;
  }
  try {
    const usuario = await apiFetch('/auth/login', { method: 'POST', body: { pin: state.pinBuffer } });
    state.usuario = usuario;
    localStorage.setItem('flowpos_mesero_usuario', JSON.stringify(usuario));
    state.pinBuffer = '';
    actualizarPinDots();
    mostrarApp();
  } catch (e) {
    errorEl.textContent = e.message;
    state.pinBuffer = '';
    actualizarPinDots();
  }
}

function initLogin() {
  actualizarPinDots();
  document.querySelectorAll('.pin-btn[data-num]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.pinBuffer.length >= PIN_MAX) return;
      state.pinBuffer += btn.dataset.num;
      actualizarPinDots();
    });
  });
  document.getElementById('pin-borrar').addEventListener('click', () => {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    actualizarPinDots();
  });
  document.getElementById('pin-limpiar').addEventListener('click', () => {
    state.pinBuffer = '';
    actualizarPinDots();
  });
  document.getElementById('pin-entrar').addEventListener('click', intentarLogin);
}

function mostrarApp() {
  document.getElementById('vista-login').classList.add('oculto');
  document.getElementById('app-shell').classList.remove('oculto');
  document.getElementById('header-usuario').textContent = state.usuario.nombre;
  cambiarVista('mesas');
  reiniciarControlInactividad();
}

function cerrarSesion(motivo) {
  detenerPolling();
  _quitarFab();
  detenerControlInactividad();
  state.usuario = null;
  state.cuentaAbiertaId = null;
  localStorage.removeItem('flowpos_mesero_usuario');
  document.getElementById('app-shell').classList.add('oculto');
  document.getElementById('vista-login').classList.remove('oculto');
  const errorEl = document.getElementById('pin-error');
  if (motivo === 'inactividad' && errorEl) {
    errorEl.textContent = 'Tu sesión se cerró sola por inactividad. Ingresa tu PIN de nuevo.';
  }
}

// ---------------------------------------------------------------------
// Control de inactividad -- mismo comportamiento que el escritorio: el
// tiempo lo define el Gerente por usuario, avisa 1 minuto antes.
// ---------------------------------------------------------------------

let timerInactividadCierre = null;
let timerInactividadAviso = null;

function iniciarControlInactividad() {
  detenerTimersInactividad();
  if (!state.usuario) return;
  const minutos = state.usuario.timeout_inactividad_minutos || 20;
  const totalMs = minutos * 60 * 1000;
  const avisoMs = Math.max(totalMs - 60000, totalMs * 0.5);

  timerInactividadAviso = setTimeout(mostrarAvisoInactividad, avisoMs);
  timerInactividadCierre = setTimeout(() => cerrarSesion('inactividad'), totalMs);
}

function detenerTimersInactividad() {
  if (timerInactividadCierre) { clearTimeout(timerInactividadCierre); timerInactividadCierre = null; }
  if (timerInactividadAviso) { clearTimeout(timerInactividadAviso); timerInactividadAviso = null; }
}

function detenerControlInactividad() {
  detenerTimersInactividad();
  ocultarAvisoInactividad();
}

function reiniciarControlInactividad() {
  ocultarAvisoInactividad();
  iniciarControlInactividad();
}

function mostrarAvisoInactividad() {
  if (document.getElementById('aviso-inactividad-m')) return;
  const el = document.createElement('div');
  el.id = 'aviso-inactividad-m';
  el.className = 'aviso-inactividad-m';
  el.innerHTML = `
    <span>⏳ Tu sesión se cerrará pronto por inactividad.</span>
    <button type="button" id="aviso-inactividad-seguir-m" class="btn btn-primario btn-chico">Seguir</button>
  `;
  document.body.appendChild(el);
  document.getElementById('aviso-inactividad-seguir-m').addEventListener('click', reiniciarControlInactividad);
}

function ocultarAvisoInactividad() {
  const el = document.getElementById('aviso-inactividad-m');
  if (el) el.remove();
}

function registrarActividadGlobal() {
  let ultimoReset = 0;
  const marcarActividad = () => {
    if (!state.usuario) return;
    const ahora = Date.now();
    if (ahora - ultimoReset < 5000) return;
    ultimoReset = ahora;
    if (document.getElementById('aviso-inactividad-m')) return;
    iniciarControlInactividad();
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((evento) => {
    document.addEventListener(evento, marcarActividad, { passive: true });
  });
}

// ---------------------------------------------------------------------
// Router / polling
// ---------------------------------------------------------------------

function cambiarVista(vista) {
  state.vista = vista;
  state.cuentaAbiertaId = null;
  document.querySelectorAll('.bn-btn').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  render();
}

function render() {
  const main = document.getElementById('app-main-m');
  const renderers = { mesas: renderMesas, billar: renderBillar };
  reiniciarPolling();
  renderers[state.vista]().catch((e) => {
    main.innerHTML = `<p class="vacio">${escapeHtml(e.message)}</p>`;
  });
}

function reiniciarPolling() {
  detenerPolling();
  pollTimer = setInterval(() => {
    // No interrumpir si hay un modal abierto (el mesero puede estar
    // escribiendo un motivo, un monto, etc.) -- eso se refresca solo
    // al cerrarlo, cuando la acción ya se mandó al servidor.
    if (state.modalAbierto) return;
    const main = document.getElementById('app-main-m');
    const renderers = { mesas: renderMesas, billar: renderBillar };
    renderers[state.vista]().catch(() => { /* fallo silencioso en refresco de fondo */ });
  }, POLL_MS);
}

function detenerPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (timerBillar) { clearInterval(timerBillar); timerBillar = null; }
}

// ---------------------------------------------------------------------
// Vista: Mesas (cuentas)
// ---------------------------------------------------------------------

async function renderMesas() {
  if (state.cuentaAbiertaId) return renderDetalleCuenta(state.cuentaAbiertaId);

  const main = document.getElementById('app-main-m');
  const cierre = await apiFetch('/cierre-caja/actual');
  if (!cierre) {
    _quitarFab();
    main.innerHTML = `
      <div class="aviso-panel">
        <h2>La caja no está abierta</h2>
        <p class="card-m-meta">Avisa a un administrador o al gerente para poder empezar a vender.</p>
      </div>
    `;
    return;
  }

  const cuentas = await apiFetch('/cuentas?estado=abierta');
  main.innerHTML = `
    <h2 class="titulo-vista">Mesas abiertas</h2>
    <div class="grid-cards-m" id="grid-cuentas-m"></div>
  `;
  const grid = document.getElementById('grid-cuentas-m');
  if (cuentas.length === 0) {
    grid.innerHTML = '<p class="vacio">No hay mesas abiertas todavía. Tocá el botón + para crear una.</p>';
  } else {
    cuentas.forEach((c) => {
      const activos = c.items.filter((i) => i.estado !== 'cancelado').length;
      const btn = document.createElement('button');
      btn.className = 'card-m';
      btn.innerHTML = `
        <div class="card-m-titulo">${escapeHtml(c.referencia)}</div>
        <div class="card-m-meta">${activos} producto(s)</div>
        <div class="card-m-monto">${formatoMoneda(c.total)}</div>
        ${c.saldo_pendiente > 0
          ? `<div class="badge-m badge-m-ambar">Pendiente ${formatoMoneda(c.saldo_pendiente)}</div>`
          : '<div class="badge-m badge-m-verde">Pagada</div>'}
      `;
      btn.addEventListener('click', () => { state.cuentaAbiertaId = c.id; render(); });
      grid.appendChild(btn);
    });
  }

  if (!document.getElementById('fab-nueva-mesa')) {
    const fab = document.createElement('button');
    fab.id = 'fab-nueva-mesa';
    fab.className = 'fab';
    fab.textContent = '+';
    fab.addEventListener('click', abrirModalNuevaCuenta);
    document.body.appendChild(fab);
  }
}

function _quitarFab() {
  const fab = document.getElementById('fab-nueva-mesa');
  if (fab) fab.remove();
}

function abrirModalNuevaCuenta() {
  const modal = mostrarModal(`
    <h3>Nueva mesa</h3>
    <label>Mesa o nombre del cliente</label>
    <input type="text" id="input-referencia" placeholder="Ej: Mesa 3, Juan..." />
    <div class="fila">
      <button class="btn btn-primario btn-bloque" id="btn-confirmar-cuenta">Crear</button>
    </div>
    <div class="fila" style="margin-top:10px;">
      <button class="btn btn-secundario btn-bloque" id="btn-cancelar-cuenta">Cancelar</button>
    </div>
  `);
  document.getElementById('btn-cancelar-cuenta').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-cuenta').addEventListener('click', async () => {
    const referencia = document.getElementById('input-referencia').value.trim();
    if (!referencia) { toast('Escribe una referencia', 'error'); return; }
    try {
      const cuenta = await apiFetch('/cuentas', {
        method: 'POST',
        body: { referencia, operador_apertura_id: state.usuario.id },
      });
      modal.cerrar();
      state.cuentaAbiertaId = cuenta.id;
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('input-referencia').focus();
}

async function renderDetalleCuenta(cuentaId) {
  _quitarFab();
  const main = document.getElementById('app-main-m');
  const cuenta = await apiFetch(`/cuentas/${cuentaId}`);
  const abierta = cuenta.estado === 'abierta';

  const itemsHtml = cuenta.items.length === 0
    ? '<p class="vacio">Sin productos todavía.</p>'
    : cuenta.items.map((item) => `
        <div class="item-linea-m ${item.estado === 'cancelado' ? 'cancelado' : ''}">
          <div class="item-linea-m-info">
            <div class="item-linea-m-titulo">${item.cantidad} &times; ${escapeHtml(item.producto_nombre)}</div>
            <div class="item-linea-m-meta">${item.estado} · ${formatoMoneda(item.subtotal)}</div>
          </div>
          ${item.estado !== 'cancelado' && abierta
            ? `<button class="btn-icono-chico" data-cancelar-item="${item.id}" title="Cancelar">&times;</button>`
            : ''}
        </div>
      `).join('');

  main.innerHTML = `
    <button class="btn btn-secundario btn-chico" id="btn-volver-m">&larr; Mesas</button>
    <div class="panel-m" style="margin-top:12px;">
      <div class="fila-entre">
        <h2 style="margin:0;font-size:1.15rem;">${escapeHtml(cuenta.referencia)}</h2>
        <span class="badge-m ${abierta ? 'badge-m-ambar' : 'badge-m-verde'}" style="margin-top:0;">${cuenta.estado}</span>
      </div>
      <div style="margin-top:10px;">${itemsHtml}</div>
      <div class="resumen-fila total">
        <strong>Total</strong>
        <span class="monto-grande">${formatoMoneda(cuenta.total)}</span>
      </div>
      <div class="resumen-fila">
        <span class="card-m-meta">Pagado</span>
        <span>${formatoMoneda(cuenta.total_pagado)}</span>
      </div>
      <div class="resumen-fila">
        <span class="card-m-meta">Saldo pendiente</span>
        <span style="color:${cuenta.saldo_pendiente > 0 ? 'var(--rojo)' : 'var(--verde)'};font-weight:700;">${formatoMoneda(cuenta.saldo_pendiente)}</span>
      </div>
    </div>
    ${abierta ? `
      <div class="col">
        <button class="btn btn-primario btn-bloque" id="btn-agregar-producto-m">+ Agregar producto</button>
        <button class="btn btn-secundario btn-bloque" id="btn-cobrar-m">Cobrar</button>
        <button class="btn btn-verde btn-bloque" id="btn-cerrar-cuenta-m" ${cuenta.saldo_pendiente > 0 ? 'disabled' : ''}>Cerrar cuenta</button>
      </div>
    ` : ''}
  `;

  document.getElementById('btn-volver-m').addEventListener('click', () => { state.cuentaAbiertaId = null; render(); });
  if (abierta) {
    document.getElementById('btn-agregar-producto-m').addEventListener('click', () => abrirModalAgregarProducto(cuentaId));
    document.getElementById('btn-cobrar-m').addEventListener('click', () => abrirModalPago(cuentaId, cuenta.saldo_pendiente));
    document.getElementById('btn-cerrar-cuenta-m').addEventListener('click', () => cerrarCuenta(cuentaId));
    main.querySelectorAll('[data-cancelar-item]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalCancelarItem(cuentaId, btn.dataset.cancelarItem));
    });
  }
}

async function abrirModalAgregarProducto(cuentaId) {
  const productos = (await apiFetch('/productos')).filter((p) => p.tipo !== 'servicio');
  const categorias = [...new Set(productos.map((p) => p.categoria))];
  const listaHtml = categorias.map((cat) => `
    <div class="categoria-titulo">${escapeHtml(cat)}</div>
    ${productos.filter((p) => p.categoria === cat).map((p) => `
      <div class="producto-fila" data-producto-card="${p.id}">
        <button class="producto-fila-header" data-producto-id="${p.id}">
          <span>${escapeHtml(p.nombre)}</span>
          <span>${formatoMoneda(p.precio_venta)}</span>
        </button>
        <div class="producto-fila-cantidad oculto">
          <div class="stepper">
            <button class="stepper-btn" data-decrementar type="button">&minus;</button>
            <span class="stepper-valor cantidad-valor">1</span>
            <button class="stepper-btn" data-incrementar type="button">+</button>
          </div>
          <button class="btn btn-primario btn-chico" data-confirmar-cantidad type="button">Agregar</button>
        </div>
      </div>
    `).join('')}
  `).join('');

  const modal = mostrarModal(`
    <h3>Agregar producto</h3>
    <div style="max-height:65vh;overflow-y:auto;">${listaHtml || '<p class="vacio">No hay productos activos.</p>'}</div>
    <button class="btn btn-secundario btn-bloque" id="btn-cerrar-modal-prod" style="margin-top:14px;">Cerrar</button>
  `);
  document.getElementById('btn-cerrar-modal-prod').addEventListener('click', modal.cerrar);

  modal.overlay.querySelectorAll('[data-producto-card]').forEach((card) => {
    const panelCantidad = card.querySelector('.producto-fila-cantidad');
    const valorEl = card.querySelector('.cantidad-valor');
    let cantidad = 1;
    const actualizarValor = () => { valorEl.textContent = String(cantidad); };

    card.querySelector('[data-producto-id]').addEventListener('click', () => {
      const yaAbierto = !panelCantidad.classList.contains('oculto');
      modal.overlay.querySelectorAll('.producto-fila-cantidad').forEach((el) => el.classList.add('oculto'));
      if (!yaAbierto) {
        cantidad = 1;
        actualizarValor();
        panelCantidad.classList.remove('oculto');
      }
    });
    card.querySelector('[data-decrementar]').addEventListener('click', () => {
      cantidad = Math.max(1, cantidad - 1);
      actualizarValor();
    });
    card.querySelector('[data-incrementar]').addEventListener('click', () => {
      cantidad += 1;
      actualizarValor();
    });
    card.querySelector('[data-confirmar-cantidad]').addEventListener('click', async () => {
      try {
        await apiFetch(`/cuentas/${cuentaId}/items`, {
          method: 'POST',
          body: { producto_id: Number(card.dataset.productoCard), cantidad, usuario_id: state.usuario.id },
        });
        toast(`${cantidad} agregado(s)`, 'exito');
        modal.cerrar();
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

function abrirModalCancelarItem(cuentaId, itemId) {
  const modal = mostrarModal(`
    <h3>Cancelar producto</h3>
    <label>Motivo (obligatorio)</label>
    <input type="text" id="input-motivo-m" placeholder="Ej: pedido duplicado..." />
    <div class="fila">
      <button class="btn btn-peligro btn-bloque" id="btn-confirmar-cancelar-m">Confirmar cancelación</button>
    </div>
    <div class="fila" style="margin-top:10px;">
      <button class="btn btn-secundario btn-bloque" id="btn-volver-modal-m">Volver</button>
    </div>
  `);
  document.getElementById('btn-volver-modal-m').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-cancelar-m').addEventListener('click', async () => {
    const motivo = document.getElementById('input-motivo-m').value.trim();
    if (!motivo) { toast('El motivo es obligatorio', 'error'); return; }
    try {
      await apiFetch(`/cuentas/${cuentaId}/items/${itemId}/cancelar`, {
        method: 'POST',
        body: { usuario_id: state.usuario.id, motivo },
      });
      toast('Producto cancelado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function abrirModalPago(cuentaId, saldoPendiente) {
  const modal = mostrarModal(`
    <h3>Cobrar</h3>
    <p class="card-m-meta">Saldo pendiente: <strong>${formatoMoneda(saldoPendiente)}</strong></p>
    <label>Método</label>
    <select id="sel-metodo-m">
      <option value="efectivo">Efectivo</option>
      <option value="transferencia">Transferencia</option>
    </select>
    <label>Moneda</label>
    <select id="sel-moneda-m">
      <option value="CUP">CUP</option>
      <option value="USD">USD</option>
      <option value="MLC">MLC</option>
    </select>
    <div id="campo-subtipo-m" class="oculto">
      <label>Subtipo de transferencia</label>
      <select id="sel-subtipo-m">
        <option value="fiscal">Fiscal</option>
        <option value="libre">Libre</option>
      </select>
    </div>
    <div id="campo-tasa-m" class="oculto">
      <label>Tasa de cambio (CUP por unidad)</label>
      <input type="number" id="input-tasa-m" step="0.01" min="0" />
    </div>
    <label>Monto (en la moneda seleccionada)</label>
    <input type="number" id="input-monto-m" step="0.01" min="0.01" />
    <div class="fila">
      <button class="btn btn-primario btn-bloque" id="btn-confirmar-pago-m">Registrar</button>
    </div>
    <div class="fila" style="margin-top:10px;">
      <button class="btn btn-secundario btn-bloque" id="btn-cancelar-pago-m">Cancelar</button>
    </div>
  `);

  const selMetodo = document.getElementById('sel-metodo-m');
  const selMoneda = document.getElementById('sel-moneda-m');
  const campoSubtipo = document.getElementById('campo-subtipo-m');
  const campoTasa = document.getElementById('campo-tasa-m');

  function actualizarCampos() {
    campoSubtipo.classList.toggle('oculto', selMetodo.value !== 'transferencia');
    campoTasa.classList.toggle('oculto', selMoneda.value === 'CUP');
  }
  selMetodo.addEventListener('change', actualizarCampos);
  selMoneda.addEventListener('change', actualizarCampos);

  document.getElementById('btn-cancelar-pago-m').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-pago-m').addEventListener('click', async () => {
    const monto = Math.round(parseFloat(document.getElementById('input-monto-m').value || '0') * 100);
    if (!monto || monto <= 0) { toast('Monto inválido', 'error'); return; }
    const body = { metodo: selMetodo.value, moneda: selMoneda.value, monto, usuario_id: state.usuario.id };
    if (selMetodo.value === 'transferencia') body.subtipo = document.getElementById('sel-subtipo-m').value;
    if (selMoneda.value !== 'CUP') {
      const tasa = Math.round(parseFloat(document.getElementById('input-tasa-m').value || '0') * 100);
      if (!tasa) { toast('Indica la tasa de cambio', 'error'); return; }
      body.tasa_cambio_aplicada = tasa;
    }
    try {
      await apiFetch(`/cuentas/${cuentaId}/pagos`, { method: 'POST', body });
      toast('Pago registrado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function cerrarCuenta(cuentaId) {
  if (!confirm('¿Cerrar esta cuenta? No se podrán agregar más productos ni pagos.')) return;
  try {
    await apiFetch(`/cuentas/${cuentaId}/cerrar`, { method: 'POST', body: { usuario_id: state.usuario.id } });
    toast('Cuenta cerrada', 'exito');
    state.cuentaAbiertaId = null;
    render();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------
// Vista: Billar
// ---------------------------------------------------------------------

async function renderBillar() {
  _quitarFab();
  const main = document.getElementById('app-main-m');
  const [mesas, cuentasAbiertas, cierre] = await Promise.all([
    apiFetch('/mesas-billar'),
    apiFetch('/cuentas?estado=abierta'),
    apiFetch('/cierre-caja/actual'),
  ]);
  const cajaAbierta = cierre !== null;

  main.innerHTML = `
    <h2 class="titulo-vista">Mesas de billar</h2>
    ${cajaAbierta ? '' : '<p class="vacio">La caja no está abierta: se pueden finalizar sesiones en curso, pero no iniciar nuevas.</p>'}
    <div class="grid-cards-m" id="grid-mesas-m" style="grid-template-columns:1fr;"></div>
  `;
  const grid = document.getElementById('grid-mesas-m');

  if (timerBillar) { clearInterval(timerBillar); timerBillar = null; }
  const timers = [];

  for (const mesa of mesas) {
    const div = document.createElement('div');
    div.className = 'card-m';
    let sesion = null;
    if (mesa.estado === 'ocupada') {
      sesion = await apiFetch(`/mesas-billar/${mesa.id}/sesion-activa`);
    }
    const configTexto = mesa.modo_default === 'temporizador'
      ? `⏳ ${(mesa.limite_minutos_default / 60).toFixed(2).replace(/\.00$/, '')}h por defecto`
      : '⏱️ Cronómetro por defecto';
    div.innerHTML = `
      <div class="fila-entre">
        <span class="card-m-titulo">${escapeHtml(mesa.nombre)}</span>
        <span class="badge-m ${mesa.estado === 'libre' ? 'badge-m-verde' : 'badge-m-ambar'}" style="margin-top:0;">${mesa.estado}</span>
      </div>
      <div class="card-m-meta">${formatoMoneda(mesa.tarifa_por_minuto)}/min · ${configTexto}</div>
      ${sesion ? `
        <div class="timer-mesa-m" data-timer-inicio="${sesion.hora_inicio}" data-timer-modo="${sesion.modo}" data-timer-limite="${sesion.limite_minutos || ''}">00:00</div>
        <div class="card-m-meta">${sesion.politica_cobro === 'hora_completa' ? 'Cobro por hora completa' : 'Cobro por tiempo exacto'}</div>
      ` : ''}
      <div class="mesa-acciones-m" style="margin-top:12px;"></div>
    `;
    const acciones = div.querySelector('.mesa-acciones-m');
    if (mesa.estado === 'libre') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primario btn-bloque';
      btn.textContent = 'Iniciar sesión';
      btn.disabled = !cajaAbierta;
      btn.addEventListener('click', () => abrirModalIniciarBillar(mesa, cuentasAbiertas));
      acciones.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-peligro btn-bloque';
      btn.textContent = 'Finalizar sesión';
      btn.addEventListener('click', () => finalizarBillar(mesa.id));
      acciones.appendChild(btn);
      const timerEl = div.querySelector('[data-timer-inicio]');
      if (timerEl) timers.push(timerEl);
    }
    grid.appendChild(div);
  }

  function actualizarTimers() {
    const ahora = Date.now();
    timers.forEach((el) => {
      const inicio = new Date(el.dataset.timerInicio.replace(' ', 'T') + 'Z').getTime();
      const transcurridoSeg = Math.max(0, Math.floor((ahora - inicio) / 1000));
      const esTemporizador = el.dataset.timerModo === 'temporizador' && el.dataset.timerLimite;

      if (esTemporizador) {
        const limiteSeg = Number(el.dataset.timerLimite) * 60;
        const restanteSeg = limiteSeg - transcurridoSeg;
        const cumplido = restanteSeg <= 0;
        const abs = Math.abs(restanteSeg);
        const mm = String(Math.floor(abs / 60)).padStart(2, '0');
        const ss = String(abs % 60).padStart(2, '0');
        el.textContent = cumplido ? `¡Tiempo cumplido! +${mm}:${ss}` : `${mm}:${ss} restantes`;
        el.classList.toggle('timer-cumplido-m', cumplido);
      } else {
        const mm = String(Math.floor(transcurridoSeg / 60)).padStart(2, '0');
        const ss = String(transcurridoSeg % 60).padStart(2, '0');
        el.textContent = `${mm}:${ss}`;
        el.classList.remove('timer-cumplido-m');
      }
    });
  }
  actualizarTimers();
  if (timers.length > 0) timerBillar = setInterval(actualizarTimers, 1000);
}

function abrirModalIniciarBillar(mesa, cuentasAbiertas) {
  const opciones = cuentasAbiertas.map((c) => `<option value="${c.id}">${escapeHtml(c.referencia)}</option>`).join('');
  let modo = mesa.modo_default;
  let politica = mesa.politica_cobro_default;
  let limiteHoras = mesa.limite_minutos_default ? (mesa.limite_minutos_default / 60).toFixed(2).replace(/\.00$/, '') : '2';

  const resumenTexto = () => {
    const partes = [modo === 'temporizador' ? `Temporizador ${limiteHoras}h` : 'Cronómetro (sin límite)'];
    partes.push(politica === 'hora_completa' ? 'hora completa' : 'tiempo exacto');
    return partes.join(' · ');
  };

  const modal = mostrarModal(`
    <h3>Iniciar sesión — ${escapeHtml(mesa.nombre)}</h3>
    ${cuentasAbiertas.length > 0 ? `
      <label>Mesa/cuenta existente</label>
      <select id="sel-cuenta-billar-m">${opciones}</select>
      <div class="card-m-meta" style="margin:-6px 0 10px;">— o —</div>
    ` : ''}
    <label>Nueva cuenta (mesa o nombre del cliente)</label>
    <input type="text" id="input-nueva-referencia-m" placeholder="Ej: Mesa de billar 1" />

    <div class="fila-entre" style="background:var(--bg-panel-alto);border-radius:10px;padding:10px 12px;margin:4px 0 8px;">
      <span id="mib-resumen-m" style="font-size:0.85rem;">${resumenTexto()}</span>
      <button type="button" class="btn btn-chico btn-secundario" id="mib-cambiar-m">Cambiar</button>
    </div>
    <div id="mib-config-m" class="oculto">
      <label>Modo</label>
      <div class="fila" id="mib-modo-botones-m" style="margin-bottom:10px;">
        <button type="button" class="btn btn-chico ${modo === 'cronometro' ? 'btn-primario' : 'btn-secundario'}" data-modo="cronometro">⏱️ Cronómetro</button>
        <button type="button" class="btn btn-chico ${modo === 'temporizador' ? 'btn-primario' : 'btn-secundario'}" data-modo="temporizador">⏳ Temporizador</button>
      </div>
      <div id="mib-limite-cont-m" style="${modo === 'temporizador' ? '' : 'display:none;'}">
        <label>Límite (horas)</label>
        <div class="fila" style="margin-bottom:8px;">
          ${[1, 1.5, 2, 3].map((h) => `<button type="button" class="btn btn-chico btn-secundario" data-limite-rapido="${h}">${h}h</button>`).join('')}
        </div>
        <input type="number" id="mib-limite-horas-m" step="0.25" min="0.25" value="${limiteHoras}" />
      </div>
      <label>Política de cobro</label>
      <div class="fila" id="mib-politica-botones-m" style="margin-bottom:6px;">
        <button type="button" class="btn btn-chico ${politica === 'exacto' ? 'btn-primario' : 'btn-secundario'}" data-politica="exacto">Tiempo exacto</button>
        <button type="button" class="btn btn-chico ${politica === 'hora_completa' ? 'btn-primario' : 'btn-secundario'}" data-politica="hora_completa">Hora completa</button>
      </div>
    </div>

    <div class="fila" style="margin-top:10px;">
      <button class="btn btn-primario btn-bloque" id="btn-iniciar-billar-m">Iniciar</button>
    </div>
    <div class="fila" style="margin-top:10px;">
      <button class="btn btn-secundario btn-bloque" id="btn-cancelar-billar-m">Cancelar</button>
    </div>
  `);

  document.getElementById('mib-cambiar-m').addEventListener('click', () => {
    document.getElementById('mib-config-m').classList.toggle('oculto');
  });
  document.querySelectorAll('#mib-modo-botones-m [data-modo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      modo = btn.dataset.modo;
      document.querySelectorAll('#mib-modo-botones-m [data-modo]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mib-modo-botones-m [data-modo]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
      document.getElementById('mib-limite-cont-m').style.display = modo === 'temporizador' ? '' : 'none';
      document.getElementById('mib-resumen-m').textContent = resumenTexto();
    });
  });
  document.querySelectorAll('#mib-politica-botones-m [data-politica]').forEach((btn) => {
    btn.addEventListener('click', () => {
      politica = btn.dataset.politica;
      document.querySelectorAll('#mib-politica-botones-m [data-politica]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mib-politica-botones-m [data-politica]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
      document.getElementById('mib-resumen-m').textContent = resumenTexto();
    });
  });
  document.querySelectorAll('[data-limite-rapido]').forEach((btn) => {
    btn.addEventListener('click', () => {
      limiteHoras = btn.dataset.limiteRapido;
      document.getElementById('mib-limite-horas-m').value = limiteHoras;
      document.getElementById('mib-resumen-m').textContent = resumenTexto();
    });
  });
  document.getElementById('mib-limite-horas-m').addEventListener('input', (e) => {
    limiteHoras = e.target.value;
    document.getElementById('mib-resumen-m').textContent = resumenTexto();
  });

  document.getElementById('btn-cancelar-billar-m').addEventListener('click', modal.cerrar);
  document.getElementById('btn-iniciar-billar-m').addEventListener('click', async () => {
    try {
      let cuentaId;
      const nuevaReferencia = document.getElementById('input-nueva-referencia-m').value.trim();
      if (nuevaReferencia) {
        const cuenta = await apiFetch('/cuentas', {
          method: 'POST',
          body: { referencia: nuevaReferencia, operador_apertura_id: state.usuario.id },
        });
        cuentaId = cuenta.id;
      } else if (cuentasAbiertas.length > 0) {
        cuentaId = Number(document.getElementById('sel-cuenta-billar-m').value);
      } else {
        toast('Escribe una referencia para la nueva cuenta', 'error');
        return;
      }
      const body = { cuenta_id: cuentaId, modo, politica_cobro: politica };
      if (modo === 'temporizador') {
        const horas = parseFloat(document.getElementById('mib-limite-horas-m').value || '0');
        if (!horas || horas <= 0) { toast('Indica un límite de horas válido', 'error'); return; }
        body.limite_minutos = Math.round(horas * 60);
      }
      await apiFetch(`/mesas-billar/${mesa.id}/iniciar`, { method: 'POST', body });
      toast('Sesión de billar iniciada', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function finalizarBillar(mesaId) {
  if (!confirm('¿Finalizar esta sesión de billar? Se cobrará el tiempo transcurrido.')) return;
  try {
    const resultado = await apiFetch(`/mesas-billar/${mesaId}/finalizar`, {
      method: 'POST',
      body: { usuario_id: state.usuario.id },
    });
    const detalleTiempo = resultado.minutos_facturados !== resultado.minutos_calculados
      ? `${resultado.minutos_calculados} min jugados, se cobran ${resultado.minutos_facturados}`
      : `${resultado.minutos_calculados} min`;
    toast(`Sesión finalizada: ${detalleTiempo} · ${formatoMoneda(resultado.monto_calculado)}`, 'exito');
    render();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

function init() {
  initLogin();
  registrarActividadGlobal();
  document.getElementById('btn-logout-m').addEventListener('click', () => cerrarSesion());
  document.querySelectorAll('.bn-btn').forEach((btn) => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
  });

  const guardado = localStorage.getItem('flowpos_mesero_usuario');
  if (guardado) {
    try {
      state.usuario = JSON.parse(guardado);
      mostrarApp();
    } catch { /* ignorar sesión corrupta */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
