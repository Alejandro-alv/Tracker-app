// ===================== ESTADO / CONFIG CACHEADA =====================
const CACHE_KEY = 'gastos_config_cache';
const QUEUE_KEY = 'gastos_pending_queue';
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto",
               "septiembre","octubre","noviembre","diciembre"];
const DIAS = ["D","L","M","M","J","V","S"];

let CONFIG = { categorias: [], medios: [], categoriasIngreso: [], deudas: [] };

function loadCachedConfig() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) CONFIG = JSON.parse(raw);
  } catch (e) {}
}

async function refreshConfig() {
  try {
    const url = APPS_SCRIPT_URL + '?secreto=' + encodeURIComponent(SECRETO);
    const res = await fetch(url);
    const data = await res.json();
    if (data.ok) {
      CONFIG = data;
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      setupAllCombos();
    }
  } catch (e) {
    // sin conexión: seguimos con lo que haya en cache
  }
}

// ===================== NAVEGACIÓN ENTRE PANTALLAS =====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

// ===================== COMBOBOX BUSCABLE =====================
function setupCombo(inputId, listId, getItems) {
  const input = document.getElementById(inputId);
  const list = document.getElementById(listId);

  function render(filter) {
    const items = getItems().slice().sort((a,b) => a.localeCompare(b, 'es'));
    const f = filter.trim().toLowerCase();
    const matches = items.filter(i => i.toLowerCase().includes(f));
    list.innerHTML = '';
    if (matches.length === 0) { list.style.display = 'none'; return; }
    matches.forEach(name => {
      const opt = document.createElement('div');
      opt.textContent = name;
      opt.onclick = () => { input.value = name; list.style.display = 'none'; };
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

function setupAllCombos() {
  setupCombo('g-cat-input', 'g-cat-list', () => CONFIG.categorias || []);
  setupCombo('g-medio-input', 'g-medio-list', () => CONFIG.medios || []);
  setupCombo('i-cat-input', 'i-cat-list', () => CONFIG.categoriasIngreso || []);
  setupCombo('d-deuda-input', 'd-deuda-list', () => CONFIG.deudas || []);
}

// ===================== CALENDARIO PROPIO =====================
function setupCalendar(displayId, panelId) {
  const display = document.getElementById(displayId);
  const panel = document.getElementById(panelId);
  let viewDate = new Date();

  function fmtDisplay(d) {
    return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
  }
  function fmtISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }

  function render() {
    panel.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'cal-header';
    const prev = document.createElement('button'); prev.textContent = '‹';
    const label = document.createElement('span'); label.textContent = MESES[viewDate.getMonth()] + ' ' + viewDate.getFullYear();
    label.style.fontSize = '13px'; label.style.fontWeight = '600';
    const next = document.createElement('button'); next.textContent = '›';
    prev.onclick = (e) => { e.stopPropagation(); viewDate.setMonth(viewDate.getMonth()-1); render(); };
    next.onclick = (e) => { e.stopPropagation(); viewDate.setMonth(viewDate.getMonth()+1); render(); };
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
        const chosen = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        display.value = fmtDisplay(chosen);
        display.dataset.iso = fmtISO(chosen);
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
    if (!isOpen) { render(); panel.style.display = 'block'; }
  });
  document.addEventListener('click', (e) => {
    if (!display.parentElement.contains(e.target)) panel.style.display = 'none';
  });

  // default: hoy
  const today = new Date();
  display.value = fmtDisplay(today);
  display.dataset.iso = fmtISO(today);
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
  banner.textContent = q.length > 0 ? `${q.length} movimiento(s) pendiente(s) de sincronizar` : '';
}

async function enviarAlServer(payload) {
  payload.secreto = SECRETO;
  await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
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
  if (remaining.length === 0 && q.length > 0) showToast('Sincronizado ✓');
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
  const fecha = isoFrom('d-date-display');
  if (!monto || !deuda) { showToast('Falta deuda o monto'); return; }

  await guardarConCola({ tipo: 'Deuda', deuda, fecha, monto }, 'Pago guardado');
  document.getElementById('d-monto').value = '';
  document.getElementById('d-deuda-input').value = '';
  showScreen('gasto');
}

// ===================== INIT =====================
loadCachedConfig();
setupAllCombos();
setupCalendar('g-date-display', 'g-cal-panel');
setupCalendar('i-date-display', 'i-cal-panel');
setupCalendar('d-date-display', 'd-cal-panel');
updatePendingBanner();
refreshConfig();
flushQueue();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
