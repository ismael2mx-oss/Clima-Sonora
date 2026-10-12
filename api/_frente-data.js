import { MUNICIPIOS } from './_municipios.js';

const TZ = 'America/Hermosillo';
const SONORA_OFFSET = '-07:00';
const CDMX_UTC_OFFSET_H = -6; // México central ya no usa horario de verano

const SMN_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; clima-sonora/1.0; +https://clima-sonora-6fne.vercel.app)', 'Accept-Language': 'es-MX,es;q=0.9' };
const NOAA_HEADERS = { 'User-Agent': 'clima-sonora (https://clima-sonora-6fne.vercel.app)' };

const SMN_PAGES = [
  { id: 'general', nombre: 'Pronóstico Meteorológico General', url: 'https://smn.conagua.gob.mx/es/pronosticos/pronosticossubmenu/pronostico-meteorologico-general' },
  { id: 'extendido', nombre: 'Pronóstico Extendido a 96 h', url: 'https://smn.conagua.gob.mx/es/pronosticos/pronosticossubmenu/pronostico-extendido-a-96-horas' }
];
const WPC_SOURCES = [
  'https://tgftp.nws.noaa.gov/data/raw/as/asus02.kwbc.cod.sus.txt',
  'https://tgftp.nws.noaa.gov/data/raw/as/asus01.kwbc.cod.sus.txt',
  'https://www.wpc.ncep.noaa.gov/discussions/codsus'
];

const BBOX = { latMin: 26, latMax: 33, lonMin: -116, lonMax: -108 };
const MARGEN_KM = 300;
const ENCIMA_KM = 50;
const DEADLINE_MS = 8500;
const CACHE_TTL_MS = 15 * 60 * 1000;

// ---------- utilidades ----------

const memo = new Map();
// Solo se guardan resultados exitosos: un error nunca queda en caché.
async function cached(key, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fn();
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function fetchRetry(url, { headers = {}, as = 'text', timeoutMs = 6000, retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error('tiempo de espera agotado') : err;
      if (i < retries) await new Promise(r => setTimeout(r, 300 * (i + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

function withDeadline(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tiempo de espera agotado')), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const ACCENTS = { 'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e', 'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n' };
// Sustitución 1 a 1: la copia plegada conserva los mismos índices que el texto original.
const fold = s => s.toLowerCase().replace(/[áàäâéèëêíìïîóòöôúùüûñ]/g, c => ACCENTS[c]);

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿',
  ordm: 'º', deg: '°', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»'
};

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m)
    .replace(/[ \s]+/g, ' ')
    .trim()
    .normalize('NFC');
}

const rad = Math.PI / 180;
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = deg => DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];

function localParts(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = t => parts.find(p => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hour: g('hour') };
}
const localHourString = ms => { const p = localParts(ms); return `${p.date}T${p.hour}:00`; };
const localDateString = ms => localParts(ms).date;
const localStringToMs = s => Date.parse(`${s.length === 13 ? s + ':00' : s}${SONORA_OFFSET}`);

// ---------- SMN (texto oficial) ----------

const MESES = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
const FRENTE_RE = /\bfrentes?\s+frios?\s*,?\s*(?:num(?:ero)?\.?|no\.?|n[o°º]\.?|#)\s*(\d{1,2})\b/g;
const ABREVIATURAS = new Set(['num', 'no', 'nº', 'n°', 'km', 'hr', 'hrs', 'mm', 'aprox', 'sr', 'sra', 'dr', 'dra', 'art', 'etc', 'vs']);

function parseAvisoMeta(text) {
  const m = /no\.?\s*aviso:?\s*(\d+)\s+.{0,60}?\s+a\s+(\d{1,2})\s+de\s+([a-z]+)\s+del?\s+(\d{4})\.?\s+emision:?\s*(\d{1,2}):(\d{2})/.exec(fold(text));
  if (!m || MESES[m[3]] === undefined) return { noAviso: m ? Number(m[1]) : null, emitido: null };
  const ms = Date.UTC(Number(m[4]), MESES[m[3]], Number(m[2]), Number(m[5]) - CDMX_UTC_OFFSET_H, Number(m[6]));
  return { noAviso: Number(m[1]), emitido: new Date(ms).toISOString() };
}

function esLimiteDeOracion(text, i) {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  if (!/\s/.test(text[i + 1] || '')) return false;
  if (ch === '.') {
    const antes = /([A-Za-zÁÉÍÓÚáéíóúñÑ°º]+)$/.exec(text.slice(Math.max(0, i - 12), i));
    if (antes && ABREVIATURAS.has(fold(antes[1]))) return false;
  }
  return /^[A-ZÁÉÍÓÚÑ¿¡0-9"“]/.test(text.slice(i + 1).trimStart());
}

function oracionAlrededor(text, start, end) {
  let s = 0;
  for (let i = start - 1; i >= 0; i--) if (esLimiteDeOracion(text, i)) { s = i + 1; break; }
  let e = text.length;
  for (let i = end; i < text.length; i++) if (esLimiteDeOracion(text, i)) { e = i + 1; break; }
  let frase = text.slice(s, e).trim();
  if (frase.length > 320) {
    const rel = start - s;
    const desde = Math.max(0, rel - 140), hasta = Math.min(frase.length, rel + 180);
    frase = `${desde > 0 ? '…' : ''}${frase.slice(desde, hasta).trim()}${hasta < frase.length ? '…' : ''}`;
  }
  return frase;
}

async function loadSmnPage(page) {
  return cached(`smn:${page.id}`, async () => {
    const html = await fetchRetry(page.url, { headers: SMN_HEADERS });
    const full = htmlToText(html);
    const ini = full.search(/No\.?\s*Aviso/i);
    const fin = full.indexOf('Está aquí');
    const text = full.slice(ini >= 0 ? ini : 0, fin > ini ? fin : undefined);
    const meta = parseAvisoMeta(text);
    const norm = fold(text);
    const menciones = [];
    FRENTE_RE.lastIndex = 0;
    let m;
    while ((m = FRENTE_RE.exec(norm))) {
      menciones.push({ numero: Number(m[1]), frase: oracionAlrededor(text, m.index, m.index + m[0].length) });
    }
    return { id: page.id, nombre: page.nombre, url: page.url, ...meta, menciones };
  });
}

export async function loadSmnFrente() {
  const results = await Promise.allSettled(SMN_PAGES.map(loadSmnPage));
  const paginas = results.map((r, i) => r.status === 'fulfilled'
    ? { id: SMN_PAGES[i].id, nombre: SMN_PAGES[i].nombre, ok: true, noAviso: r.value.noAviso, emitido: r.value.emitido }
    : { id: SMN_PAGES[i].id, nombre: SMN_PAGES[i].nombre, ok: false, error: r.reason?.message || 'error desconocido' });
  const buenas = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!buenas.length) throw new Error(`no se pudo leer ninguna página del SMN (${paginas.map(p => p.error).join('; ')})`);

  const porNumero = new Map();
  for (const p of buenas) {
    for (const mn of p.menciones) {
      const actual = porNumero.get(mn.numero);
      const nuevaFecha = p.emitido ? Date.parse(p.emitido) : 0;
      if (!actual || nuevaFecha > actual.ms) {
        porNumero.set(mn.numero, { numero: mn.numero, fuente: p.nombre, url: p.url, noAviso: p.noAviso, emitido: p.emitido, frase: mn.frase, ms: nuevaFecha });
      }
    }
  }
  const frentes = Array.from(porNumero.values()).sort((a, b) => b.numero - a.numero).map(({ ms, ...resto }) => resto);
  return { paginas, parcial: paginas.some(p => !p.ok), frentes };
}

// ---------- WPC (boletín codificado de frentes de superficie) ----------

const TIPOS_WPC = { COLD: 'frente frío', STNRY: 'frente estacionario', OCFNT: 'frente ocluido', TROF: 'vaguada' };
const ELEMENTOS_KM = 600;

const MESES_EN = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const TZ_EN = { EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, UTC: 0, GMT: 0 };

function parsePunto(tok) {
  if (!/^\d+$/.test(tok)) return null;
  let lat, lon;
  if (tok.length === 7) { lat = Number(tok.slice(0, 3)) / 10; lon = -Number(tok.slice(3)) / 10; }
  else if (tok.length === 4 || tok.length === 5) { lat = Number(tok.slice(0, 2)); lon = -Number(tok.slice(2)); }
  else return null;
  return lat >= 0 && lat <= 90 && lon >= -180 && lon <= 0 ? [lat, lon] : null;
}

function parseWpc(text) {
  const emi = /(\d{3,4})\s+(AM|PM)\s+([A-Z]{3,4})\s+[A-Z]{3}\s+([A-Z]{3})\s+(\d{1,2})\s+(\d{4})/.exec(text);
  let emitidoMs = null;
  if (emi && MESES_EN[emi[4]] !== undefined && TZ_EN[emi[3]] !== undefined) {
    const hhmm = emi[1].padStart(4, '0');
    let h = Number(hhmm.slice(0, 2)) % 12;
    if (emi[2] === 'PM') h += 12;
    emitidoMs = Date.UTC(Number(emi[6]), MESES_EN[emi[4]], Number(emi[5]), h - TZ_EN[emi[3]], Number(hhmm.slice(2)));
  }

  let validoMs = null;
  const val = /VALID\s+(\d{2})(\d{2})(\d{2})Z/.exec(text);
  if (val) {
    const base = emitidoMs !== null ? new Date(emitidoMs).getUTCFullYear() : new Date().getUTCFullYear();
    const candidatos = [base - 1, base, base + 1].map(y => Date.UTC(y, Number(val[1]) - 1, Number(val[2]), Number(val[3])));
    const ref = emitidoMs !== null ? emitidoMs : Date.now();
    validoMs = candidatos.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  }

  const bloques = [];
  let bloque = null;
  for (const linea of text.split(/\r?\n/).map(l => l.trim())) {
    if (linea.startsWith('$$')) break;
    const kw = /^([A-Z]+)\b(.*)$/.exec(linea);
    if (kw && /^(COLD|WARM|STNRY|OCFNT|TROF|HIGHS|LOWS)$/.test(kw[1])) {
      bloque = { tipo: kw[1], toks: kw[2].trim().split(/\s+/).filter(Boolean) };
      if (TIPOS_WPC[bloque.tipo]) bloques.push(bloque);
    } else if (bloque && /^[\d\s]+$/.test(linea) && linea) {
      bloque.toks.push(...linea.split(/\s+/));
    } else {
      bloque = null;
    }
  }

  const lineas = bloques
    .map(b => ({ tipo: b.tipo, puntos: b.toks.map(parsePunto).filter(Boolean) }))
    .filter(l => l.puntos.length >= 2);
  return { emitidoMs, validoMs, lineas };
}

function distPuntoCajaKm(lat, lon) {
  const cLat = Math.min(Math.max(lat, BBOX.latMin), BBOX.latMax);
  const cLon = Math.min(Math.max(lon, BBOX.lonMin), BBOX.lonMax);
  return haversine(lat, lon, cLat, cLon);
}

function distLineaCajaKm(pts) {
  let best = { d: Infinity, lat: null, lon: null };
  const probar = (lat, lon) => { const d = distPuntoCajaKm(lat, lon); if (d < best.d) best = { d, lat, lon }; };
  pts.forEach(([la, lo], i) => {
    probar(la, lo);
    if (i === 0) return;
    const [la0, lo0] = pts[i - 1];
    const n = Math.max(1, Math.ceil(haversine(la0, lo0, la, lo) / 25));
    for (let k = 1; k < n; k++) probar(la0 + ((la - la0) * k) / n, lo0 + ((lo - lo0) * k) / n);
  });
  return best;
}

async function loadWpcText() {
  let ultimo;
  for (const url of WPC_SOURCES) {
    try {
      const text = await fetchRetry(url, { headers: NOAA_HEADERS });
      const parsed = parseWpc(text);
      if (parsed.validoMs !== null || parsed.lineas.length) return { url, parsed };
      ultimo = new Error('boletín sin datos reconocibles');
    } catch (err) {
      ultimo = err;
    }
  }
  throw ultimo || new Error('sin respuesta');
}

function boletinSimulado() {
  const now = Date.now() - 3 * 3600 * 1000;
  const d = new Date(now);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0'), dd = String(d.getUTCDate()).padStart(2, '0'), hh = String(d.getUTCHours()).padStart(2, '0');
  return `CODED SURFACE FRONTAL POSITIONS
NWS WEATHER PREDICTION CENTER COLLEGE PARK MD
SIMULACION
VALID ${mm}${dd}${hh}Z
COLD 3301090 3101108 2901126 2701144
STNRY 3301090 3341070 3361050
TROF 3151230 2951200 2751180`;
}

export async function loadWpcFrentes({ simular = false } = {}) {
  let fuente, parsed;
  if (simular) {
    fuente = 'simulación';
    parsed = parseWpc(boletinSimulado());
  } else {
    const r = await cached('wpc', loadWpcText);
    fuente = r.url;
    parsed = r.parsed;
  }
  const analizadas = parsed.lineas.map(l => ({ ...l, cerca: distLineaCajaKm(l.puntos) }));
  const elementos = analizadas
    .filter(l => l.cerca.d <= ELEMENTOS_KM)
    .sort((a, b) => a.cerca.d - b.cerca.d)
    .map(l => ({ tipo: l.tipo, tipoEs: TIPOS_WPC[l.tipo], puntos: l.puntos, distCajaKm: Math.round(l.cerca.d) }));
  // La clasificación de municipios (encima / se acerca / ya pasó) usa solo frentes fríos a 300 km o menos.
  const frentes = elementos.filter(l => l.tipo === 'COLD' && l.distCajaKm <= MARGEN_KM).map(({ puntos, distCajaKm }) => ({ puntos, distCajaKm }));
  // Para comparar con el SMN cuentan los frentes de cualquier tipo (no las vaguadas).
  const hayFrente300 = analizadas.some(l => l.tipo !== 'TROF' && l.cerca.d <= MARGEN_KM);
  const masCercano = analizadas.length ? analizadas.reduce((a, b) => (b.cerca.d < a.cerca.d ? b : a)) : null;
  return {
    fuente,
    valido: parsed.validoMs !== null ? new Date(parsed.validoMs).toISOString() : null,
    emitido: parsed.emitidoMs !== null ? new Date(parsed.emitidoMs).toISOString() : null,
    totalElementos: analizadas.length,
    elementos,
    frentes,
    hayFrente300,
    masCercano: masCercano ? { tipo: masCercano.tipo, tipoEs: TIPOS_WPC[masCercano.tipo], distKm: Math.round(masCercano.cerca.d), lat: masCercano.cerca.lat, lon: masCercano.cerca.lon } : null
  };
}

function clasificarContraFrentes(lat, lon, frentes) {
  let mejor = null;
  for (const f of frentes) {
    for (let i = 1; i < f.puntos.length; i++) {
      const kx = 111.32 * Math.cos(lat * rad), ky = 110.57;
      const ax = (f.puntos[i - 1][1] - lon) * kx, ay = (f.puntos[i - 1][0] - lat) * ky;
      const bx = (f.puntos[i][1] - lon) * kx, by = (f.puntos[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      // En el boletín WPC el aire frío queda a la derecha del sentido en que se listan los puntos.
      if (!mejor || d < mejor.d) mejor = { d, cross: dx * -ay - dy * -ax };
    }
  }
  if (!mejor) return null;
  const distKm = Math.round(mejor.d);
  if (mejor.d < ENCIMA_KM) return { estado: 'encima', distKm };
  if (mejor.cross < 0) return { estado: 'ya_paso', distKm };
  if (mejor.d <= MARGEN_KM) return { estado: 'se_acerca', distKm };
  return { estado: 'sin_influencia', distKm };
}

// ---------- Señales de Open-Meteo (próximas 72 h) ----------

const enArcoNorte = d => Number.isFinite(d) && (d >= 292.5 || d < 67.5); // N, NO y NE

async function loadSenales() {
  return cached('senales', async () => {
    const lats = MUNICIPIOS.map(m => m.lat).join(',');
    const lons = MUNICIPIOS.map(m => m.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=temperature_2m,dew_point_2m,pressure_msl,wind_direction_10m&past_hours=24&forecast_hours=72&timezone=${TZ}`;
    const data = await fetchRetry(url, { as: 'json' });
    const list = Array.isArray(data) ? data : [data];
    if (list.length !== MUNICIPIOS.length) throw new Error('respuesta incompleta de Open-Meteo');
    return list.map(l => l.hourly || {});
  });
}

function analizarPaso(h, ahoraStr) {
  const tiempos = h.time || [];
  const i0 = tiempos.findIndex(t => t >= ahoraStr);
  if (i0 < 0) return { pasos: [], aire: null };
  const T = h.temperature_2m || [], dp = h.dew_point_2m || [], P = h.pressure_msl || [], D = h.wind_direction_10m || [];
  const n = tiempos.length;
  const ok = (...v) => v.every(Number.isFinite);

  // Los umbrales (12 h) son los pedidos, pero cada señal se confirma también contra la misma hora
  // del día anterior: en el desierto el ciclo día-noche solo ya produce esos cambios todos los días.
  const sig = { viento: new Array(n).fill(false), presion: new Array(n).fill(false), rocio: new Array(n).fill(false), temperatura: new Array(n).fill(false) };
  for (let t = 24; t < n; t++) {
    if (ok(D[t], D[t + 1], D[t + 2], D[t - 12], D[t - 24])) {
      sig.viento[t] = enArcoNorte(D[t]) && enArcoNorte(D[t + 1]) && enArcoNorte(D[t + 2]) && !enArcoNorte(D[t - 12]) && !enArcoNorte(D[t - 24]);
    }
    if (ok(P[t], P[t - 12], P[t - 24])) sig.presion[t] = P[t] - P[t - 12] > 3 && P[t] > P[t - 24];
    if (ok(dp[t], dp[t - 12], dp[t - 24])) sig.rocio[t] = dp[t - 12] - dp[t] > 5 && dp[t - 24] - dp[t] > 5;
    if (ok(T[t], T[t - 24])) sig.temperatura[t] = T[t - 24] - T[t] >= 5;
  }

  const activo = (tipo, t) => { for (let u = t; u >= Math.max(0, t - 3); u--) if (sig[tipo][u]) return u; return -1; };
  const detalle = {
    viento: u => `viento del ${compass(D[u])} (${Math.round(D[u])}°) sostenido 3 h`,
    presion: u => `presión +${(P[u] - P[u - 12]).toFixed(1)} hPa en 12 h`,
    rocio: u => `punto de rocío −${(dp[u - 12] - dp[u]).toFixed(1)} °C en 12 h`,
    temperatura: u => `temperatura −${(T[u - 24] - T[u]).toFixed(1)} °C respecto a 24 h antes`
  };

  const activas = t => Object.keys(sig).map(tipo => ({ tipo, u: activo(tipo, t) })).filter(a => a.u >= 0);
  const armar = (t, lista) => ({
    estimado: tiempos[t],
    dir: D[t],
    nSenales: lista.length,
    senales: lista.map(a => ({ tipo: a.tipo, texto: detalle[a.tipo](a.u) }))
  });

  // Paso de frente probable: la subida de presión es obligatoria y se exigen 3 de las 4 señales.
  // Las horas que cumplen y están separadas por 6 h o menos forman una sola pasada; se toma la de más señales.
  const pasos = [];
  let grupo = [];
  const cerrar = () => {
    if (!grupo.length) return;
    const mejor = grupo.reduce((x, y) => (y.a.length > x.a.length ? y : x));
    pasos.push(armar(mejor.t, mejor.a));
    grupo = [];
  };
  for (let t = i0; t < n; t++) {
    const a = activas(t);
    if (a.length >= 3 && a.some(x => x.tipo === 'presion')) {
      if (grupo.length && t - grupo[grupo.length - 1].t > 6) cerrar();
      grupo.push({ t, a });
    }
  }
  cerrar();

  // Con 2 señales (o 3 sin subida de presión) solo hay aire más seco/fresco, no paso de frente.
  let aire = null;
  if (!pasos.length) {
    let mejor = null;
    for (let t = i0; t < n; t++) {
      const a = activas(t);
      if (a.length >= 2 && (!mejor || a.length > mejor.a.length)) mejor = { t, a };
    }
    if (mejor) aire = armar(mejor.t, mejor.a);
  }
  return { pasos, aire };
}

const N_NO = new Set(['N', 'NNO', 'NO']);
const E_ENE = new Set(['E', 'ENE']);
const HORA_MS = 3600000;
const SEPARACION_EVENTOS_H = 36;
const ORDEN_TOLERANCIA_H = 12;

const mediana = arr => { const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Agrupa los pasos estimados en eventos. En un mismo municipio, dos pasos son eventos distintos si los separan
// más de 36 h o si el viento pasa de N/NO a E/ENE. Los municipios con un solo paso se asignan al evento
// cuya hora central les queda más cerca.
function agruparEventos(candidatos) {
  const filas = [];
  candidatos.forEach(c => {
    let ord = 1;
    c.pasos.forEach((p, k) => {
      if (k > 0) {
        const prev = c.pasos[k - 1];
        const gapH = (localStringToMs(p.estimado) - localStringToMs(prev.estimado)) / HORA_MS;
        if (gapH > SEPARACION_EVENTOS_H || (N_NO.has(compass(prev.dir)) && E_ENE.has(compass(p.dir)))) ord++;
      }
      filas.push({ c, p, ms: localStringToMs(p.estimado), ord });
    });
  });
  if (!filas.length) return [];

  const maxOrd = Math.max(...filas.map(f => f.ord));
  if (maxOrd > 1) {
    const multi = new Set(filas.filter(f => f.ord > 1).map(f => f.c));
    const centros = [];
    for (let k = 1; k <= maxOrd; k++) {
      const ms = filas.filter(f => multi.has(f.c) && f.ord === k).map(f => f.ms);
      centros.push(ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : Infinity);
    }
    filas.filter(f => !multi.has(f.c)).forEach(f => {
      f.ord = centros.reduce((mejor, cen, i) => (Math.abs(f.ms - cen) < Math.abs(f.ms - centros[mejor]) ? i : mejor), 0) + 1;
    });
  }

  const eventos = [];
  for (let k = 1; k <= maxOrd; k++) {
    const porMunicipio = new Map();
    filas.filter(f => f.ord === k).forEach(f => {
      const actual = porMunicipio.get(f.c);
      if (!actual || f.ms < actual.ms) porMunicipio.set(f.c, f);
    });
    if (!porMunicipio.size) continue;
    const miembros = Array.from(porMunicipio.values()).sort((a, b) => a.ms - b.ms);
    const norte = miembros.filter(f => f.c.lat >= 30).map(f => f.ms);
    const sur = miembros.filter(f => f.c.lat <= 28).map(f => f.ms);
    let nota = null;
    if (norte.length >= 2 && sur.length >= 2 && mediana(sur) < mediana(norte) - ORDEN_TOLERANCIA_H * HORA_MS) nota = 'orden inconsistente, revisar';
    eventos.push({
      numero: eventos.length + 1,
      desde: miembros[0].p.estimado,
      hasta: miembros[miembros.length - 1].p.estimado,
      nota,
      municipios: miembros.map(f => ({ municipio: f.c.municipio, estimado: f.p.estimado, nSenales: f.p.nSenales, senales: f.p.senales }))
    });
  }
  return eventos;
}

// ---------- Estado combinado ----------

export async function loadFrenteEstado({ simular = false } = {}) {
  const ahoraMs = Date.now();
  const ahoraStr = localHourString(ahoraMs);
  const hoy = localDateString(ahoraMs);
  const manana = localDateString(ahoraMs + 24 * 3600 * 1000);
  const pasadoManana = localDateString(ahoraMs + 48 * 3600 * 1000);

  const [smnR, wpcR, senR] = await Promise.allSettled([
    withDeadline(loadSmnFrente(), DEADLINE_MS),
    withDeadline(loadWpcFrentes({ simular }), DEADLINE_MS),
    withDeadline(loadSenales(), DEADLINE_MS)
  ]);

  const wpc = wpcR.status === 'fulfilled' ? wpcR.value : null;
  const senales = senR.status === 'fulfilled' ? senR.value : null;

  // Cada municipio queda en una sola categoría, así que siempre suman 72. Orden de prioridad: el análisis
  // del WPC ("encima", "ya pasó") prevalece sobre las señales; luego paso de frente, "se acerca",
  // aire más seco/fresco y, al final, sin señal.
  const municipios = MUNICIPIOS.map((m, i) => {
    const w = wpc ? clasificarContraFrentes(m.lat, m.lon, wpc.frentes) : null;
    const an = senales ? analizarPaso(senales[i], ahoraStr) : { pasos: [], aire: null };
    let categoria;
    if (w?.estado === 'encima') categoria = 'encima';
    else if (w?.estado === 'ya_paso') categoria = 'ya_paso';
    else if (an.pasos.length) categoria = 'paso';
    else if (w?.estado === 'se_acerca') categoria = 'se_acerca';
    else if (an.aire) categoria = 'aire';
    else categoria = 'sin_senal';
    return { municipio: m.municipio, cabecera: m.cabecera, lat: m.lat, lon: m.lon, wpc: w, categoria, pasos: an.pasos, aire: an.aire };
  });

  const eventos = agruparEventos(municipios.filter(m => m.categoria === 'paso'));
  const eventoDe = new Map();
  eventos.forEach(ev => ev.municipios.forEach(x => { if (!eventoDe.has(x.municipio)) eventoDe.set(x.municipio, { numero: ev.numero, ...x }); }));
  municipios.forEach(m => {
    const ev = eventoDe.get(m.municipio);
    m.paso = ev ? { estimado: ev.estimado, nSenales: ev.nSenales, senales: ev.senales, evento: ev.numero } : null;
    delete m.pasos;
  });

  const nombres = cat => municipios.filter(m => m.categoria === cat).map(m => m.municipio);
  const grupos = {
    encima: nombres('encima'),
    seAcerca: nombres('se_acerca'),
    yaPaso: nombres('ya_paso'),
    paso: nombres('paso'),
    aire: nombres('aire'),
    sinSenal: nombres('sin_senal')
  };

  const notas = [];
  if (smnR.status === 'fulfilled' && smnR.value.frentes.length && wpc && !wpc.hayFrente300) {
    notas.push('el SMN y el WPC no coinciden en la posición del frente');
  }

  const error = r => (r.status === 'rejected' ? (r.reason?.message || 'error desconocido') : null);
  return {
    generado: new Date(ahoraMs).toISOString(),
    simulacion: simular,
    fechas: { hoy, manana, pasadoManana },
    smn: smnR.status === 'fulfilled' ? { ok: true, ...smnR.value } : { ok: false, error: error(smnR) },
    wpc: wpc ? { ok: true, ...wpc } : { ok: false, error: error(wpcR) },
    senales: senales ? { ok: true } : { ok: false, error: error(senR) },
    municipios,
    eventos,
    grupos,
    notas,
    hayError: smnR.status === 'rejected' || wpcR.status === 'rejected' || senR.status === 'rejected' || (smnR.status === 'fulfilled' && smnR.value.parcial)
  };
}

export { localStringToMs, compass };
