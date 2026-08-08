/* =====================================================================
   FlowPos (Local) -- frontend. Vanilla JS, sin frameworks ni CDN: todo debe
   funcionar sin conexión a internet, sirviéndose desde esta misma app.
   ===================================================================== */

const API = '/api';

const state = {
  usuario: null,
  vista: 'ventas',
  pinBuffer: '',
  cuentaAbiertaId: null,
  cierreVista: 'actual',
  cierreDetalleId: null,
  movimientosFiltro: { insumo_id: '', tipo: '', desde: '', hasta: '' },
  dashboardRango: 30,
};

let intervaloBillar = null;

// ---------------------------------------------------------------------
// Permisos (misma matriz que app/roles.py -- si cambia una, cambia la otra)
// ---------------------------------------------------------------------

const REGLAS_PERMISOS = {
  ver_insumos: ['administrador', 'gerente'],
  operar_caja: ['administrador', 'gerente'],
  solo_gerente: ['gerente'],
};

function puede(seccion) {
  const rol = state.usuario && state.usuario.rol;
  const permitidos = REGLAS_PERMISOS[seccion];
  return permitidos ? permitidos.includes(rol) : true;
}

function conUsuario(path) {
  const separador = path.includes('?') ? '&' : '?';
  return `${path}${separador}usuario_id=${state.usuario.id}`;
}

// Debe coincidir con TIPO_MOVIMIENTO_LABEL en app/routers/reportes.py
const TIPO_MOVIMIENTO_LABEL = {
  entrada_compra: 'Entrada por compra',
  salida_venta: 'Salida por venta',
  reversa_cancelacion: 'Reversa (cancelación)',
  salida_consumo_interno: 'Salida — consumo interno',
  salida_merma: 'Salida — merma/rotura',
  salida_otro: 'Salida — otro',
  ajuste_conteo: 'Ajuste por conteo',
};

function _badgeTipoMovimiento(tipo) {
  const positivo = tipo === 'entrada_compra' || tipo === 'reversa_cancelacion' || tipo === 'ajuste_conteo';
  const clase = tipo.startsWith('salida') ? 'badge-rojo' : (positivo ? 'badge-verde' : 'badge-gris');
  return `<span class="badge ${clase}">${escapeHtml(TIPO_MOVIMIENTO_LABEL[tipo] || tipo)}</span>`;
}

function _tablaMovimientos(movimientos, { mostrarInsumo = true } = {}) {
  if (!movimientos || movimientos.length === 0) {
    return '<p class="vacio">Sin movimientos registrados.</p>';
  }
  const filas = movimientos.map((m) => `
    <tr>
      <td class="card-meta">${escapeHtml(m.created_at)}</td>
      ${mostrarInsumo ? `<td>${escapeHtml(m.insumo_nombre)}</td>` : ''}
      <td>${_badgeTipoMovimiento(m.tipo)}</td>
      <td class="${m.cantidad < 0 ? 'alerta-bajo-minimo' : ''}">${m.cantidad > 0 ? '+' : ''}${m.cantidad} ${escapeHtml(m.unidad_medida)}</td>
      <td class="card-meta">${m.cantidad_resultante} ${escapeHtml(m.unidad_medida)}</td>
      <td class="card-meta">${escapeHtml(m.usuario_nombre)}</td>
      <td class="card-meta">${escapeHtml(m.nota || '—')}</td>
    </tr>
  `).join('');
  return `
    <table>
      <thead><tr>
        <th>Fecha</th>
        ${mostrarInsumo ? '<th>Insumo</th>' : ''}
        <th>Tipo</th><th>Cantidad</th><th>Resultante</th><th>Usuario</th><th>Nota</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------
// Utilidades
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
    throw new Error('No se pudo conectar con el servidor local. ¿Sigue corriendo la aplicación?');
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

function mostrarModal(contenidoHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="overlay-panel">${contenidoHtml}</div>`;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  document.body.appendChild(overlay);
  function cerrar() { overlay.remove(); }
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
    localStorage.setItem('pos_usuario', JSON.stringify(usuario));
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
  document.getElementById('usuario-actual').textContent = `${state.usuario.nombre} · ${state.usuario.rol}`;
  document.querySelectorAll('.nav-btn[data-permiso]').forEach((el) => {
    el.classList.toggle('oculto', !puede(el.dataset.permiso));
  });
  document.getElementById('btn-config').classList.toggle('oculto', !puede('solo_gerente'));
  cambiarVista('ventas');
  reiniciarControlInactividad();
}

function cerrarSesion(motivo) {
  state.usuario = null;
  state.cuentaAbiertaId = null;
  localStorage.removeItem('pos_usuario');
  if (intervaloBillar) { clearInterval(intervaloBillar); intervaloBillar = null; }
  detenerControlInactividad();
  document.getElementById('app-shell').classList.add('oculto');
  document.getElementById('vista-login').classList.remove('oculto');
  const errorEl = document.getElementById('pin-error');
  if (motivo === 'inactividad' && errorEl) {
    errorEl.textContent = 'Tu sesión se cerró sola por inactividad. Ingresa tu PIN de nuevo.';
  }
}

// ---------------------------------------------------------------------
// Control de inactividad -- cada usuario tiene su propio tiempo
// (state.usuario.timeout_inactividad_minutos, configurable por el
// Gerente en Configuración). Avisa 1 minuto antes de cerrar, para no
// tirar a la basura un pedido a medio escribir.
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
  if (document.getElementById('aviso-inactividad')) return;
  const el = document.createElement('div');
  el.id = 'aviso-inactividad';
  el.className = 'aviso-inactividad';
  el.innerHTML = `
    <span>⏳ Tu sesión se cerrará pronto por inactividad.</span>
    <button type="button" id="aviso-inactividad-seguir" class="btn btn-chico btn-primario">Seguir conectado</button>
  `;
  document.body.appendChild(el);
  document.getElementById('aviso-inactividad-seguir').addEventListener('click', reiniciarControlInactividad);
}

function ocultarAvisoInactividad() {
  const el = document.getElementById('aviso-inactividad');
  if (el) el.remove();
}

function registrarActividadGlobal() {
  let ultimoReset = 0;
  const marcarActividad = () => {
    if (!state.usuario) return;
    const ahora = Date.now();
    // Throttle: no reiniciar el timer más de una vez cada 5s -- no hace
    // falta reaccionar a cada tecla individual, solo saber que hubo
    // actividad reciente.
    if (ahora - ultimoReset < 5000) return;
    ultimoReset = ahora;
    // Mientras el aviso está visible, solo el botón "Seguir conectado"
    // lo reinicia -- así no desaparece solo con un click accidental
    // que no sea realmente seguir trabajando.
    if (document.getElementById('aviso-inactividad')) return;
    iniciarControlInactividad();
  };
  ['click', 'keydown', 'touchstart', 'scroll'].forEach((evento) => {
    document.addEventListener(evento, marcarActividad, { passive: true });
  });
}

// ---------------------------------------------------------------------
// Navegación / router
// ---------------------------------------------------------------------

function cambiarVista(vista) {
  const boton = document.querySelector(`.nav-btn[data-vista="${vista}"]`);
  const permisoRequerido = boton && boton.dataset.permiso;
  if (permisoRequerido && !puede(permisoRequerido)) {
    toast('Tu rol no tiene acceso a esta sección', 'error');
    return;
  }
  if (intervaloBillar) { clearInterval(intervaloBillar); intervaloBillar = null; }
  state.vista = vista;
  state.cuentaAbiertaId = null;
  state.cierreVista = 'actual';
  state.cierreDetalleId = null;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  render();
}

function render() {
  const main = document.getElementById('app-main');
  const renderers = {
    ventas: renderVentas,
    billar: renderBillar,
    productos: renderProductos,
    insumos: renderInsumos,
    movimientos: renderMovimientos,
    dashboard: renderDashboard,
    cierre: renderCierre,
  };
  renderers[state.vista]().catch((e) => {
    main.innerHTML = `<p class="vacio">${escapeHtml(e.message)}</p>`;
  });
}

// ---------------------------------------------------------------------
// Vista: Ventas / Cuentas
// ---------------------------------------------------------------------

async function renderVentas() {
  if (state.cuentaAbiertaId) return renderDetalleCuenta(state.cuentaAbiertaId);

  const main = document.getElementById('app-main');
  const cierre = await apiFetch('/cierre-caja/actual');
  if (!cierre) {
    main.innerHTML = `
      <div class="panel" style="text-align:center;">
        <h2 style="margin-top:0;">La caja no está abierta</h2>
        <p class="card-meta">No se pueden crear cuentas nuevas ni vender hasta abrir la caja del día.</p>
        <button class="btn btn-primario" id="btn-ir-a-cierre" style="margin-top:10px;">Ir a Cierre de caja</button>
      </div>
    `;
    document.getElementById('btn-ir-a-cierre').addEventListener('click', () => cambiarVista('cierre'));
    return;
  }

  const cuentas = await apiFetch('/cuentas?estado=abierta');

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Cuentas abiertas</h2>
      <button class="btn btn-primario" id="btn-nueva-cuenta">+ Nueva cuenta</button>
    </div>
    <div class="grid-cards" id="grid-cuentas" style="margin-top:14px;"></div>
  `;
  const grid = document.getElementById('grid-cuentas');
  if (cuentas.length === 0) {
    grid.innerHTML = '<p class="vacio">No hay cuentas abiertas. Crea una nueva para empezar a vender.</p>';
  } else {
    cuentas.forEach((c) => {
      const activos = c.items.filter((i) => i.estado !== 'cancelado').length;
      const btn = document.createElement('button');
      btn.className = 'card card-clicable';
      btn.innerHTML = `
        <div class="card-titulo">${escapeHtml(c.referencia)}</div>
        <div class="card-meta">${activos} item(s)</div>
        <div class="monto" style="margin-top:8px;font-size:1.1rem;">${formatoMoneda(c.total)}</div>
        ${c.saldo_pendiente > 0
          ? `<div class="badge badge-ambar" style="margin-top:6px;">Pendiente ${formatoMoneda(c.saldo_pendiente)}</div>`
          : '<div class="badge badge-verde" style="margin-top:6px;">Pagada</div>'}
      `;
      btn.addEventListener('click', () => { state.cuentaAbiertaId = c.id; render(); });
      grid.appendChild(btn);
    });
  }
  document.getElementById('btn-nueva-cuenta').addEventListener('click', abrirModalNuevaCuenta);
}

function abrirModalNuevaCuenta() {
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Nueva cuenta</h3>
    <label>Mesa o nombre del cliente</label>
    <input type="text" id="input-referencia" placeholder="Ej: Mesa 3, Juan..." style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="btn-confirmar-cuenta">Crear</button>
      <button class="btn btn-secundario" id="btn-cancelar-cuenta">Cancelar</button>
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
  const main = document.getElementById('app-main');
  const cuenta = await apiFetch(`/cuentas/${cuentaId}`);
  const abierta = cuenta.estado === 'abierta';

  const itemsHtml = cuenta.items.length === 0
    ? '<p class="vacio">Sin productos todavía.</p>'
    : cuenta.items.map((item) => `
        <div class="item-linea ${item.estado === 'cancelado' ? 'cancelado' : ''}">
          <div>
            <div>${item.cantidad} &times; ${escapeHtml(item.producto_nombre)}</div>
            <div class="card-meta">${item.estado}</div>
          </div>
          <div class="fila">
            <span class="monto">${formatoMoneda(item.subtotal)}</span>
            ${item.estado !== 'cancelado' && abierta
              ? `<button class="btn btn-chico btn-peligro" data-cancelar-item="${item.id}">Cancelar</button>`
              : ''}
          </div>
        </div>
      `).join('');

  main.innerHTML = `
    <button class="btn btn-secundario btn-chico" id="btn-volver">&larr; Cuentas</button>
    <div class="panel" style="margin-top:12px;">
      <div class="fila-entre">
        <h2 style="margin:0;">${escapeHtml(cuenta.referencia)}</h2>
        <span class="badge ${abierta ? 'badge-ambar' : 'badge-verde'}">${cuenta.estado}</span>
      </div>
      <div class="lista-items" style="margin-top:14px;">${itemsHtml}</div>
      <div class="fila-entre" style="border-top:1px solid var(--borde);padding-top:12px;">
        <strong>Total</strong>
        <span class="monto" style="font-size:1.2rem;">${formatoMoneda(cuenta.total)}</span>
      </div>
      <div class="fila-entre">
        <span class="card-meta">Pagado</span>
        <span class="monto">${formatoMoneda(cuenta.total_pagado)}</span>
      </div>
      <div class="fila-entre">
        <span class="card-meta">Saldo pendiente</span>
        <span class="monto" style="color:${cuenta.saldo_pendiente > 0 ? 'var(--rojo)' : 'var(--verde)'};">${formatoMoneda(cuenta.saldo_pendiente)}</span>
      </div>
      ${abierta ? `
        <div class="fila" style="margin-top:14px;">
          <button class="btn btn-primario" id="btn-agregar-producto">+ Agregar producto</button>
          <button class="btn btn-secundario" id="btn-agregar-pago">Registrar pago</button>
          <button class="btn btn-verde" id="btn-cerrar-cuenta" ${cuenta.saldo_pendiente > 0 ? 'disabled' : ''}>Cerrar cuenta</button>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('btn-volver').addEventListener('click', () => { state.cuentaAbiertaId = null; render(); });
  if (abierta) {
    document.getElementById('btn-agregar-producto').addEventListener('click', () => abrirModalAgregarProducto(cuentaId));
    document.getElementById('btn-agregar-pago').addEventListener('click', () => abrirModalPago(cuentaId, cuenta.saldo_pendiente));
    document.getElementById('btn-cerrar-cuenta').addEventListener('click', () => cerrarCuenta(cuentaId));
    main.querySelectorAll('[data-cancelar-item]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalCancelarItem(cuentaId, btn.dataset.cancelarItem));
    });
  }
}

async function abrirModalAgregarProducto(cuentaId) {
  const productos = (await apiFetch('/productos')).filter((p) => p.tipo !== 'servicio');
  const categorias = [...new Set(productos.map((p) => p.categoria))];
  const listaHtml = categorias.map((cat) => `
    <h4 style="margin:14px 0 8px;color:var(--texto-tenue);text-transform:uppercase;font-size:0.78rem;">${cat}</h4>
    <div class="col">
      ${productos.filter((p) => p.categoria === cat).map((p) => `
        <div class="card" data-producto-card="${p.id}">
          <button class="fila-entre producto-picker-header" data-producto-id="${p.id}" style="width:100%;background:none;border:none;color:inherit;padding:0;text-align:left;">
            <span>${escapeHtml(p.nombre)}</span>
            <span class="monto">${formatoMoneda(p.precio_venta)}</span>
          </button>
          <div class="producto-picker-cantidad oculto" style="margin-top:10px;">
            <div class="fila-entre">
              <div class="fila">
                <button class="btn btn-chico btn-secundario" data-decrementar type="button">−</button>
                <span class="monto cantidad-valor" style="min-width:24px;text-align:center;display:inline-block;">1</span>
                <button class="btn btn-chico btn-secundario" data-incrementar type="button">+</button>
              </div>
              <button class="btn btn-chico btn-primario" data-confirmar-cantidad type="button">Agregar</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');

  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Agregar producto</h3>
    <div style="max-height:60vh;overflow-y:auto;">${listaHtml || '<p class="vacio">No hay productos activos. Créalos en el panel de Productos.</p>'}</div>
    <button class="btn btn-secundario btn-bloque" id="btn-cerrar-modal" style="margin-top:14px;">Cerrar</button>
  `);
  document.getElementById('btn-cerrar-modal').addEventListener('click', modal.cerrar);

  modal.overlay.querySelectorAll('[data-producto-card]').forEach((card) => {
    const panelCantidad = card.querySelector('.producto-picker-cantidad');
    const valorEl = card.querySelector('.cantidad-valor');
    let cantidad = 1;

    const actualizarValor = () => { valorEl.textContent = String(cantidad); };

    card.querySelector('[data-producto-id]').addEventListener('click', () => {
      const yaAbierto = !panelCantidad.classList.contains('oculto');
      modal.overlay.querySelectorAll('.producto-picker-cantidad').forEach((el) => el.classList.add('oculto'));
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
    <h3 style="margin-top:0;">Cancelar producto</h3>
    <label>Motivo (obligatorio)</label>
    <input type="text" id="input-motivo" placeholder="Ej: pedido duplicado, cliente cambió de opinión..." style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-peligro" id="btn-confirmar-cancelar">Confirmar cancelación</button>
      <button class="btn btn-secundario" id="btn-volver-modal">Volver</button>
    </div>
  `);
  document.getElementById('btn-volver-modal').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-cancelar').addEventListener('click', async () => {
    const motivo = document.getElementById('input-motivo').value.trim();
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
    <h3 style="margin-top:0;">Registrar pago</h3>
    <p class="card-meta">Saldo pendiente: <span class="monto">${formatoMoneda(saldoPendiente)}</span></p>
    <label>Método</label>
    <select id="sel-metodo" style="width:100%;margin-bottom:12px;">
      <option value="efectivo">Efectivo</option>
      <option value="transferencia">Transferencia</option>
    </select>
    <label>Moneda</label>
    <select id="sel-moneda" style="width:100%;margin-bottom:12px;">
      <option value="CUP">CUP</option>
      <option value="USD">USD</option>
      <option value="MLC">MLC</option>
    </select>
    <div id="campo-subtipo" class="oculto">
      <label>Subtipo de transferencia</label>
      <select id="sel-subtipo" style="width:100%;margin-bottom:12px;">
        <option value="fiscal">Fiscal</option>
        <option value="libre">Libre</option>
      </select>
    </div>
    <div id="campo-tasa" class="oculto">
      <label>Tasa de cambio (CUP por unidad)</label>
      <input type="number" id="input-tasa" step="0.01" min="0" style="width:100%;margin-bottom:12px;" />
    </div>
    <label>Monto (en la moneda seleccionada)</label>
    <input type="number" id="input-monto" step="0.01" min="0.01" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="btn-confirmar-pago">Registrar</button>
      <button class="btn btn-secundario" id="btn-cancelar-pago">Cancelar</button>
    </div>
  `);

  const selMetodo = document.getElementById('sel-metodo');
  const selMoneda = document.getElementById('sel-moneda');
  const campoSubtipo = document.getElementById('campo-subtipo');
  const campoTasa = document.getElementById('campo-tasa');

  function actualizarCampos() {
    campoSubtipo.classList.toggle('oculto', selMetodo.value !== 'transferencia');
    campoTasa.classList.toggle('oculto', selMoneda.value === 'CUP');
  }
  selMetodo.addEventListener('change', actualizarCampos);
  selMoneda.addEventListener('change', actualizarCampos);

  document.getElementById('btn-cancelar-pago').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-pago').addEventListener('click', async () => {
    const monto = Math.round(parseFloat(document.getElementById('input-monto').value || '0') * 100);
    if (!monto || monto <= 0) { toast('Monto inválido', 'error'); return; }
    const body = { metodo: selMetodo.value, moneda: selMoneda.value, monto, usuario_id: state.usuario.id };
    if (selMetodo.value === 'transferencia') body.subtipo = document.getElementById('sel-subtipo').value;
    if (selMoneda.value !== 'CUP') {
      const tasa = Math.round(parseFloat(document.getElementById('input-tasa').value || '0') * 100);
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
  const main = document.getElementById('app-main');
  const [mesas, cuentasAbiertas, cierre] = await Promise.all([
    apiFetch('/mesas-billar'),
    apiFetch('/cuentas?estado=abierta'),
    apiFetch('/cierre-caja/actual'),
  ]);
  const cajaAbierta = cierre !== null;
  const puedeGestionarMesas = puede('solo_gerente');

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Mesas de billar</h2>
      ${puedeGestionarMesas ? '<button class="btn btn-primario btn-chico" id="btn-nueva-mesa">+ Nueva mesa</button>' : ''}
    </div>
    ${cajaAbierta ? '' : '<p class="vacio" style="text-align:left;padding:14px 0 0;">La caja no está abierta: puedes finalizar sesiones en curso, pero no iniciar nuevas hasta abrir la caja.</p>'}
    <div class="grid-cards" id="grid-mesas" style="margin-top:14px;"></div>
  `;
  const grid = document.getElementById('grid-mesas');
  if (puedeGestionarMesas) {
    document.getElementById('btn-nueva-mesa').addEventListener('click', () => abrirModalMesa(null));
  }

  if (intervaloBillar) { clearInterval(intervaloBillar); intervaloBillar = null; }
  const timers = [];

  for (const mesa of mesas) {
    const div = document.createElement('div');
    div.className = 'card';
    let sesion = null;
    if (mesa.estado === 'ocupada') {
      sesion = await apiFetch(`/mesas-billar/${mesa.id}/sesion-activa`);
    }
    const configTexto = mesa.modo_default === 'temporizador'
      ? `⏳ ${(mesa.limite_minutos_default / 60).toFixed(2).replace(/\.00$/, '')}h por defecto`
      : '⏱️ Cronómetro por defecto';
    div.innerHTML = `
      <div class="fila-entre">
        <span class="card-titulo">${escapeHtml(mesa.nombre)}</span>
        <span class="badge ${mesa.estado === 'libre' ? 'badge-verde' : 'badge-ambar'}">${mesa.estado}</span>
      </div>
      <div class="card-meta">${formatoMoneda(mesa.tarifa_por_minuto)}/min · ${configTexto}</div>
      ${sesion ? `
        <div class="timer-mesa" data-timer-inicio="${sesion.hora_inicio}" data-timer-modo="${sesion.modo}" data-timer-limite="${sesion.limite_minutos || ''}">00:00</div>
        <div class="card-meta">${sesion.politica_cobro === 'hora_completa' ? 'Cobro por hora completa' : 'Cobro por tiempo exacto'}</div>
      ` : ''}
      <div class="mesa-acciones" style="margin-top:10px;"></div>
    `;
    const acciones = div.querySelector('.mesa-acciones');
    if (mesa.estado === 'libre') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primario btn-bloque';
      btn.textContent = 'Iniciar sesión';
      btn.disabled = !cajaAbierta;
      if (!cajaAbierta) btn.title = 'Abre la caja primero';
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
    if (puedeGestionarMesas) {
      const btnEditar = document.createElement('button');
      btnEditar.className = 'btn btn-secundario btn-chico btn-bloque';
      btnEditar.textContent = 'Editar mesa';
      btnEditar.style.marginTop = '6px';
      btnEditar.addEventListener('click', () => abrirModalMesa(mesa));
      acciones.appendChild(btnEditar);
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
        el.classList.toggle('timer-cumplido', cumplido);
      } else {
        const mm = String(Math.floor(transcurridoSeg / 60)).padStart(2, '0');
        const ss = String(transcurridoSeg % 60).padStart(2, '0');
        el.textContent = `${mm}:${ss}`;
        el.classList.remove('timer-cumplido');
      }
    });
  }
  actualizarTimers();
  if (timers.length > 0) intervaloBillar = setInterval(actualizarTimers, 1000);
}

function abrirModalMesa(mesa) {
  const esNueva = mesa === null;
  const tarifaHora = esNueva ? '' : ((mesa.tarifa_por_minuto * 60) / 100).toFixed(2);
  let modo = esNueva ? 'cronometro' : mesa.modo_default;
  let politica = esNueva ? 'exacto' : mesa.politica_cobro_default;
  let limiteHoras = esNueva ? '2' : (mesa.limite_minutos_default ? (mesa.limite_minutos_default / 60).toFixed(2).replace(/\.00$/, '') : '2');

  const modal = mostrarModal(`
    <h3 style="margin-top:0;">${esNueva ? 'Nueva mesa' : `Editar — ${escapeHtml(mesa.nombre)}`}</h3>
    <label>Nombre</label>
    <input type="text" id="mb-nombre" value="${esNueva ? '' : escapeHtml(mesa.nombre)}" style="width:100%;margin-bottom:10px;" />
    <label>Tarifa (CUP por hora)</label>
    <input type="number" id="mb-tarifa" step="0.01" min="0" value="${tarifaHora}" style="width:100%;margin-bottom:16px;" />

    <label>Modo de juego por defecto</label>
    <div class="fila" id="mb-modo-botones" style="margin-bottom:6px;">
      <button type="button" class="btn btn-chico ${modo === 'cronometro' ? 'btn-primario' : 'btn-secundario'}" data-modo="cronometro">⏱️ Cronómetro (sin límite)</button>
      <button type="button" class="btn btn-chico ${modo === 'temporizador' ? 'btn-primario' : 'btn-secundario'}" data-modo="temporizador">⏳ Temporizador (con límite)</button>
    </div>
    <p class="card-meta" style="margin:0 0 10px;">Cronómetro cuenta hacia arriba sin tope. Temporizador pone un límite y avisa cuando se cumple (no cobra ni cierra solo).</p>

    <div id="mb-limite-cont" style="${modo === 'temporizador' ? '' : 'display:none;'}margin-bottom:14px;">
      <label>Límite por defecto (horas)</label>
      <div class="fila" style="margin-bottom:8px;">
        ${[1, 1.5, 2, 3].map((h) => `<button type="button" class="btn btn-chico btn-secundario" data-limite-rapido="${h}">${h}h</button>`).join('')}
      </div>
      <input type="number" id="mb-limite-horas" step="0.25" min="0.25" value="${limiteHoras}" style="width:100%;" />
    </div>

    <label>Política de cobro por defecto</label>
    <div class="fila" id="mb-politica-botones" style="margin-bottom:6px;">
      <button type="button" class="btn btn-chico ${politica === 'exacto' ? 'btn-primario' : 'btn-secundario'}" data-politica="exacto">Por tiempo exacto</button>
      <button type="button" class="btn btn-chico ${politica === 'hora_completa' ? 'btn-primario' : 'btn-secundario'}" data-politica="hora_completa">Por hora completa</button>
    </div>
    <p class="card-meta" style="margin:0 0 16px;">"Por hora completa": si empiezan a jugar la hora siguiente, esa hora se cobra entera aunque no la completen. "Por tiempo exacto": se cobra el minuto real jugado, nada más.</p>

    <div class="fila">
      <button class="btn btn-primario" id="mb-guardar">Guardar</button>
      ${esNueva ? '' : '<button class="btn btn-peligro" id="mb-desactivar">Desactivar mesa</button>'}
      <button class="btn btn-secundario" id="mb-cancelar">Cancelar</button>
    </div>
  `);

  document.querySelectorAll('#mb-modo-botones [data-modo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      modo = btn.dataset.modo;
      document.querySelectorAll('#mb-modo-botones [data-modo]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mb-modo-botones [data-modo]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
      document.getElementById('mb-limite-cont').style.display = modo === 'temporizador' ? '' : 'none';
    });
  });
  document.querySelectorAll('#mb-politica-botones [data-politica]').forEach((btn) => {
    btn.addEventListener('click', () => {
      politica = btn.dataset.politica;
      document.querySelectorAll('#mb-politica-botones [data-politica]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mb-politica-botones [data-politica]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
    });
  });
  document.querySelectorAll('[data-limite-rapido]').forEach((btn) => {
    btn.addEventListener('click', () => { document.getElementById('mb-limite-horas').value = btn.dataset.limiteRapido; });
  });

  document.getElementById('mb-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('mb-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('mb-nombre').value.trim();
    const tarifaHoraCup = parseFloat(document.getElementById('mb-tarifa').value || '0');
    if (!nombre) { toast('Escribe un nombre', 'error'); return; }
    if (!tarifaHoraCup || tarifaHoraCup <= 0) { toast('Indica una tarifa válida', 'error'); return; }
    const tarifaPorMinuto = Math.round((tarifaHoraCup * 100) / 60);

    let limiteMinutosDefault = null;
    if (modo === 'temporizador') {
      const horas = parseFloat(document.getElementById('mb-limite-horas').value || '0');
      if (!horas || horas <= 0) { toast('Indica un límite de horas válido', 'error'); return; }
      limiteMinutosDefault = Math.round(horas * 60);
    }

    const body = {
      nombre, tarifa_por_minuto: tarifaPorMinuto, usuario_id: state.usuario.id,
      modo_default: modo, limite_minutos_default: limiteMinutosDefault, politica_cobro_default: politica,
    };
    try {
      if (esNueva) {
        await apiFetch('/mesas-billar', { method: 'POST', body });
        toast('Mesa creada', 'exito');
      } else {
        await apiFetch(`/mesas-billar/${mesa.id}`, { method: 'PUT', body });
        toast('Mesa actualizada', 'exito');
      }
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
  if (!esNueva) {
    document.getElementById('mb-desactivar').addEventListener('click', async () => {
      if (!confirm(`¿Desactivar "${mesa.nombre}"? Dejará de aparecer en Billar.`)) return;
      try {
        await apiFetch(`/mesas-billar/${mesa.id}`, {
          method: 'PUT',
          body: { activo: false, usuario_id: state.usuario.id },
        });
        toast('Mesa desactivada', 'exito');
        modal.cerrar();
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}

function abrirModalIniciarBillar(mesa, cuentasAbiertas) {
  const opciones = cuentasAbiertas.map((c) => `<option value="${c.id}">${escapeHtml(c.referencia)}</option>`).join('');
  let modo = mesa.modo_default;
  let politica = mesa.politica_cobro_default;
  let limiteHoras = mesa.limite_minutos_default ? (mesa.limite_minutos_default / 60).toFixed(2).replace(/\.00$/, '') : '2';

  const resumenTexto = () => {
    const partes = [modo === 'temporizador' ? `Temporizador ${limiteHoras}h` : 'Cronómetro (sin límite)'];
    partes.push(politica === 'hora_completa' ? 'cobro por hora completa' : 'cobro por tiempo exacto');
    return partes.join(' · ');
  };

  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Iniciar sesión — ${escapeHtml(mesa.nombre)}</h3>
    ${cuentasAbiertas.length > 0 ? `
      <label>Cuenta existente</label>
      <select id="sel-cuenta-billar" style="width:100%;margin-bottom:14px;">${opciones}</select>
      <div class="card-meta" style="margin-bottom:10px;">— o —</div>
    ` : ''}
    <label>Nueva cuenta (mesa o nombre del cliente)</label>
    <input type="text" id="input-nueva-referencia" placeholder="Ej: Mesa de billar 1" style="width:100%;margin-bottom:14px;" />

    <div class="fila-entre" style="background:var(--bg-panel-alto);border-radius:10px;padding:10px 12px;margin-bottom:6px;">
      <span id="mib-resumen" class="card-meta">${resumenTexto()}</span>
      <button type="button" class="btn btn-chico btn-secundario" id="mib-cambiar">Cambiar</button>
    </div>
    <div id="mib-config" class="oculto" style="margin-top:10px;">
      <label>Modo de juego</label>
      <div class="fila" id="mib-modo-botones" style="margin-bottom:6px;">
        <button type="button" class="btn btn-chico ${modo === 'cronometro' ? 'btn-primario' : 'btn-secundario'}" data-modo="cronometro">⏱️ Cronómetro</button>
        <button type="button" class="btn btn-chico ${modo === 'temporizador' ? 'btn-primario' : 'btn-secundario'}" data-modo="temporizador">⏳ Temporizador</button>
      </div>
      <div id="mib-limite-cont" style="${modo === 'temporizador' ? '' : 'display:none;'}margin-bottom:10px;">
        <label>Límite (horas)</label>
        <div class="fila" style="margin-bottom:8px;">
          ${[1, 1.5, 2, 3].map((h) => `<button type="button" class="btn btn-chico btn-secundario" data-limite-rapido="${h}">${h}h</button>`).join('')}
        </div>
        <input type="number" id="mib-limite-horas" step="0.25" min="0.25" value="${limiteHoras}" style="width:100%;" />
      </div>
      <label>Política de cobro</label>
      <div class="fila" id="mib-politica-botones" style="margin-bottom:16px;">
        <button type="button" class="btn btn-chico ${politica === 'exacto' ? 'btn-primario' : 'btn-secundario'}" data-politica="exacto">Tiempo exacto</button>
        <button type="button" class="btn btn-chico ${politica === 'hora_completa' ? 'btn-primario' : 'btn-secundario'}" data-politica="hora_completa">Hora completa</button>
      </div>
    </div>

    <div class="fila">
      <button class="btn btn-primario" id="btn-confirmar-billar">Iniciar</button>
      <button class="btn btn-secundario" id="btn-cancelar-billar">Cancelar</button>
    </div>
  `);

  document.getElementById('mib-cambiar').addEventListener('click', () => {
    document.getElementById('mib-config').classList.toggle('oculto');
  });
  document.querySelectorAll('#mib-modo-botones [data-modo]').forEach((btn) => {
    btn.addEventListener('click', () => {
      modo = btn.dataset.modo;
      document.querySelectorAll('#mib-modo-botones [data-modo]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mib-modo-botones [data-modo]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
      document.getElementById('mib-limite-cont').style.display = modo === 'temporizador' ? '' : 'none';
      document.getElementById('mib-resumen').textContent = resumenTexto();
    });
  });
  document.querySelectorAll('#mib-politica-botones [data-politica]').forEach((btn) => {
    btn.addEventListener('click', () => {
      politica = btn.dataset.politica;
      document.querySelectorAll('#mib-politica-botones [data-politica]').forEach((b) => b.classList.toggle('btn-primario', b === btn));
      document.querySelectorAll('#mib-politica-botones [data-politica]').forEach((b) => b.classList.toggle('btn-secundario', b !== btn));
      document.getElementById('mib-resumen').textContent = resumenTexto();
    });
  });
  document.querySelectorAll('[data-limite-rapido]').forEach((btn) => {
    btn.addEventListener('click', () => {
      limiteHoras = btn.dataset.limiteRapido;
      document.getElementById('mib-limite-horas').value = limiteHoras;
      document.getElementById('mib-resumen').textContent = resumenTexto();
    });
  });
  document.getElementById('mib-limite-horas').addEventListener('input', (e) => {
    limiteHoras = e.target.value;
    document.getElementById('mib-resumen').textContent = resumenTexto();
  });

  document.getElementById('btn-cancelar-billar').addEventListener('click', modal.cerrar);
  document.getElementById('btn-confirmar-billar').addEventListener('click', async () => {
    try {
      let cuentaId;
      const referenciaNueva = document.getElementById('input-nueva-referencia').value.trim();
      if (referenciaNueva) {
        const cuenta = await apiFetch('/cuentas', {
          method: 'POST',
          body: { referencia: referenciaNueva, operador_apertura_id: state.usuario.id },
        });
        cuentaId = cuenta.id;
      } else {
        const sel = document.getElementById('sel-cuenta-billar');
        if (!sel || !sel.value) { toast('Elige una cuenta o escribe una nueva', 'error'); return; }
        cuentaId = Number(sel.value);
      }
      const body = { cuenta_id: cuentaId, modo, politica_cobro: politica };
      if (modo === 'temporizador') {
        const horas = parseFloat(document.getElementById('mib-limite-horas').value || '0');
        if (!horas || horas <= 0) { toast('Indica un límite de horas válido', 'error'); return; }
        body.limite_minutos = Math.round(horas * 60);
      }
      await apiFetch(`/mesas-billar/${mesa.id}/iniciar`, { method: 'POST', body });
      toast('Sesión iniciada', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function finalizarBillar(mesaId) {
  if (!confirm('¿Finalizar esta sesión de billar? El tiempo se cobrará a la cuenta asociada.')) return;
  try {
    const resultado = await apiFetch(`/mesas-billar/${mesaId}/finalizar`, {
      method: 'POST',
      body: { usuario_id: state.usuario.id },
    });
    const detalleTiempo = resultado.minutos_facturados !== resultado.minutos_calculados
      ? `${resultado.minutos_calculados} min jugados, se cobran ${resultado.minutos_facturados} min (hora completa)`
      : `${resultado.minutos_calculados} min`;
    toast(`Sesión finalizada: ${detalleTiempo}, ${formatoMoneda(resultado.monto_calculado)}`, 'exito');
    render();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------
// Vista: Productos (admin)
// ---------------------------------------------------------------------

async function renderProductos() {
  const main = document.getElementById('app-main');
  const puedeEditar = puede('solo_gerente');
  const puedeVerReceta = puede('ver_insumos');

  const productos = await apiFetch('/productos');
  const insumos = puedeVerReceta ? await apiFetch(conUsuario('/insumos')) : [];
  const recetas = puedeVerReceta
    ? await Promise.all(productos.map((p) => apiFetch(conUsuario(`/productos/${p.id}/receta`))))
    : productos.map(() => []);
  const recetaPorProducto = {};
  productos.forEach((p, idx) => { recetaPorProducto[p.id] = recetas[idx]; });

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Productos</h2>
      ${puedeEditar ? '<button class="btn btn-primario" id="btn-nuevo-producto">+ Nuevo producto</button>' : ''}
    </div>
    <div class="panel" style="margin-top:14px;">
      <table>
        <thead><tr><th>Nombre</th><th>Categoría</th><th>Precio</th><th>Receta</th><th>Última edición</th><th>Estado</th>${puedeEditar ? '<th></th>' : ''}</tr></thead>
        <tbody id="tbody-productos"></tbody>
      </table>
    </div>
  `;
  const tbody = document.getElementById('tbody-productos');
  productos.forEach((p) => {
    const tr = document.createElement('tr');
    const autor = p.actualizado_por_nombre || p.creado_por_nombre || '—';
    const receta = recetaPorProducto[p.id] || [];
    const recetaTexto = puedeVerReceta
      ? (receta.length
          ? receta.map((r) => `${escapeHtml(r.insumo_nombre)} (${r.cantidad_requerida}${r.unidad_medida})`).join(', ')
          : 'sin receta')
      : '—';
    tr.innerHTML = `
      <td>${escapeHtml(p.nombre)}</td>
      <td>${p.categoria}</td>
      <td class="monto">${formatoMoneda(p.precio_venta)}</td>
      <td class="card-meta">${recetaTexto}</td>
      <td class="card-meta">${escapeHtml(autor)}</td>
      <td><span class="badge ${p.activo ? 'badge-verde' : 'badge-gris'}">${p.activo ? 'activo' : 'inactivo'}</span></td>
      ${puedeEditar ? `
        <td>
          <div class="fila">
            <button class="btn btn-chico btn-secundario" data-editar-producto="${p.id}">Editar</button>
            <button class="btn btn-chico btn-secundario" data-historial-producto="${p.id}">Historial</button>
            <button class="btn btn-chico btn-secundario" data-toggle-producto="${p.id}" data-activo="${p.activo}">${p.activo ? 'Desactivar' : 'Activar'}</button>
          </div>
        </td>
      ` : ''}
    `;
    tbody.appendChild(tr);
  });

  if (!puedeEditar) return;

  tbody.querySelectorAll('[data-toggle-producto]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(`/productos/${btn.dataset.toggleProducto}`, {
          method: 'PUT',
          body: { activo: btn.dataset.activo !== 'true', usuario_id: state.usuario.id },
        });
        toast('Producto actualizado', 'exito');
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  tbody.querySelectorAll('[data-editar-producto]').forEach((btn) => {
    const p = productos.find((x) => x.id === Number(btn.dataset.editarProducto));
    btn.addEventListener('click', () => abrirModalEditarProducto(p, recetaPorProducto[p.id] || [], insumos));
  });
  tbody.querySelectorAll('[data-historial-producto]').forEach((btn) => {
    const p = productos.find((x) => x.id === Number(btn.dataset.historialProducto));
    btn.addEventListener('click', () => abrirModalHistorialPrecios(p));
  });
  document.getElementById('btn-nuevo-producto').addEventListener('click', () => abrirModalNuevoProducto(insumos));
}

function _construirLineasReceta(contenedor, insumos, recetaActual) {
  const opcionesInsumo = insumos.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)} (${i.unidad_medida})</option>`).join('');
  function agregarLinea(insumoId, cantidad) {
    const linea = document.createElement('div');
    linea.className = 'fila';
    linea.innerHTML = `
      <select class="receta-linea-insumo" style="flex:2;">${opcionesInsumo}</select>
      <input type="number" class="receta-linea-cantidad" placeholder="cantidad" min="1" value="${cantidad || ''}" style="flex:1;" />
      <button class="btn btn-chico btn-peligro" type="button">&times;</button>
    `;
    if (insumoId) linea.querySelector('.receta-linea-insumo').value = insumoId;
    linea.querySelector('button').addEventListener('click', () => linea.remove());
    contenedor.appendChild(linea);
  }
  (recetaActual || []).forEach((r) => agregarLinea(r.insumo_id, r.cantidad_requerida));
  return agregarLinea;
}

function _leerLineasReceta(contenedor) {
  const receta = [];
  for (const linea of contenedor.children) {
    const insumoId = Number(linea.querySelector('.receta-linea-insumo').value);
    const cantidad = Number(linea.querySelector('.receta-linea-cantidad').value);
    if (!cantidad || cantidad <= 0) throw new Error('Revisa las cantidades de la receta');
    receta.push({ insumo_id: insumoId, cantidad_requerida: cantidad });
  }
  return receta;
}

function abrirModalEditarProducto(producto, recetaActual, insumos) {
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Editar — ${escapeHtml(producto.nombre)}</h3>
    <label>Nombre</label>
    <input type="text" id="ep-nombre" value="${escapeHtml(producto.nombre)}" style="width:100%;margin-bottom:10px;" />
    <label>Precio de venta (CUP)</label>
    <input type="number" id="ep-precio" step="0.01" min="0" value="${(producto.precio_venta / 100).toFixed(2)}" style="width:100%;margin-bottom:16px;" />
    ${producto.tipo !== 'servicio' ? `
      <div class="fila-entre">
        <strong style="font-size:0.85rem;color:var(--texto-tenue);">RECETA</strong>
        <button class="btn btn-chico btn-secundario" id="ep-add-linea" type="button">+ insumo</button>
      </div>
      <div id="ep-receta-lineas" class="col" style="margin:8px 0 16px;"></div>
    ` : ''}
    <div class="fila">
      <button class="btn btn-primario" id="ep-guardar">Guardar cambios</button>
      <button class="btn btn-secundario" id="ep-cancelar">Cancelar</button>
    </div>
  `);

  let agregarLinea = null;
  const lineasDiv = document.getElementById('ep-receta-lineas');
  if (lineasDiv) {
    agregarLinea = _construirLineasReceta(lineasDiv, insumos, recetaActual);
    document.getElementById('ep-add-linea').addEventListener('click', () => agregarLinea());
  }

  document.getElementById('ep-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('ep-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('ep-nombre').value.trim();
    const precio = Math.round(parseFloat(document.getElementById('ep-precio').value || '0') * 100);
    if (!nombre) { toast('El nombre no puede quedar vacío', 'error'); return; }
    try {
      await apiFetch(`/productos/${producto.id}`, {
        method: 'PUT',
        body: { nombre, precio_venta: precio, usuario_id: state.usuario.id },
      });
      if (lineasDiv) {
        const receta = _leerLineasReceta(lineasDiv);
        if (receta.length === 0) { toast('La receta necesita al menos un insumo', 'error'); return; }
        await apiFetch(conUsuario(`/productos/${producto.id}/receta`), { method: 'PUT', body: receta });
      }
      toast('Producto actualizado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function abrirModalHistorialPrecios(producto) {
  const historial = await apiFetch(conUsuario(`/productos/${producto.id}/historial-precios`));
  const filas = historial.map((h) => `
    <div class="item-linea">
      <div>
        <div>${formatoMoneda(h.precio_anterior)} &rarr; ${formatoMoneda(h.precio_nuevo)}</div>
        <div class="card-meta">${escapeHtml(h.usuario_nombre)} · ${h.cambiado_at}</div>
      </div>
    </div>
  `).join('');
  mostrarModal(`
    <h3 style="margin-top:0;">Historial de precios — ${escapeHtml(producto.nombre)}</h3>
    <div class="lista-items" style="max-height:60vh;overflow-y:auto;">
      ${filas || '<p class="vacio">Sin cambios de precio registrados todavía.</p>'}
    </div>
  `);
}

function abrirModalNuevoProducto(insumos) {
  const opcionesInsumo = insumos.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)} (${i.unidad_medida})</option>`).join('');
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Nuevo producto</h3>
    <label>Nombre</label>
    <input type="text" id="np-nombre" style="width:100%;margin-bottom:10px;" />
    <label>Categoría</label>
    <select id="np-categoria" style="width:100%;margin-bottom:10px;">
      <option value="bebida">Bebida</option>
      <option value="comida">Comida</option>
      <option value="servicio">Servicio</option>
    </select>
    <label>Tipo</label>
    <select id="np-tipo" style="width:100%;margin-bottom:10px;">
      <option value="directo">Directo (ej. cerveza — descuenta 1 insumo tal cual)</option>
      <option value="compuesto">Compuesto (ej. hamburguesa — receta de varios insumos)</option>
      <option value="servicio">Servicio (no descuenta inventario)</option>
    </select>
    <label>Precio de venta (CUP)</label>
    <input type="number" id="np-precio" step="0.01" min="0" style="width:100%;margin-bottom:10px;" />
    <label class="fila"><input type="checkbox" id="np-preparacion" style="width:auto;" /> Requiere preparación (cocina/barra)</label>
    <div id="np-receta-wrap" style="margin-top:14px;">
      <div class="fila-entre">
        <strong style="font-size:0.85rem;color:var(--texto-tenue);">RECETA</strong>
        <button class="btn btn-chico btn-secundario" id="np-add-linea" type="button">+ insumo</button>
      </div>
      <div id="np-receta-lineas" class="col" style="margin-top:8px;"></div>
    </div>
    <div class="fila" style="margin-top:16px;">
      <button class="btn btn-primario" id="np-guardar">Guardar</button>
      <button class="btn btn-secundario" id="np-cancelar">Cancelar</button>
    </div>
  `);

  const wrap = document.getElementById('np-receta-wrap');
  const lineasDiv = document.getElementById('np-receta-lineas');
  const selTipo = document.getElementById('np-tipo');

  function agregarLinea() {
    if (insumos.length === 0) { toast('Primero crea insumos en el panel de Insumos', 'error'); return; }
    const linea = document.createElement('div');
    linea.className = 'fila';
    linea.innerHTML = `
      <select class="np-linea-insumo" style="flex:2;">${opcionesInsumo}</select>
      <input type="number" class="np-linea-cantidad" placeholder="cantidad" min="1" style="flex:1;" />
      <button class="btn btn-chico btn-peligro" type="button">&times;</button>
    `;
    linea.querySelector('button').addEventListener('click', () => linea.remove());
    lineasDiv.appendChild(linea);
  }
  document.getElementById('np-add-linea').addEventListener('click', agregarLinea);

  function actualizarVisibilidadReceta() {
    wrap.classList.toggle('oculto', selTipo.value === 'servicio');
    if (selTipo.value !== 'servicio' && lineasDiv.children.length === 0) agregarLinea();
  }
  selTipo.addEventListener('change', actualizarVisibilidadReceta);
  actualizarVisibilidadReceta();

  document.getElementById('np-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('np-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('np-nombre').value.trim();
    const precio = Math.round(parseFloat(document.getElementById('np-precio').value || '0') * 100);
    if (!nombre) { toast('Escribe un nombre', 'error'); return; }
    const tipo = selTipo.value;
    const receta = [];
    if (tipo !== 'servicio') {
      for (const linea of lineasDiv.children) {
        const insumoId = Number(linea.querySelector('.np-linea-insumo').value);
        const cantidad = Number(linea.querySelector('.np-linea-cantidad').value);
        if (!cantidad || cantidad <= 0) { toast('Revisa las cantidades de la receta', 'error'); return; }
        receta.push({ insumo_id: insumoId, cantidad_requerida: cantidad });
      }
      if (receta.length === 0) { toast('Agrega al menos un insumo a la receta', 'error'); return; }
    }
    try {
      await apiFetch('/productos', {
        method: 'POST',
        body: {
          nombre,
          categoria: document.getElementById('np-categoria').value,
          tipo,
          precio_venta: precio,
          requiere_preparacion: document.getElementById('np-preparacion').checked,
          receta,
          usuario_id: state.usuario.id,
        },
      });
      toast('Producto creado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Vista: Insumos (admin)
// ---------------------------------------------------------------------

async function renderInsumos() {
  const main = document.getElementById('app-main');
  const insumos = await apiFetch(conUsuario('/insumos'));
  const puedeEditar = puede('solo_gerente');

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Insumos</h2>
      <div class="fila">
        <a class="btn btn-secundario btn-chico" href="${conUsuario('/api/reportes/inventario.xlsx')}" target="_blank">Exportar Excel</a>
        ${puedeEditar ? '<button class="btn btn-primario" id="btn-nuevo-insumo">+ Nuevo insumo</button>' : ''}
      </div>
    </div>
    ${puedeEditar ? '' : '<p class="card-meta" style="margin:6px 0 0;">Tu rol tiene acceso de solo lectura al catálogo de insumos, pero puedes registrar salidas.</p>'}
    <div class="panel" style="margin-top:14px;">
      <table>
        <thead><tr><th>Nombre</th><th>Stock</th><th>Mínimo</th><th>Costo prom.</th><th>Última edición</th><th></th></tr></thead>
        <tbody id="tbody-insumos"></tbody>
      </table>
    </div>
  `;
  const tbody = document.getElementById('tbody-insumos');
  insumos.forEach((i) => {
    const tr = document.createElement('tr');
    const autor = i.actualizado_por_nombre || i.creado_por_nombre || '—';
    tr.innerHTML = `
      <td>${escapeHtml(i.nombre)}</td>
      <td class="${i.bajo_minimo ? 'alerta-bajo-minimo' : ''}">${i.cantidad_actual} ${i.unidad_medida}</td>
      <td>${i.cantidad_minima} ${i.unidad_medida}</td>
      <td class="monto">${formatoMoneda(i.costo_promedio)}</td>
      <td class="card-meta">${escapeHtml(autor)}</td>
      <td>
        <div class="fila">
          ${puedeEditar ? `
            <button class="btn btn-chico btn-secundario" data-editar-insumo="${i.id}">Editar</button>
            <button class="btn btn-chico btn-secundario" data-entrada="${i.id}">Entrada</button>
          ` : ''}
          <button class="btn btn-chico btn-peligro" data-salida="${i.id}">Salida</button>
          <button class="btn btn-chico btn-secundario" data-historial="${i.id}">Historial</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('[data-salida]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalSalidaInsumo(Number(btn.dataset.salida), insumos));
  });
  tbody.querySelectorAll('[data-historial]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalHistorialInsumo(Number(btn.dataset.historial), insumos));
  });
  if (puedeEditar) {
    tbody.querySelectorAll('[data-entrada]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalEntradaInsumo(Number(btn.dataset.entrada), insumos));
    });
    tbody.querySelectorAll('[data-editar-insumo]').forEach((btn) => {
      const i = insumos.find((x) => x.id === Number(btn.dataset.editarInsumo));
      btn.addEventListener('click', () => abrirModalEditarInsumo(i));
    });
    document.getElementById('btn-nuevo-insumo').addEventListener('click', abrirModalNuevoInsumo);
  }
}

function abrirModalEditarInsumo(insumo) {
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Editar — ${escapeHtml(insumo.nombre)}</h3>
    <label>Nombre</label>
    <input type="text" id="ei2-nombre" value="${escapeHtml(insumo.nombre)}" style="width:100%;margin-bottom:10px;" />
    <label>Cantidad mínima de alerta (${insumo.unidad_medida})</label>
    <input type="number" id="ei2-minima" min="0" value="${insumo.cantidad_minima}" style="width:100%;margin-bottom:10px;" />
    <label>Costo promedio por unidad (CUP)</label>
    <input type="number" id="ei2-costo" step="0.01" min="0" value="${(insumo.costo_promedio / 100).toFixed(2)}" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="ei2-guardar">Guardar cambios</button>
      <button class="btn btn-secundario" id="ei2-cancelar">Cancelar</button>
    </div>
  `);
  document.getElementById('ei2-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('ei2-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('ei2-nombre').value.trim();
    if (!nombre) { toast('El nombre no puede quedar vacío', 'error'); return; }
    try {
      await apiFetch(`/insumos/${insumo.id}`, {
        method: 'PUT',
        body: {
          nombre,
          cantidad_minima: Number(document.getElementById('ei2-minima').value || 0),
          costo_promedio: Math.round(parseFloat(document.getElementById('ei2-costo').value || '0') * 100),
          usuario_id: state.usuario.id,
        },
      });
      toast('Insumo actualizado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function abrirModalNuevoInsumo() {
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Nuevo insumo</h3>
    <label>Nombre</label>
    <input type="text" id="ni-nombre" style="width:100%;margin-bottom:10px;" />
    <label>Unidad de medida</label>
    <select id="ni-unidad" style="width:100%;margin-bottom:10px;">
      <option value="unidad">Unidad</option>
      <option value="g">Gramos</option>
      <option value="kg">Kilogramos</option>
      <option value="ml">Mililitros</option>
      <option value="l">Litros</option>
    </select>
    <label>Cantidad inicial</label>
    <input type="number" id="ni-cantidad" min="0" style="width:100%;margin-bottom:10px;" />
    <label>Cantidad mínima (alerta de reposición)</label>
    <input type="number" id="ni-minima" min="0" style="width:100%;margin-bottom:10px;" />
    <label>Costo promedio por unidad (CUP)</label>
    <input type="number" id="ni-costo" step="0.01" min="0" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="ni-guardar">Guardar</button>
      <button class="btn btn-secundario" id="ni-cancelar">Cancelar</button>
    </div>
  `);
  document.getElementById('ni-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('ni-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('ni-nombre').value.trim();
    if (!nombre) { toast('Escribe un nombre', 'error'); return; }
    try {
      await apiFetch('/insumos', {
        method: 'POST',
        body: {
          nombre,
          unidad_medida: document.getElementById('ni-unidad').value,
          cantidad_actual: Number(document.getElementById('ni-cantidad').value || 0),
          cantidad_minima: Number(document.getElementById('ni-minima').value || 0),
          costo_promedio: Math.round(parseFloat(document.getElementById('ni-costo').value || '0') * 100),
          usuario_id: state.usuario.id,
        },
      });
      toast('Insumo creado', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function abrirModalEntradaInsumo(insumoId, insumos) {
  const insumo = insumos.find((i) => i.id === insumoId);
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Registrar entrada — ${escapeHtml(insumo.nombre)}</h3>
    <label>Cantidad (${insumo.unidad_medida})</label>
    <input type="number" id="ei-cantidad" min="1" style="width:100%;margin-bottom:10px;" />
    <label>Costo unitario (CUP por ${insumo.unidad_medida})</label>
    <input type="number" id="ei-costo" step="0.01" min="0" style="width:100%;margin-bottom:10px;" />
    <label>Proveedor (opcional)</label>
    <input type="text" id="ei-proveedor" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="ei-guardar">Registrar</button>
      <button class="btn btn-secundario" id="ei-cancelar">Cancelar</button>
    </div>
  `);
  document.getElementById('ei-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('ei-guardar').addEventListener('click', async () => {
    const cantidad = Number(document.getElementById('ei-cantidad').value);
    if (!cantidad || cantidad <= 0) { toast('Cantidad inválida', 'error'); return; }
    try {
      await apiFetch('/insumos/compras', {
        method: 'POST',
        body: {
          insumo_id: insumoId,
          cantidad,
          costo_unitario: Math.round(parseFloat(document.getElementById('ei-costo').value || '0') * 100),
          proveedor: document.getElementById('ei-proveedor').value.trim() || null,
          usuario_id: state.usuario.id,
        },
      });
      toast('Entrada registrada', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function abrirModalSalidaInsumo(insumoId, insumos) {
  const insumo = insumos.find((i) => i.id === insumoId);
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Registrar salida — ${escapeHtml(insumo.nombre)}</h3>
    <p class="card-meta">Disponible: ${insumo.cantidad_actual} ${insumo.unidad_medida}</p>
    <label>Cantidad a sacar (${insumo.unidad_medida})</label>
    <input type="number" id="si-cantidad" min="1" max="${insumo.cantidad_actual}" style="width:100%;margin-bottom:10px;" />
    <label>Motivo</label>
    <select id="si-categoria" style="width:100%;margin-bottom:10px;">
      <option value="consumo_interno">Consumo interno (cuenta casa, personal)</option>
      <option value="merma">Merma o rotura</option>
      <option value="otro">Otro</option>
    </select>
    <label>Nota (obligatoria)</label>
    <input type="text" id="si-nota" placeholder="Ej: 2 cervezas para el cumpleaños del cocinero" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-peligro" id="si-guardar">Registrar salida</button>
      <button class="btn btn-secundario" id="si-cancelar">Cancelar</button>
    </div>
  `);
  document.getElementById('si-cancelar').addEventListener('click', modal.cerrar);
  document.getElementById('si-guardar').addEventListener('click', async () => {
    const cantidad = Number(document.getElementById('si-cantidad').value);
    const nota = document.getElementById('si-nota').value.trim();
    if (!cantidad || cantidad <= 0) { toast('Cantidad inválida', 'error'); return; }
    if (!nota) { toast('La nota es obligatoria', 'error'); return; }
    try {
      await apiFetch(`/insumos/${insumoId}/salida`, {
        method: 'POST',
        body: {
          usuario_id: state.usuario.id,
          cantidad,
          categoria: document.getElementById('si-categoria').value,
          nota,
        },
      });
      toast('Salida registrada', 'exito');
      modal.cerrar();
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Vista: Movimientos de inventario (ledger general)
// ---------------------------------------------------------------------

function _queryStringMovimientos() {
  const f = state.movimientosFiltro;
  const params = new URLSearchParams();
  if (f.insumo_id) params.set('insumo_id', f.insumo_id);
  if (f.tipo) params.set('tipo', f.tipo);
  if (f.desde) params.set('desde', `${f.desde} 00:00:00`);
  if (f.hasta) params.set('hasta', `${f.hasta} 23:59:59`);
  return params.toString();
}

async function renderMovimientos() {
  const main = document.getElementById('app-main');
  const insumos = await apiFetch(conUsuario('/insumos'));

  const qs = _queryStringMovimientos();
  const movimientos = await apiFetch(conUsuario('/insumos/movimientos') + (qs ? `&${qs}` : ''));

  const opcionesInsumo = insumos.map((i) =>
    `<option value="${i.id}" ${String(i.id) === state.movimientosFiltro.insumo_id ? 'selected' : ''}>${escapeHtml(i.nombre)}</option>`
  ).join('');
  const opcionesTipo = Object.entries(TIPO_MOVIMIENTO_LABEL).map(([valor, etiqueta]) =>
    `<option value="${valor}" ${valor === state.movimientosFiltro.tipo ? 'selected' : ''}>${escapeHtml(etiqueta)}</option>`
  ).join('');

  const exportarQs = qs ? `&${qs}` : '';

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Movimientos de inventario</h2>
      <div class="fila">
        <a class="btn btn-secundario btn-chico" href="${conUsuario('/api/reportes/movimientos.xlsx') + exportarQs}" target="_blank">Exportar Excel</a>
        <a class="btn btn-secundario btn-chico" href="${conUsuario('/api/reportes/movimientos.pdf') + exportarQs}" target="_blank">Exportar PDF</a>
      </div>
    </div>
    <p class="card-meta" style="margin:6px 0 0;">Registro completo de entradas y salidas de insumos — con o sin caja abierta. Nada se ajusta en silencio: cada fila tiene usuario, motivo y nota.</p>

    <div class="panel" style="margin-top:14px;">
      <div class="fila" style="flex-wrap:wrap;gap:10px;">
        <div class="col" style="flex:1;min-width:160px;">
          <label>Insumo</label>
          <select id="mov-filtro-insumo"><option value="">Todos</option>${opcionesInsumo}</select>
        </div>
        <div class="col" style="flex:1;min-width:180px;">
          <label>Tipo de movimiento</label>
          <select id="mov-filtro-tipo"><option value="">Todos</option>${opcionesTipo}</select>
        </div>
        <div class="col" style="min-width:140px;">
          <label>Desde</label>
          <input type="date" id="mov-filtro-desde" value="${state.movimientosFiltro.desde}" />
        </div>
        <div class="col" style="min-width:140px;">
          <label>Hasta</label>
          <input type="date" id="mov-filtro-hasta" value="${state.movimientosFiltro.hasta}" />
        </div>
      </div>
      <div class="fila" style="margin-top:10px;">
        <button class="btn btn-primario btn-chico" id="mov-aplicar-filtro">Filtrar</button>
        <button class="btn btn-secundario btn-chico" id="mov-limpiar-filtro">Limpiar</button>
      </div>
    </div>

    <div class="panel" style="margin-top:14px;">
      <p class="card-meta" style="margin:0 0 8px;">${movimientos.length} movimiento(s)${movimientos.length >= 200 ? ' (mostrando los más recientes — usa los filtros para acotar)' : ''}</p>
      ${_tablaMovimientos(movimientos)}
    </div>
  `;

  document.getElementById('mov-filtro-insumo').value = state.movimientosFiltro.insumo_id;
  document.getElementById('mov-filtro-tipo').value = state.movimientosFiltro.tipo;

  document.getElementById('mov-aplicar-filtro').addEventListener('click', () => {
    state.movimientosFiltro = {
      insumo_id: document.getElementById('mov-filtro-insumo').value,
      tipo: document.getElementById('mov-filtro-tipo').value,
      desde: document.getElementById('mov-filtro-desde').value,
      hasta: document.getElementById('mov-filtro-hasta').value,
    };
    render();
  });
  document.getElementById('mov-limpiar-filtro').addEventListener('click', () => {
    state.movimientosFiltro = { insumo_id: '', tipo: '', desde: '', hasta: '' };
    render();
  });
}

function abrirModalHistorialInsumo(insumoId, insumos) {
  const insumo = insumos.find((i) => i.id === insumoId);
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Historial — ${escapeHtml(insumo.nombre)}</h3>
    <p class="card-meta">Stock actual: ${insumo.cantidad_actual} ${insumo.unidad_medida}</p>
    <div id="hist-insumo-contenido" style="max-height:50vh;overflow-y:auto;margin-top:10px;">Cargando…</div>
    <div class="fila" style="margin-top:14px;">
      <a class="btn btn-secundario btn-chico" href="${conUsuario(`/api/reportes/movimientos.xlsx?insumo_id=${insumoId}`)}" target="_blank">Exportar Excel</a>
      <a class="btn btn-secundario btn-chico" href="${conUsuario(`/api/reportes/movimientos.pdf?insumo_id=${insumoId}`)}" target="_blank">Exportar PDF</a>
      <button class="btn btn-secundario" id="hist-cerrar">Cerrar</button>
    </div>
  `);
  document.getElementById('hist-cerrar').addEventListener('click', modal.cerrar);
  apiFetch(conUsuario(`/insumos/${insumoId}/movimientos`))
    .then((movimientos) => {
      document.getElementById('hist-insumo-contenido').innerHTML = _tablaMovimientos(movimientos, { mostrarInsumo: false });
    })
    .catch((e) => {
      document.getElementById('hist-insumo-contenido').innerHTML = `<p class="vacio">${escapeHtml(e.message)}</p>`;
    });
}

// ---------------------------------------------------------------------
// Vista: Dashboard (ventas por día, top productos, margen)
// ---------------------------------------------------------------------

// Gráficos como SVG generado a mano -- sin librerías ni CDN, coherente
// con el resto del proyecto (todo tiene que funcionar sin internet).

function _svgLineChart(serie, { width = 760, height = 220 } = {}) {
  const pad = { top: 16, right: 16, bottom: 26, left: 60 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const valores = serie.map((d) => d.ingresos_cup);
  const max = Math.max(...valores, 1);
  const n = serie.length;
  const x = (i) => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v) => pad.top + h - (v / max) * h;

  const puntos = serie.map((d, i) => `${x(i)},${y(d.ingresos_cup)}`).join(' ');
  const area = `${pad.left},${pad.top + h} ${puntos} ${x(n - 1)},${pad.top + h}`;

  // Mostrar como mucho ~7 etiquetas de fecha en el eje X para que no se amontonen.
  const paso = Math.max(1, Math.ceil(n / 7));
  const etiquetasX = serie.map((d, i) => (i % paso === 0 || i === n - 1)
    ? `<text x="${x(i)}" y="${height - 6}" font-size="10" fill="var(--texto-tenue, #9AA0AC)" text-anchor="middle">${d.fecha.slice(5)}</text>`
    : '').join('');

  const lineasY = [0, 0.5, 1].map((f) => {
    const val = max * f;
    const yy = y(val);
    return `
      <line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="var(--borde, #333844)" stroke-width="1" />
      <text x="${pad.left - 8}" y="${yy + 4}" font-size="10" fill="var(--texto-tenue, #9AA0AC)" text-anchor="end">${formatoMoneda(val).replace(' CUP', '')}</text>
    `;
  }).join('');

  const circulos = serie.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.ingresos_cup)}" r="3" fill="var(--ambar, #D9A62E)" />`).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;">
      ${lineasY}
      <polygon points="${area}" fill="var(--ambar, #D9A62E)" opacity="0.12" />
      <polyline points="${puntos}" fill="none" stroke="var(--ambar, #D9A62E)" stroke-width="2.5" />
      ${circulos}
      ${etiquetasX}
    </svg>
  `;
}

function _barraHorizontal(nombre, valor, max, colorVar, sufijo = '') {
  const pct = max > 0 ? Math.max(2, (valor / max) * 100) : 0;
  return `
    <div style="margin-bottom:10px;">
      <div class="fila-entre" style="margin-bottom:4px;">
        <span style="font-size:0.85rem;">${escapeHtml(nombre)}</span>
        <span class="card-meta">${sufijo}</span>
      </div>
      <div style="background:var(--bg-panel-alto);border-radius:6px;height:14px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${colorVar};border-radius:6px;"></div>
      </div>
    </div>
  `;
}

async function renderDashboard() {
  const main = document.getElementById('app-main');
  const hoy = new Date();
  const hasta = hoy.toISOString().slice(0, 10);
  const desde = new Date(hoy.getTime() - (state.dashboardRango - 1) * 86400000).toISOString().slice(0, 10);

  const data = await apiFetch(conUsuario(`/dashboard/resumen?desde=${desde}&hasta=${hasta}`));
  const maxIngresoDia = Math.max(...data.serie_diaria.map((d) => d.ingresos_cup), 1);
  const topPorCantidad = [...data.productos].sort((a, b) => b.cantidad_vendida - a.cantidad_vendida).slice(0, 8);
  const maxCantidad = Math.max(...topPorCantidad.map((p) => p.cantidad_vendida), 1);
  const topPorMargen = [...data.productos].sort((a, b) => b.margen_total_cup - a.margen_total_cup);

  main.innerHTML = `
    <div class="fila-entre">
      <h2 style="margin:0;">Dashboard</h2>
      <div class="fila" id="dash-rango-botones">
        ${[7, 30, 90].map((n) => `<button class="btn btn-chico ${state.dashboardRango === n ? 'btn-primario' : 'btn-secundario'}" data-rango="${n}">${n} días</button>`).join('')}
      </div>
    </div>

    <div class="fila" style="margin-top:14px;gap:14px;flex-wrap:wrap;">
      <div class="panel" style="flex:1;min-width:180px;">
        <div class="card-meta">Ingresos del período</div>
        <div class="monto" style="font-size:1.4rem;">${formatoMoneda(data.totales.ingresos_cup)}</div>
      </div>
      <div class="panel" style="flex:1;min-width:180px;">
        <div class="card-meta">Cuentas cerradas</div>
        <div class="monto" style="font-size:1.4rem;">${data.totales.cuentas_cerradas}</div>
      </div>
      <div class="panel" style="flex:1;min-width:180px;">
        <div class="card-meta">Ticket promedio</div>
        <div class="monto" style="font-size:1.4rem;">${formatoMoneda(data.totales.ticket_promedio_cup)}</div>
      </div>
      <div class="panel" style="flex:1;min-width:180px;">
        <div class="card-meta">Margen estimado</div>
        <div class="monto" style="font-size:1.4rem;color:var(--verde);">${formatoMoneda(data.totales.margen_total_cup)}</div>
      </div>
    </div>

    <div class="panel" style="margin-top:14px;">
      <h3 style="margin-top:0;">Ingresos por día</h3>
      ${data.serie_diaria.every((d) => d.ingresos_cup === 0)
        ? '<p class="vacio">Sin pagos registrados en este período.</p>'
        : _svgLineChart(data.serie_diaria)}
    </div>

    <div class="fila" style="margin-top:14px;gap:14px;flex-wrap:wrap;align-items:flex-start;">
      <div class="panel" style="flex:1;min-width:320px;">
        <h3 style="margin-top:0;">Productos más vendidos (cantidad)</h3>
        ${topPorCantidad.length === 0 ? '<p class="vacio">Sin ventas confirmadas en este período.</p>' :
          topPorCantidad.map((p) => _barraHorizontal(p.producto_nombre, p.cantidad_vendida, maxCantidad, 'var(--ambar)', `${p.cantidad_vendida} und.`)).join('')}
      </div>

      <div class="panel" style="flex:1;min-width:320px;">
        <h3 style="margin-top:0;">Margen por producto</h3>
        ${topPorMargen.length === 0 ? '<p class="vacio">Sin datos de margen en este período.</p>' : `
          <table>
            <thead><tr><th>Producto</th><th>Ingresos</th><th>Margen</th><th>%</th></tr></thead>
            <tbody>
              ${topPorMargen.map((p) => `
                <tr>
                  <td>${escapeHtml(p.producto_nombre)}</td>
                  <td class="card-meta">${formatoMoneda(p.ingresos_cup)}</td>
                  <td style="color:var(--verde);">${formatoMoneda(p.margen_total_cup)}</td>
                  <td class="card-meta">${p.margen_pct != null ? p.margen_pct + '%' : '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p class="card-meta" style="margin-top:10px;">El margen usa el costo promedio actual de cada insumo, no el costo histórico del día de la venta.</p>
        `}
      </div>
    </div>
  `;

  document.querySelectorAll('#dash-rango-botones [data-rango]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.dashboardRango = Number(btn.dataset.rango);
      render();
    });
  });
}

// ---------------------------------------------------------------------
// Vista: Cierre de caja
// ---------------------------------------------------------------------

function _formularioConteoHtml(insumos, idPrefix) {
  return insumos.map((i) => `
    <div class="item-linea" data-conteo-insumo="${i.id}" data-cantidad-sistema="${i.cantidad_actual}" style="flex-direction:column;align-items:stretch;">
      <div class="fila-entre">
        <div>
          <div>${escapeHtml(i.nombre)}</div>
          <div class="card-meta">Sistema: ${i.cantidad_actual} ${i.unidad_medida}</div>
        </div>
        <input type="number" class="${idPrefix}-input" min="0" value="${i.cantidad_actual}" style="width:110px;" />
      </div>
      <input type="text" class="${idPrefix}-nota oculto" placeholder="¿Qué pasó? (obligatorio si no coincide)" style="width:100%;margin-top:8px;" />
    </div>
  `).join('');
}

function _conectarNotasConteo(contenedor, idPrefix) {
  contenedor.querySelectorAll('[data-conteo-insumo]').forEach((linea) => {
    const sistema = Number(linea.dataset.cantidadSistema);
    const input = linea.querySelector(`.${idPrefix}-input`);
    const notaInput = linea.querySelector(`.${idPrefix}-nota`);
    const actualizar = () => {
      const difiere = Number(input.value) !== sistema;
      notaInput.classList.toggle('oculto', !difiere);
      if (!difiere) notaInput.value = '';
    };
    input.addEventListener('input', actualizar);
  });
}

function _leerConteoFormulario(contenedor, idPrefix) {
  const conteos = [];
  for (const linea of contenedor.querySelectorAll('[data-conteo-insumo]')) {
    const insumoId = Number(linea.dataset.conteoInsumo);
    const sistema = Number(linea.dataset.cantidadSistema);
    const valor = linea.querySelector(`.${idPrefix}-input`).value;
    if (valor === '') throw new Error('Falta contar algún insumo');
    const nota = linea.querySelector(`.${idPrefix}-nota`).value.trim();
    if (Number(valor) !== sistema && !nota) {
      throw new Error(`Explica la diferencia en "${linea.querySelector('div div').textContent}" antes de continuar`);
    }
    conteos.push({ insumo_id: insumoId, cantidad_contada: Number(valor), nota: nota || null });
  }
  return conteos;
}

function _tablaConteoResumen(conteos) {
  if (!conteos || conteos.length === 0) return '<p class="vacio">Sin conteo registrado.</p>';
  const conDiferencia = conteos.filter((c) => c.diferencia !== 0);
  const aviso = conDiferencia.length > 0
    ? `<p style="color:var(--rojo);font-weight:600;margin:0 0 10px;">⚠ ${conDiferencia.length} insumo(s) con diferencia en este conteo</p>`
    : '';
  const filas = conteos.map((c) => `
    <tr>
      <td>${escapeHtml(c.insumo_nombre)}</td>
      <td>${c.cantidad_sistema} ${c.unidad_medida}</td>
      <td>${c.cantidad_contada} ${c.unidad_medida}</td>
      <td class="${c.diferencia !== 0 ? 'alerta-bajo-minimo' : ''}">${c.diferencia > 0 ? '+' : ''}${c.diferencia}</td>
      <td class="card-meta">${escapeHtml(c.nota || (c.diferencia !== 0 ? 'sin nota' : '—'))}</td>
    </tr>
  `).join('');
  return `
    ${aviso}
    <table>
      <thead><tr><th>Insumo</th><th>Sistema</th><th>Contado</th><th>Diferencia</th><th>Nota</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

async function renderCierre() {
  if (state.cierreDetalleId) return renderCierreDetalle(state.cierreDetalleId);
  if (state.cierreVista === 'historial') return renderCierreHistorial();
  return renderCierreActual();
}

function _cierreSubnav(activo) {
  return `
    <div class="fila" style="margin-bottom:14px;">
      <button class="btn btn-chico ${activo === 'actual' ? 'btn-primario' : 'btn-secundario'}" id="btn-ir-actual">Caja actual</button>
      <button class="btn btn-chico ${activo === 'historial' ? 'btn-primario' : 'btn-secundario'}" id="btn-ir-historial">Historial de días</button>
    </div>
  `;
}

function _conectarCierreSubnav() {
  document.getElementById('btn-ir-actual').addEventListener('click', () => {
    state.cierreVista = 'actual'; state.cierreDetalleId = null; render();
  });
  document.getElementById('btn-ir-historial').addEventListener('click', () => {
    state.cierreVista = 'historial'; state.cierreDetalleId = null; render();
  });
}

async function renderCierreActual() {
  const main = document.getElementById('app-main');
  const cierre = await apiFetch('/cierre-caja/actual');

  if (!cierre) {
    const insumos = await apiFetch(conUsuario('/insumos'));
    main.innerHTML = `
      ${_cierreSubnav('actual')}
      <div class="panel">
        <h2 style="margin-top:0;">Abrir caja — conteo físico de apertura</h2>
        <p class="card-meta">Cuenta cada insumo antes de empezar a vender. Si algo no coincide con el sistema, tienes que explicar qué pasó — se ajusta automático y queda registrado con esa nota.</p>
        <div class="lista-items" id="conteo-apertura-lineas" style="margin-top:14px;">
          ${_formularioConteoHtml(insumos, 'conteo-apertura')}
        </div>
        <button class="btn btn-primario btn-bloque" id="btn-abrir-cierre" style="margin-top:16px;">Confirmar conteo y abrir caja</button>
      </div>
    `;
    _conectarCierreSubnav();
    _conectarNotasConteo(document.getElementById('conteo-apertura-lineas'), 'conteo-apertura');
    document.getElementById('btn-abrir-cierre').addEventListener('click', async () => {
      let conteos;
      try {
        conteos = _leerConteoFormulario(document.getElementById('conteo-apertura-lineas'), 'conteo-apertura');
      } catch (e) { toast(e.message, 'error'); return; }
      try {
        await apiFetch('/cierre-caja/abrir', {
          method: 'POST',
          body: { usuario_id: state.usuario.id, conteos },
        });
        toast('Caja abierta con conteo registrado', 'exito');
        render();
      } catch (e) { toast(e.message, 'error'); }
    });
    return;
  }

  const resumen = await apiFetch(conUsuario(`/cierre-caja/${cierre.id}/resumen`));
  const insumos = await apiFetch(conUsuario('/insumos'));
  const filasResumen = resumen.desglose.map((f) => `
    <tr>
      <td>${f.metodo}</td><td>${f.moneda}</td><td>${f.subtipo || '—'}</td>
      <td>${f.cantidad}</td><td class="monto">${formatoMoneda(f.monto_cup_total)}</td>
    </tr>
  `).join('');

  main.innerHTML = `
    ${_cierreSubnav('actual')}
    <div class="panel">
      <div class="fila-entre">
        <h2 style="margin:0;">Caja abierta</h2>
        <a class="btn btn-secundario btn-chico" href="${conUsuario(`/api/reportes/ventas.xlsx?desde=${encodeURIComponent(cierre.hora_apertura)}`)}" target="_blank">Exportar ventas Excel</a>
      </div>
      <p class="card-meta">Abierta desde ${cierre.hora_apertura} (hora del servidor)</p>
      <table style="margin-top:10px;">
        <thead><tr><th>Método</th><th>Moneda</th><th>Subtipo</th><th>Pagos</th><th>Total (CUP)</th></tr></thead>
        <tbody>${filasResumen || '<tr><td colspan="5" class="vacio">Sin pagos todavía</td></tr>'}</tbody>
      </table>
      <div class="fila-entre" style="border-top:1px solid var(--borde);padding-top:12px;margin-top:12px;">
        <strong>Total esperado en efectivo (CUP)</strong>
        <span class="monto" style="font-size:1.1rem;">${formatoMoneda(resumen.efectivo_cup)}</span>
      </div>
    </div>
    <div class="panel">
      <h3 style="margin-top:0;">Conteo físico de cierre</h3>
      <p class="card-meta">Vuelve a contar cada insumo antes de cerrar. Si algo no coincide, explica qué pasó — se ajusta automático y queda registrado con esa nota.</p>
      <div class="lista-items" id="conteo-cierre-lineas" style="margin-top:14px;">
        ${_formularioConteoHtml(insumos, 'conteo-cierre')}
      </div>
      <div class="col" style="margin-top:16px;">
        <label>Efectivo contado físicamente (CUP)</label>
        <input type="number" id="cc-efectivo" step="0.01" min="0" />
        <label>Notas (opcional)</label>
        <input type="text" id="cc-notas" />
        <button class="btn btn-verde btn-bloque" id="btn-cerrar-caja">Confirmar conteo y cerrar caja del día</button>
      </div>
    </div>
  `;
  _conectarCierreSubnav();
  _conectarNotasConteo(document.getElementById('conteo-cierre-lineas'), 'conteo-cierre');

  document.getElementById('btn-cerrar-caja').addEventListener('click', async () => {
    const valorInput = document.getElementById('cc-efectivo').value;
    if (valorInput === '') { toast('Indica el efectivo contado', 'error'); return; }
    let conteos;
    try {
      conteos = _leerConteoFormulario(document.getElementById('conteo-cierre-lineas'), 'conteo-cierre');
    } catch (e) { toast(e.message, 'error'); return; }
    const efectivo = Math.round(parseFloat(valorInput) * 100);
    if (!confirm('¿Cerrar la caja del día? Esta acción bloquea el período.')) return;
    try {
      const resultado = await apiFetch(`/cierre-caja/${cierre.id}/cerrar`, {
        method: 'POST',
        body: {
          usuario_id: state.usuario.id,
          efectivo_contado_cup: efectivo,
          notas: document.getElementById('cc-notas').value.trim() || null,
          conteos,
        },
      });
      const diferencia = resultado.cierre.diferencia_cup;
      const msg = diferencia === 0
        ? 'Caja cuadrada exacta.'
        : `Diferencia: ${formatoMoneda(Math.abs(diferencia))} ${diferencia > 0 ? 'de sobrante' : 'de faltante'}.`;
      toast(`Caja cerrada. ${msg}`, diferencia === 0 ? 'exito' : 'error');
      render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function renderCierreHistorial() {
  const main = document.getElementById('app-main');
  const cierres = await apiFetch(conUsuario('/cierre-caja'));

  main.innerHTML = `
    ${_cierreSubnav('historial')}
    <div class="panel">
      <h2 style="margin-top:0;">Historial de días</h2>
      <div class="lista-items" id="lista-historial" style="margin-top:10px;"></div>
    </div>
  `;
  _conectarCierreSubnav();

  const lista = document.getElementById('lista-historial');
  if (cierres.length === 0) {
    lista.innerHTML = '<p class="vacio">Todavía no hay cierres registrados.</p>';
    return;
  }
  cierres.forEach((c) => {
    const div = document.createElement('button');
    div.className = 'item-linea';
    div.style.width = '100%';
    div.style.textAlign = 'left';
    const diferenciaTxt = c.diferencia_cup == null
      ? ''
      : `<span class="badge ${c.diferencia_cup === 0 ? 'badge-verde' : 'badge-rojo'}" style="margin-left:8px;">
           ${c.diferencia_cup === 0 ? 'cuadrada' : (c.diferencia_cup > 0 ? 'sobrante' : 'faltante')}
         </span>`;
    div.innerHTML = `
      <div>
        <div>${c.fecha} ${diferenciaTxt}</div>
        <div class="card-meta">${c.hora_apertura} → ${c.hora_cierre || 'en curso'}</div>
      </div>
      <span class="badge ${c.estado === 'abierto' ? 'badge-ambar' : 'badge-gris'}">${c.estado}</span>
    `;
    div.addEventListener('click', () => { state.cierreDetalleId = c.id; render(); });
    lista.appendChild(div);
  });
}

function _horaCorta(fechaHora) {
  // "2026-07-29 08:28:07" -> "08:28"
  const partes = fechaHora.split(' ');
  return partes.length > 1 ? partes[1].slice(0, 5) : fechaHora;
}

async function renderCierreDetalle(cierreId) {
  const main = document.getElementById('app-main');
  const d = await apiFetch(conUsuario(`/cierre-caja/${cierreId}/detalle`));

  const filasResumen = d.resumen_pagos.desglose.map((f) => {
    const pagosDeEsteGrupo = d.pagos_detalle.filter((p) =>
      p.metodo === f.metodo && p.moneda === f.moneda && (p.subtipo || null) === (f.subtipo || null)
    );
    const subdetalle = pagosDeEsteGrupo.map((p) => `
      <div class="fila-entre" style="padding:4px 0 4px 18px;font-size:0.85rem;color:var(--texto-tenue);">
        <span>${_horaCorta(p.registrado_at)} · ${escapeHtml(p.referencia)}</span>
        <span class="monto">${formatoMoneda(p.monto_cup_equivalente)}</span>
      </div>
    `).join('');
    return `
      <tr>
        <td>${f.metodo}</td><td>${f.moneda}</td><td>${f.subtipo || '—'}</td>
        <td>${f.cantidad}</td><td class="monto">${formatoMoneda(f.monto_cup_total)}</td>
      </tr>
      <tr><td colspan="5" style="padding:0;border-bottom:none;">${subdetalle}</td></tr>
    `;
  }).join('');

  const ventasPorCuenta = {};
  const ordenCuentas = [];
  d.ventas.forEach((v) => {
    if (!ventasPorCuenta[v.referencia]) {
      ventasPorCuenta[v.referencia] = [];
      ordenCuentas.push(v.referencia);
    }
    ventasPorCuenta[v.referencia].push(v);
  });
  const bloquesVentas = ordenCuentas.map((referencia) => {
    const items = ventasPorCuenta[referencia];
    const totalCuenta = items.filter((v) => v.estado !== 'cancelado').reduce((acc, v) => acc + v.subtotal, 0);
    const filas = items.map((v) => `
      <tr class="${v.estado === 'cancelado' ? 'cancelado' : ''}">
        <td class="card-meta">${_horaCorta(v.agregado_at)}</td>
        <td>${escapeHtml(v.producto)}</td><td>${v.cantidad}</td>
        <td class="monto">${formatoMoneda(v.subtotal)}</td><td>${v.estado}</td>
      </tr>
    `).join('');
    return `
      <div style="margin-bottom:14px;">
        <div class="fila-entre" style="padding:6px 0;border-bottom:1px solid var(--borde);">
          <strong>${escapeHtml(referencia)}</strong>
          <span class="monto">${formatoMoneda(totalCuenta)}</span>
        </div>
        <table>
          <thead><tr><th>Hora</th><th>Producto</th><th>Cant.</th><th>Subtotal</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    `;
  }).join('');

  main.innerHTML = `
    <button class="btn btn-secundario btn-chico" id="btn-volver-historial">&larr; Historial</button>
    <div class="panel" style="margin-top:12px;">
      <div class="fila-entre">
        <h2 style="margin:0;">${d.cierre.fecha}</h2>
        <div class="fila">
          <span class="badge ${d.cierre.estado === 'abierto' ? 'badge-ambar' : 'badge-gris'}">${d.cierre.estado}</span>
          <a class="btn btn-secundario btn-chico" href="${conUsuario(`/api/reportes/cierre/${cierreId}.xlsx`)}" target="_blank">Exportar Excel</a>
          <a class="btn btn-secundario btn-chico" href="${conUsuario(`/api/reportes/cierre/${cierreId}.pdf`)}" target="_blank">Exportar PDF</a>
        </div>
      </div>
      <p class="card-meta">Abrió ${escapeHtml(d.abierto_por_nombre || '—')} · ${d.cierre.hora_apertura}</p>
      ${d.cierre.hora_cierre ? `<p class="card-meta">Cerró ${escapeHtml(d.cerrado_por_nombre || '—')} · ${d.cierre.hora_cierre}</p>` : ''}
      ${d.cierre.diferencia_cup != null ? `
        <div class="fila-entre" style="border-top:1px solid var(--borde);padding-top:10px;margin-top:10px;">
          <span>Efectivo contado vs. esperado</span>
          <span class="monto" style="color:${d.cierre.diferencia_cup === 0 ? 'var(--verde)' : 'var(--rojo)'};">
            ${formatoMoneda(d.cierre.efectivo_contado_cup)} / ${formatoMoneda(d.cierre.efectivo_esperado_cup)}
          </span>
        </div>
      ` : ''}
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Pagos por método</h3>
      <p class="card-meta">Debajo de cada método, el detalle de cada pago individual que suma el total.</p>
      <table style="margin-top:8px;">
        <thead><tr><th>Método</th><th>Moneda</th><th>Subtipo</th><th>Pagos</th><th>Total (CUP)</th></tr></thead>
        <tbody>${filasResumen || '<tr><td colspan="5" class="vacio">Sin pagos</td></tr>'}</tbody>
      </table>
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Ventas del día (${d.ventas.length}) — agrupadas por cuenta</h3>
      <div style="max-height:420px;overflow-y:auto;margin-top:8px;">
        ${bloquesVentas || '<p class="vacio">Sin ventas</p>'}
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Movimientos de inventario (${(d.movimientos_inventario || []).length})</h3>
      <p class="card-meta">Todo lo que entró o salió del almacén durante este período de caja: ventas, entradas por compra, salidas declaradas (consumo interno / merma / otro) y ajustes de conteo.</p>
      <div style="max-height:420px;overflow-y:auto;margin-top:8px;">
        ${_tablaMovimientos(d.movimientos_inventario)}
      </div>
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Conteo de apertura</h3>
      ${_tablaConteoResumen(d.conteo_apertura)}
    </div>

    <div class="panel">
      <h3 style="margin-top:0;">Conteo de cierre</h3>
      ${_tablaConteoResumen(d.conteo_cierre)}
    </div>
  `;

  document.getElementById('btn-volver-historial').addEventListener('click', () => {
    state.cierreDetalleId = null;
    render();
  });
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Configuración (solo Gerente) -- gestión de cuentas de usuario
// ---------------------------------------------------------------------

async function abrirModalConfiguracion() {
  const usuarios = await apiFetch(conUsuario('/usuarios'));
  const vendedores = usuarios.filter((u) => u.rol === 'vendedor');
  const administradores = usuarios.filter((u) => u.rol === 'administrador');
  const gerentes = usuarios.filter((u) => u.rol === 'gerente');
  const miUsuarioActual = usuarios.find((u) => u.id === state.usuario.id) || state.usuario;
  const red = await fetch(`${API}/red/info`).then((r) => r.json()).catch(() => null);

  const filaUsuario = (u) => `
    <button type="button" class="item-linea item-linea-clickeable" data-abrir-perfil="${u.id}">
      <div>
        <div>${escapeHtml(u.nombre)}</div>
        <div class="card-meta">${u.rol}${u.activo ? '' : ' · inactivo'} · sesión inactiva ${u.timeout_inactividad_minutos} min</div>
      </div>
      <span class="chevron-perfil">›</span>
    </button>
  `;

  const seccionRed = (red && red.url_mesero) ? `
    <div style="border-top:1px solid var(--borde);padding-top:14px;margin-top:14px;">
      <strong style="font-size:0.85rem;color:var(--texto-tenue);">ACCESO DESDE CELULAR (MESEROS)</strong>
      <p class="card-meta" style="margin:6px 0 10px;">Los celulares deben estar en la misma red wifi que esta PC. Que el mesero escanee el código o escriba la dirección en su navegador.</p>
      <div class="fila" style="align-items:flex-start;">
        <img src="${API}/red/qr.svg?texto=${encodeURIComponent(red.url_mesero)}" alt="Código QR" style="width:140px;height:140px;background:#fff;border-radius:8px;padding:8px;flex-shrink:0;" />
        <div>
          <div class="card-meta">Dirección:</div>
          <div class="monto" style="font-size:1.05rem;word-break:break-all;">${escapeHtml(red.url_mesero)}</div>
        </div>
      </div>
    </div>
  ` : `
    <div style="border-top:1px solid var(--borde);padding-top:14px;margin-top:14px;">
      <strong style="font-size:0.85rem;color:var(--texto-tenue);">ACCESO DESDE CELULAR (MESEROS)</strong>
      <p class="card-meta" style="margin:6px 0 0;">No se detectó una red wifi/LAN activa en esta PC. Conecta esta PC a la misma red que los celulares de los meseros y vuelve a abrir esta pantalla.</p>
    </div>
  `;

  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Configuración</h3>
    <p class="card-meta">Vendedores: ${vendedores.length} · Administradores: ${administradores.length} · Gerente: ${gerentes.length}</p>

    <div class="fila-entre" style="margin-top:14px;">
      <strong style="font-size:0.85rem;color:var(--texto-tenue);">CUENTAS</strong>
      <button class="btn btn-chico btn-primario" id="cfg-nueva-cuenta">+ Nueva cuenta</button>
    </div>
    <div class="lista-items" id="cfg-lista-usuarios" style="margin:10px 0 16px;max-height:40vh;overflow-y:auto;">
      ${[...administradores, ...vendedores].map(filaUsuario).join('') || '<p class="vacio">Solo existe tu cuenta de Gerente todavía.</p>'}
    </div>

    <div style="border-top:1px solid var(--borde);padding-top:14px;">
      <strong style="font-size:0.85rem;color:var(--texto-tenue);">TU CUENTA</strong>
      <button type="button" class="item-linea item-linea-clickeable" id="cfg-mi-perfil" style="margin-top:10px;">
        <div>
          <div>${escapeHtml(state.usuario.nombre)}</div>
          <div class="card-meta">gerente · sesión inactiva ${miUsuarioActual.timeout_inactividad_minutos} min</div>
        </div>
        <span class="chevron-perfil">›</span>
      </button>
    </div>

    ${seccionRed}

    <button class="btn btn-secundario btn-bloque" id="cfg-cerrar" style="margin-top:16px;">Cerrar</button>
  `);

  document.getElementById('cfg-cerrar').addEventListener('click', modal.cerrar);
  document.getElementById('cfg-nueva-cuenta').addEventListener('click', () => {
    modal.cerrar();
    abrirModalNuevaCuentaUsuario();
  });
  document.getElementById('cfg-mi-perfil').addEventListener('click', () => {
    modal.cerrar();
    abrirModalEditarUsuario(miUsuarioActual, true);
  });
  modal.overlay.querySelectorAll('[data-abrir-perfil]').forEach((btn) => {
    const u = usuarios.find((x) => x.id === Number(btn.dataset.abrirPerfil));
    btn.addEventListener('click', () => { modal.cerrar(); abrirModalEditarUsuario(u, false); });
  });
}

function abrirModalNuevaCuentaUsuario() {
  const modal = mostrarModal(`
    <h3 style="margin-top:0;">Nueva cuenta</h3>
    <label>Nombre</label>
    <input type="text" id="nc-nombre" style="width:100%;margin-bottom:10px;" />
    <label>Rol</label>
    <select id="nc-rol" style="width:100%;margin-bottom:10px;">
      <option value="vendedor">Vendedor</option>
      <option value="administrador">Administrador</option>
    </select>
    <label>PIN (mínimo 4 dígitos)</label>
    <input type="text" id="nc-pin" inputmode="numeric" style="width:100%;margin-bottom:16px;" />
    <div class="fila">
      <button class="btn btn-primario" id="nc-guardar">Crear cuenta</button>
      <button class="btn btn-secundario" id="nc-cancelar">Cancelar</button>
    </div>
  `);
  document.getElementById('nc-cancelar').addEventListener('click', () => { modal.cerrar(); abrirModalConfiguracion(); });
  document.getElementById('nc-guardar').addEventListener('click', async () => {
    const nombre = document.getElementById('nc-nombre').value.trim();
    const pin = document.getElementById('nc-pin').value.trim();
    if (!nombre) { toast('Escribe un nombre', 'error'); return; }
    if (pin.length < 4) { toast('El PIN debe tener al menos 4 dígitos', 'error'); return; }
    try {
      await apiFetch('/usuarios', {
        method: 'POST',
        body: { usuario_id: state.usuario.id, nombre, rol: document.getElementById('nc-rol').value, pin },
      });
      toast('Cuenta creada', 'exito');
      modal.cerrar();
      abrirModalConfiguracion();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function abrirModalEditarUsuario(usuario, esPropioUsuario) {
  const esUnicoGerente = usuario.rol === 'gerente';
  let timeout = usuario.timeout_inactividad_minutos;

  const modal = mostrarModal(`
    <h3 style="margin-top:0;">${esPropioUsuario ? 'Mi perfil' : `Perfil — ${escapeHtml(usuario.nombre)}`}</h3>
    ${!usuario.activo ? '<p class="card-meta" style="color:var(--rojo);margin-top:0;">Esta cuenta está desactivada.</p>' : ''}

    <strong style="font-size:0.8rem;color:var(--texto-tenue);">IDENTIDAD</strong>
    <div style="margin-top:8px;">
      <label>Nombre</label>
      <input type="text" id="eu-nombre" value="${escapeHtml(usuario.nombre)}" style="width:100%;margin-bottom:10px;" />
      ${esPropioUsuario ? '' : `
        <label>Rol</label>
        <select id="eu-rol" style="width:100%;margin-bottom:10px;">
          <option value="vendedor" ${usuario.rol === 'vendedor' ? 'selected' : ''}>Vendedor</option>
          <option value="administrador" ${usuario.rol === 'administrador' ? 'selected' : ''}>Administrador</option>
          <option value="gerente" ${usuario.rol === 'gerente' ? 'selected' : ''}>Gerente</option>
        </select>
      `}
    </div>

    <strong style="font-size:0.8rem;color:var(--texto-tenue);">ACCESO</strong>
    <div style="margin-top:8px;">
      <label>Nuevo PIN ${esPropioUsuario && esUnicoGerente ? '' : '(dejar vacío para no cambiarlo)'}</label>
      <input type="text" id="eu-pin" inputmode="numeric" placeholder="${esUnicoGerente ? 'mínimo 6 dígitos' : 'opcional, mínimo 4 dígitos'}" style="width:100%;margin-bottom:10px;" />
    </div>

    <strong style="font-size:0.8rem;color:var(--texto-tenue);">SESIÓN</strong>
    <div style="margin-top:8px;margin-bottom:16px;">
      <label>Cerrar sesión sola tras esta inactividad (minutos)</label>
      <div class="fila" id="eu-timeout-chips" style="margin-bottom:8px;">
        ${[10, 15, 20, 30, 45, 60].map((m) => `<button type="button" class="btn btn-chico ${timeout === m ? 'btn-primario' : 'btn-secundario'}" data-timeout-rapido="${m}">${m}</button>`).join('')}
      </div>
      <input type="number" id="eu-timeout" min="1" max="480" value="${timeout}" style="width:100%;" />
      <p class="card-meta" style="margin:6px 0 0;">Se avisa 1 minuto antes de cerrar, para no perder nada a medio escribir.</p>
    </div>

    <div class="fila">
      <button class="btn btn-primario" id="eu-guardar">Guardar</button>
      <button class="btn btn-secundario" id="eu-cancelar">Cancelar</button>
    </div>
    ${(!esPropioUsuario && usuario.activo) ? '<button class="btn btn-peligro btn-bloque" id="eu-desactivar" style="margin-top:10px;">Desactivar cuenta</button>' : ''}
    ${(!esPropioUsuario && !usuario.activo) ? '<button class="btn btn-verde btn-bloque" id="eu-reactivar" style="margin-top:10px;">Reactivar cuenta</button>' : ''}
  `);

  document.querySelectorAll('#eu-timeout-chips [data-timeout-rapido]').forEach((btn) => {
    btn.addEventListener('click', () => {
      timeout = Number(btn.dataset.timeoutRapido);
      document.getElementById('eu-timeout').value = timeout;
      document.querySelectorAll('#eu-timeout-chips [data-timeout-rapido]').forEach((b) => {
        b.classList.toggle('btn-primario', Number(b.dataset.timeoutRapido) === timeout);
        b.classList.toggle('btn-secundario', Number(b.dataset.timeoutRapido) !== timeout);
      });
    });
  });

  document.getElementById('eu-cancelar').addEventListener('click', () => { modal.cerrar(); if (!esPropioUsuario) abrirModalConfiguracion(); });
  document.getElementById('eu-guardar').addEventListener('click', async () => {
    const pin = document.getElementById('eu-pin').value.trim();
    const nombre = document.getElementById('eu-nombre').value.trim();
    const timeoutValor = Number(document.getElementById('eu-timeout').value || '0');
    if (!nombre) { toast('El nombre no puede quedar vacío', 'error'); return; }
    if (!timeoutValor || timeoutValor < 1) { toast('Indica un tiempo de inactividad válido', 'error'); return; }
    if (pin && esUnicoGerente && pin.length < 6) { toast('El PIN de Gerente debe tener al menos 6 dígitos', 'error'); return; }
    if (pin && !esUnicoGerente && pin.length < 4) { toast('El PIN debe tener al menos 4 dígitos', 'error'); return; }

    const body = { usuario_id: state.usuario.id, nombre, timeout_inactividad_minutos: timeoutValor };
    if (!esPropioUsuario) body.rol = document.getElementById('eu-rol').value;
    if (pin) body.nueva_pin = pin;
    try {
      const actualizado = await apiFetch(`/usuarios/${usuario.id}`, { method: 'PUT', body });
      toast('Perfil actualizado', 'exito');
      if (esPropioUsuario) {
        // Si el Gerente edita su propio perfil, el timeout nuevo debe
        // aplicar ya mismo en este dispositivo, sin esperar a re-loguear.
        state.usuario = { ...state.usuario, nombre: actualizado.nombre, timeout_inactividad_minutos: actualizado.timeout_inactividad_minutos };
        localStorage.setItem('pos_usuario', JSON.stringify(state.usuario));
        document.getElementById('usuario-actual').textContent = `${state.usuario.nombre} · ${state.usuario.rol}`;
        reiniciarControlInactividad();
      }
      modal.cerrar();
      if (!esPropioUsuario) abrirModalConfiguracion();
    } catch (e) { toast(e.message, 'error'); }
  });

  const btnDesactivar = document.getElementById('eu-desactivar');
  if (btnDesactivar) {
    btnDesactivar.addEventListener('click', async () => {
      if (!confirm(`¿Desactivar la cuenta de "${usuario.nombre}"? Ya no podrá iniciar sesión.`)) return;
      try {
        await apiFetch(`/usuarios/${usuario.id}`, { method: 'PUT', body: { usuario_id: state.usuario.id, activo: false } });
        toast('Cuenta desactivada', 'exito');
        modal.cerrar();
        abrirModalConfiguracion();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
  const btnReactivar = document.getElementById('eu-reactivar');
  if (btnReactivar) {
    btnReactivar.addEventListener('click', async () => {
      try {
        await apiFetch(`/usuarios/${usuario.id}`, { method: 'PUT', body: { usuario_id: state.usuario.id, activo: true } });
        toast('Cuenta reactivada', 'exito');
        modal.cerrar();
        abrirModalConfiguracion();
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}

function init() {
  initLogin();
  registrarActividadGlobal();
  document.getElementById('btn-logout').addEventListener('click', () => cerrarSesion());
  document.getElementById('btn-config').addEventListener('click', abrirModalConfiguracion);
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
  });

  const guardado = localStorage.getItem('pos_usuario');
  if (guardado) {
    try {
      state.usuario = JSON.parse(guardado);
      mostrarApp();
    } catch { /* ignorar sesión corrupta */ }
  }
}

document.addEventListener('DOMContentLoaded', init);
