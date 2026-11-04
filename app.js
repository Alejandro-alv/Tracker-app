// ===================== ESTADO / CONFIG CACHEADA =====================
const CACHE_KEY = 'gastos_config_cache';
const QUEUE_KEY = 'gastos_pending_queue';
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto",
               "septiembre","octubre","noviembre","diciembre"];
const DIAS = ["D","L","M","M","J","V","S"];

function emptyConfig() {
  return { categorias: [], medios: [], categoriasIngreso: [], deudas: [], recordatorios: [], resumenes: [] };
}
let CONFIG = emptyConfig();

// Lo que ya hice en esta sesión y el servidor puede tardar unos segundos en reflejar
const sessionPaidIds = new Set();
const sessionPaidRes = new Map(); // 'medio|desde' -> fecha de pago

// ===================== UTILIDADES DE FECHA / FORMATO =====================
function fmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function fmtDisplay(d) {
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}
function isoToday() { return fmtISO(new Date()); }
function isoAddDays(iso, n) {
  const p = iso.split('-').map(Number);
  return fmtISO(new Date(p[0], p[1]-1, p[2] + n));
}
function isoToShort(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + '/' + p[1];
}
function money(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function byVenc(a, b) {
  if (!a.vencimiento) return 1;
  if (!b.vencimiento) return -1;
  return a.vencimiento < b.vencimiento ? -1 : (a.vencimiento > b.vencimiento ? 1 : 0);
}
function isoToDate(iso) {
  const p = iso.split('-').map(Number);
  return new Date(p[0], p[1]-1, p[2]);
}
// date = null deja el campo vacío (para fechas opcionales)
function setDateField(displayId, date) {
  const d = document.getElementById(displayId);
  if (!date) { d.value = ''; delete d.dataset.iso; return; }
  d.value = fmtDisplay(date);
  d.dataset.iso = fmtISO(date);
}
function clearDate(displayId) { setDateField(displayId, null); }

// ===================== CONFIG: CACHE + REFRESCO =====================
function saveCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(CONFIG)); } catch (e) {}
}

function loadCachedConfig() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) CONFIG = Object.assign(emptyConfig(), JSON.parse(raw));
  } catch (e) {}
}

// Superpone lo que todavía está en la cola sin enviar (y lo hecho en esta sesión) sobre los datos del servidor
function applyPending(cfg) {
  cfg.recordatorios = (cfg.recordatorios || []).filter(r => !sessionPaidIds.has(r.id));
  (cfg.resumenes || []).forEach(x => {
    const k = x.medio + '|' + x.desde;
    if (sessionPaidRes.has(k)) { x.pagado = true; x.fechaPago = x.fechaPago || sessionPaidRes.get(k); }
  });
  getQueue().forEach(item => {
    if (item.tipo === 'Recordatorio') {
      if (!cfg.recordatorios.some(r => r.id === item.id)) {
        cfg.recordatorios.push({
          id: item.id, concepto: item.concepto, monto: Number(item.monto),
          vencimiento: item.vencimiento, recurrente: !!item.recurrente,
          vencido: item.vencimiento < isoToday(), categoria: '', medio: ''
        });
      }
    } else if (item.tipo === 'PagarRecordatorio') {
      cfg.recordatorios = cfg.recordatorios.filter(r => r.id !== item.id);
    } else if (item.tipo === 'PagarResumen') {
      (cfg.resumenes || []).forEach(x => {
        if (x.medio === item.medio && x.desde === item.desde) {
          x.pagado = true;
          x.fechaPago = item.fecha;
        }
      });
    }
  });
  cfg.recordatorios.sort(byVenc);
  return cfg;
}

async function refreshConfig() {
  try {
    const url = APPS_SCRIPT_URL + '?secreto=' + encodeURIComponent(SECRETO);
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      CONFIG = applyPending(Object.assign(emptyConfig(), data));
      saveCache();
      setupAllCombos();
      renderPagos();
    }
  } catch (e) {
    // sin conexión: seguimos con lo que haya en cache
  }
}

// ===================== NAVEGACIÓN ENTRE PANTALLAS =====================
function showScreen(name, opts) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'pagos') {
    renderPagos();
    if (!(opts && opts.skipRefresh)) refreshConfig();
  }
}

// ===================== COMBOBOX BUSCABLE =====================
const comboSources = {};

function setupCombo(inputId, listId, getItems, onPick) {
  comboSources[inputId] = getItems;
  const input = document.getElementById(inputId);
  if (input.dataset.comboReady) return; // los listeners se agregan una sola vez
  input.dataset.comboReady = '1';
  const list = document.getElementById(listId);

  function render(filter) {
    const items = comboSources[inputId]().slice().sort((a,b) => a.localeCompare(b, 'es'));
    const f = filter.trim().toLowerCase();
    const matches = items.filter(i => i.toLowerCase().includes(f));
    list.innerHTML = '';
    if (matches.length === 0) { list.style.display = 'none'; return; }
    matches.forEach(name => {
      const opt = document.createElement('div');
      opt.textContent = name;
      opt.onclick = () => {
        input.value = name;
        list.style.display = 'none';
        if (onPick) onPick(name);
      };
      list.appendChild(opt);
    });
    list.style.display = 'block';
  }

  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => render(input.value));
  document.addEventListener('click', (e) => {
    if (!input.parentElement.contains(e.target)) list.style.display = 'none';
  });
}

// Tarjetas de crédito = las que tienen períodos cargados en la hoja
function tarjetasConPeriodos() {
  return [...new Set((CONFIG.resumenes || []).map(x => x.medio))];
}

function setupAllCombos() {
  setupCombo('g-cat-input', 'g-cat-list', () => CONFIG.categorias || []);
  setupCombo('g-medio-input', 'g-medio-list', () => CONFIG.medios || []);
  setupCombo('i-cat-input', 'i-cat-list', () => CONFIG.categoriasIngreso || []);
  setupCombo('d-deuda-input', 'd-deuda-list', () => CONFIG.deudas || []);
  setupCombo('p-cat-input', 'p-cat-list', () => CONFIG.categorias || []);
  setupCombo('p-medio-input', 'p-medio-list', () => CONFIG.medios || []);
  setupCombo('q-medio-input', 'q-medio-list', tarjetasConPeriodos, prefillPeriodo);
}

// ===================== CALENDARIO PROPIO =====================
function setupCalendar(displayId, panelId, startBlank) {
  const display = document.getElementById(displayId);
  const panel = document.getElementById(panelId);
  let viewDate = new Date();

  function render() {
    panel.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'cal-header';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const label = document.createElement('span'); label.textContent = MESES[viewDate.getMonth()] + ' ' + viewDate.getFullYear();
    label.style.fontSize = '13px'; label.style.fontWeight = '600';
    const next = document.createElement('button'); next.textContent = '›';
    prev.onclick = (e) => { e.stopPropagation(); viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1); render(); };
    next.onclick = (e) => { e.stopPropagation(); viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1); render(); };
    header.appendChild(prev); header.appendChild(label); header.appendChild(next);
    panel.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    DIAS.forEach(d => {
      const h = document.createElement('div');
      h.className = 'daylabel'; h.textContent = d;
      grid.appendChild(h);
    });
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 0).getDate();
    const today = new Date();
    for (let i=0;i<startOffset;i++) grid.appendChild(document.createElement('div'));
    for (let d=1; d<=daysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'day';
      cell.textContent = d;
      if (d===today.getDate() && viewDate.getMonth()===today.getMonth() && viewDate.getFullYear()===today.getFullYear()) {
        cell.classList.add('today');
      }
      cell.onclick = (e) => {
        e.stopPropagation();
        setDateField(displayId, new Date(viewDate.getFullYear(), viewDate.getMonth(), d));
        panel.style.display = 'none';
      };
      grid.appendChild(cell);
    }
    panel.appendChild(grid);
  }

  display.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = panel.style.display === 'block';
    document.querySelectorAll('.cal-panel').forEach(p => p.style.display = 'none');
    if (!isOpen) {
      if (display.dataset.iso) {
        const p = display.dataset.iso.split('-').map(Number);
        viewDate = new Date(p[0], p[1]-1, 1);
      }
      render();
      panel.style.display = 'block';
    }
  });
  document.addEventListener('click', (e) => {
    if (!display.parentElement.contains(e.target)) panel.style.display = 'none';
  });

  setDateField(displayId, startBlank ? null : new Date()); // por defecto: hoy
}

// ===================== TOAST =====================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

// ===================== GUARDADO + COLA OFFLINE =====================
function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch (e) { return []; }
}
function setQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  updatePendingBanner();
}
function updatePendingBanner() {
  const q = getQueue();
  const banner = document.getElementById('pending-banner');
  banner.textContent = q.length > 0 ? `${q.length} registro(s) pendiente(s) de sincronizar` : '';
}

async function enviarAlServer(payload) {
  const body = Object.assign({}, payload, { secreto: SECRETO });
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  // con no-cors no podemos leer la respuesta; si no tira excepción, asumimos que salió.
}

async function guardarConCola(payload, mensajeExito) {
  if (!navigator.onLine) {
    const q = getQueue(); q.push(payload); setQueue(q);
    showToast(mensajeExito + ' (sin conexión, se sincroniza solo)');
    return;
  }
  try {
    await enviarAlServer(payload);
    showToast(mensajeExito);
  } catch (e) {
    const q = getQueue(); q.push(payload); setQueue(q);
    showToast(mensajeExito + ' (sin conexión, se sincroniza solo)');
  }
}

async function flushQueue() {
  if (!navigator.onLine) return;
  let q = getQueue();
  if (q.length === 0) return;
  const remaining = [];
  for (const item of q) {
    try { await enviarAlServer(item); }
    catch (e) { remaining.push(item); }
  }
  setQueue(remaining);
  if (remaining.length === 0 && q.length > 0) {
    showToast('Sincronizado ✓');
    setTimeout(refreshConfig, 3500);
  }
}

window.addEventListener('online', flushQueue);
setInterval(flushQueue, 30000);

// ===================== ACCIONES DE GUARDAR =====================
function isoFrom(displayId) {
  return document.getElementById(displayId).dataset.iso;
}

async function guardarGasto() {
  const monto = document.getElementById('g-monto').value;
  const categoria = document.getElementById('g-cat-input').value;
  const medio = document.getElementById('g-medio-input').value;
  const concepto = document.getElementById('g-concepto').value;
  const fecha = isoFrom('g-date-display');
  if (!monto || !categoria || !medio) { showToast('Falta monto, categoría o medio'); return; }

  await guardarConCola({ tipo: 'Gasto', fecha, categoria, medio, concepto, monto }, 'Gasto guardado');
  document.getElementById('g-monto').value = '';
  document.getElementById('g-cat-input').value = '';
  document.getElementById('g-medio-input').value = '';
  document.getElementById('g-concepto').value = '';
}

async function guardarIngreso() {
  const monto = document.getElementById('i-monto').value;
  const categoria = document.getElementById('i-cat-input').value;
  const concepto = document.getElementById('i-concepto').value;
  const fecha = isoFrom('i-date-display');
  if (!monto || !categoria) { showToast('Falta monto o categoría'); return; }

  await guardarConCola({ tipo: 'Ingreso', fecha, categoria, concepto, monto }, 'Ingreso guardado');
  document.getElementById('i-monto').value = '';
  document.getElementById('i-cat-input').value = '';
  document.getElementById('i-concepto').value = '';
  showScreen('gasto');
}

async function guardarDeuda() {
  const deuda = document.getElementById('d-deuda-input').value;
  const monto = document.getElementById('d-monto').value;
  const concepto = document.getElementById('d-concepto').value;
  const fecha = isoFrom('d-date-display');
  if (!monto || !deuda) { showToast('Falta deuda o monto'); return; }

  await guardarConCola({ tipo: 'Deuda', deuda, fecha, monto, concepto }, 'Pago guardado');
  document.getElementById('d-monto').value = '';
  document.getElementById('d-deuda-input').value = '';
  document.getElementById('d-concepto').value = '';
  showScreen('gasto');
}

// ===================== PAGOS: LISTA =====================
function renderPagos() {
  const hoy = isoToday();

  // --- Recordatorios ---
  const recList = document.getElementById('rec-list');
  recList.innerHTML = '';
  const recs = (CONFIG.recordatorios || []).slice().sort(byVenc);
  if (recs.length === 0) recList.appendChild(el('div', 'empty', 'Sin pagos pendientes'));
  recs.forEach(r => {
    const vencido = !!r.vencimiento && r.vencimiento < hoy;
    const row = el('div', 'item' + (vencido ? ' overdue' : ''));

    const left = el('div', 'item-main');
    left.appendChild(el('div', 'item-title', r.concepto));
    const suffix = r.recurrente ? ' · mensual' : '';
    const subText = r.vencimiento
      ? (vencido ? 'Vencido el ' : 'Vence el ') + isoToShort(r.vencimiento) + suffix
      : 'Sin fecha' + suffix;
    left.appendChild(el('div', 'item-sub' + (vencido ? ' warn' : ''), subText));

    const right = el('div', 'item-right');
    right.appendChild(el('div', 'item-amount', money(r.monto)));
    const btn = el('button', 'mini-btn', 'Marcar pagado');
    btn.onclick = () => abrirPagar(r.id);
    right.appendChild(btn);

    row.appendChild(left);
    row.appendChild(right);
    recList.appendChild(row);
  });

  // --- Resúmenes de tarjeta, uno por período ---
  const resList = document.getElementById('res-list');
  resList.innerHTML = '';
  const hace14 = isoAddDays(hoy, -14);
  const visibles = (CONFIG.resumenes || [])
    .filter(x => x.desde <= hoy && (!x.pagado || (x.fechaPago && x.fechaPago >= hace14)))
    .sort((a, b) => {
      const av = a.vencimiento || '9999-12-31', bv = b.vencimiento || '9999-12-31';
      if (av !== bv) return av < bv ? -1 : 1;
      return a.medio < b.medio ? -1 : (a.medio > b.medio ? 1 : 0);
    });
  if (visibles.length === 0) {
    resList.appendChild(el('div', 'empty', 'Sin resúmenes para mostrar. Definí el período de tu tarjeta.'));
  }
  visibles.forEach(x => {
    const cerrado = !!x.hasta && x.hasta < hoy;
    const vencido = !x.pagado && cerrado && !!x.vencimiento && x.vencimiento < hoy;
    const rango = isoToShort(x.desde) + ' al ' + (x.hasta ? isoToShort(x.hasta) : '…');

    let subText;
    if (x.pagado) {
      subText = rango;
    } else if (!cerrado) {
      subText = 'En curso · ' + (x.hasta ? 'cierra el ' + isoToShort(x.hasta) : 'cierre a confirmar') +
        (x.vencimiento ? ' · vence el ' + isoToShort(x.vencimiento) : '');
    } else if (x.vencimiento) {
      subText = rango + ' · ' + (vencido ? 'Vencido el ' : 'Vence el ') + isoToShort(x.vencimiento);
    } else {
      subText = rango + ' · vencimiento a confirmar';
    }

    const row = el('div', 'item' + (vencido ? ' overdue' : ''));
    const left = el('div', 'item-main');
    left.appendChild(el('div', 'item-title', x.medio));
    left.appendChild(el('div', 'item-sub' + (vencido ? ' warn' : ''), subText));
    const right = el('div', 'item-right');
    right.appendChild(el('div', 'item-amount', money(x.monto)));
    if (x.pagado) {
      right.appendChild(el('div', 'done-tag', 'Pagado ✓'));
    } else if (cerrado) {
      const btn = el('button', 'mini-btn', 'Marcar pagado');
      btn.onclick = () => marcarResumenPagado(x.medio, x.desde);
      right.appendChild(btn);
    } else {
      right.appendChild(el('div', 'done-tag', 'Hasta hoy'));
    }
    row.appendChild(left);
    row.appendChild(right);
    resList.appendChild(row);
  });
}

// ===================== PAGOS: DEFINIR PERÍODO DE TARJETA =====================
// Carga los datos del período abierto de esa tarjeta (o del último) para completarlos.
function prefillPeriodo(medio) {
  const delMedio = (CONFIG.resumenes || []).filter(x => x.medio === medio)
    .sort((a, b) => a.desde < b.desde ? -1 : (a.desde > b.desde ? 1 : 0));
  const objetivo = delMedio.find(x => !x.hasta) || delMedio[delMedio.length - 1];
  if (!objetivo) return;
  setDateField('q-desde-display', isoToDate(objetivo.desde));
  setDateField('q-hasta-display', objetivo.hasta ? isoToDate(objetivo.hasta) : null);
  setDateField('q-venc-display', objetivo.vencimiento ? isoToDate(objetivo.vencimiento) : null);
}

function abrirPeriodo() {
  document.getElementById('q-medio-input').value = '';
  setDateField('q-desde-display', null);
  setDateField('q-hasta-display', null);
  setDateField('q-venc-display', null);
  showScreen('periodo');
}

async function guardarPeriodo() {
  const medio = document.getElementById('q-medio-input').value;
  const desde = isoFrom('q-desde-display') || '';
  const hasta = isoFrom('q-hasta-display') || '';
  const vencimiento = isoFrom('q-venc-display') || '';
  if (!medio || !desde) { showToast('Falta tarjeta o fecha de inicio'); return; }
  if (!tarjetasConPeriodos().includes(medio)) {
    showToast('Esa tarjeta no tiene períodos cargados en la hoja'); return;
  }
  if (hasta && hasta < desde) { showToast('El cierre es anterior al inicio'); return; }
  if (vencimiento && hasta && vencimiento < hasta) { showToast('El vencimiento es anterior al cierre'); return; }

  await guardarConCola({ tipo: 'Periodo', medio, desde, hasta, vencimiento }, 'Período guardado');
  showScreen('pagos', { skipRefresh: true });
  setTimeout(refreshConfig, 3500);
}

// ===================== PAGOS: NUEVO RECORDATORIO =====================
let nRecurrente = false;

function setRecurrente(val) {
  nRecurrente = !!val;
  document.getElementById('n-rec-si').classList.toggle('on', nRecurrente);
  document.getElementById('n-rec-no').classList.toggle('on', !nRecurrente);
}

function abrirNuevoRecordatorio() {
  document.getElementById('n-monto').value = '';
  document.getElementById('n-concepto').value = '';
  setDateField('n-date-display', new Date());
  setRecurrente(false);
  showScreen('nuevo-rec');
}

async function guardarRecordatorio() {
  const monto = document.getElementById('n-monto').value;
  const concepto = document.getElementById('n-concepto').value.trim();
  const vencimiento = isoFrom('n-date-display');
  if (!monto || !concepto || !vencimiento) { showToast('Falta monto, concepto o vencimiento'); return; }

  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await guardarConCola(
    { tipo: 'Recordatorio', id, concepto, monto, vencimiento, recurrente: nRecurrente },
    'Recordatorio guardado'
  );

  // se muestra enseguida, sin esperar al servidor
  CONFIG.recordatorios.push({
    id, concepto, monto: Number(monto), vencimiento, recurrente: nRecurrente,
    vencido: vencimiento < isoToday(), categoria: '', medio: ''
  });
  CONFIG.recordatorios.sort(byVenc);
  saveCache();

  showScreen('pagos', { skipRefresh: true });
  setTimeout(refreshConfig, 3500);
}

// ===================== PAGOS: MARCAR PAGADO =====================
let payingId = null;

function abrirPagar(id) {
  const r = (CONFIG.recordatorios || []).find(x => x.id === id);
  if (!r) return;
  payingId = id;
  document.getElementById('p-concepto').textContent = r.concepto;
  document.getElementById('p-monto').value = r.monto || '';
  document.getElementById('p-cat-input').value = r.categoria || '';   // lo que usaste la vez anterior
  document.getElementById('p-medio-input').value = r.medio || '';
  setDateField('p-date-display', new Date());
  showScreen('pagar');
}

async function confirmarPago() {
  const id = payingId;
  const monto = document.getElementById('p-monto').value;
  const categoria = document.getElementById('p-cat-input').value;
  const medio = document.getElementById('p-medio-input').value;
  const fecha = isoFrom('p-date-display');
  if (!id) return;
  if (!monto || !categoria || !medio) { showToast('Falta monto, categoría o medio'); return; }

  await guardarConCola({ tipo: 'PagarRecordatorio', id, fecha, categoria, medio, monto }, 'Pago registrado');

  sessionPaidIds.add(id);
  CONFIG.recordatorios = CONFIG.recordatorios.filter(r => r.id !== id);
  saveCache();
  payingId = null;

  showScreen('pagos', { skipRefresh: true });
  setTimeout(refreshConfig, 3500);
}

// Resumen de tarjeta: solo se anota como pagado. No crea ningún gasto (los consumos ya están cargados).
async function marcarResumenPagado(medio, desde) {
  if (!window.confirm('¿Marcar como pagado el resumen de ' + medio + ' (desde el ' + isoToShort(desde) + ')?')) return;

  const fecha = isoToday();
  await guardarConCola({ tipo: 'PagarResumen', medio, desde, fecha }, 'Resumen marcado como pagado');

  sessionPaidRes.set(medio + '|' + desde, fecha);
  (CONFIG.resumenes || []).forEach(x => {
    if (x.medio === medio && x.desde === desde) { x.pagado = true; x.fechaPago = fecha; }
  });
  saveCache();
  renderPagos();
}

// ===================== INIT =====================
loadCachedConfig();
setupAllCombos();
setupCalendar('g-date-display', 'g-cal-panel');
setupCalendar('i-date-display', 'i-cal-panel');
setupCalendar('d-date-display', 'd-cal-panel');
setupCalendar('n-date-display', 'n-cal-panel');
setupCalendar('p-date-display', 'p-cal-panel');
setupCalendar('q-desde-display', 'q-desde-panel', true);
setupCalendar('q-hasta-display', 'q-hasta-panel', true);
setupCalendar('q-venc-display', 'q-venc-panel', true);
updatePendingBanner();
renderPagos();
refreshConfig();
flushQueue();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
