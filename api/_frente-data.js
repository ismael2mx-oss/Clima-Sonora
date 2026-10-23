import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteo, PLAZO_OPEN_METEO_MS } from './_openmeteo.js';

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
const FRENTE_RE = /\bfrentes?\s+frios?\s*[,(]?\s*(?:num(?:ero)?\.?|no\.?|n[o°º]\.?|#)\s*(\d{1,2})\b/g;
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

// Divide un texto del SMN en oraciones respetando abreviaturas como "núm." y "km".
export function dividirOraciones(text) {
  const out = [];
  let ini = 0;
  for (let i = 0; i < text.length; i++) {
    if (esLimiteDeOracion(text, i)) { out.push(text.slice(ini, i + 1).trim()); ini = i + 1; }
  }
  const resto = text.slice(ini).trim();
  if (resto) out.push(resto);
  return out;
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
    return { id: page.id, nombre: page.nombre, url: page.url, ...meta, menciones, texto: text };
  });
}

// Texto completo de las páginas del SMN (aviso general y pronóstico extendido) para quien necesite analizarlo.
export async function loadSmnTextos() {
  const results = await Promise.allSettled(SMN_PAGES.map(loadSmnPage));
  return results.map((r, i) => r.status === 'fulfilled'
    ? { ok: true, id: SMN_PAGES[i].id, nombre: SMN_PAGES[i].nombre, url: SMN_PAGES[i].url, noAviso: r.value.noAviso, emitido: r.value.emitido, texto: r.value.texto }
    : { ok: false, id: SMN_PAGES[i].id, nombre: SMN_PAGES[i].nombre, url: SMN_PAGES[i].url, error: r.reason?.message || 'error desconocido' });
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

// ---------- Avance del frente (comparación con el análisis anterior del WPC) ----------

// El archivo de productos de texto de IEM (Iowa State) conserva los boletines anteriores; tgftp solo guarda el último.
const WPC_ARCHIVO_URL = 'https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=CODSUS&limit=8&fmt=text';
const PREVIO_IDEAL_H = 6;
const PREVIO_MIN_H = 2;
const PREVIO_MAX_H = 12;
const VISTA = { latMin: 26.2, latMax: 32.9, lonMin: -115.8, lonMax: -108.0 }; // lo que muestra el mapa
const AVANCE_MARGEN_GRADOS = 2;     // se promedia el desplazamiento en la zona de Sonora ampliada
const AVANCE_LENTO_KMH = 5;

function elegirPrevio(textoArchivo, validoMs) {
  if (!textoArchivo || validoMs === null) return null;
  const candidatos = textoArchivo.split(/(?=^ASUS0[12] KWBC)/m)
    .filter(b => /^ASUS0[12] KWBC/.test(b))
    .map(b => ({ es02: /^ASUS02/.test(b), p: parseWpc(b) }))
    .filter(c => c.p.validoMs !== null && c.p.lineas.length)
    .map(c => ({ ...c, dh: (validoMs - c.p.validoMs) / HORA_MS }))
    .filter(c => c.dh >= PREVIO_MIN_H && c.dh <= PREVIO_MAX_H);
  if (!candidatos.length) return null;
  // El más cercano a 6 h antes; a igualdad, el boletín ASUS02 (posiciones con décimas de grado).
  candidatos.sort((a, b) => Math.abs(a.dh - PREVIO_IDEAL_H) - Math.abs(b.dh - PREVIO_IDEAL_H) || (b.es02 - a.es02));
  const c = candidatos[0];
  return { validoMs: c.p.validoMs, horas: c.dh, lineas: c.p.lineas };
}

// Muestrea la polilínea cada ~20 km; cada muestra lleva el vector tangente (km este, km norte).
function muestrearLinea(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [la0, lo0] = pts[i - 1], [la1, lo1] = pts[i];
    const n = Math.max(1, Math.ceil(haversine(la0, lo0, la1, lo1) / 20));
    const kx = 111.32 * Math.cos(((la0 + la1) / 2) * rad), ky = 110.57;
    const tx = (lo1 - lo0) * kx, ty = (la1 - la0) * ky, len = Math.hypot(tx, ty) || 1;
    for (let k = 0; k < n; k++) out.push({ lat: la0 + ((la1 - la0) * k) / n, lon: lo0 + ((lo1 - lo0) * k) / n, tx: tx / len, ty: ty / len });
    if (i === pts.length - 1) out.push({ lat: la1, lon: lo1, tx: tx / len, ty: ty / len });
  }
  return out;
}

// Desplazamiento (km este, km norte) del punto más cercano de las líneas dadas respecto del punto (lat, lon).
function masCercanoEn(lat, lon, lineas) {
  let mejor = null;
  const kx = 111.32 * Math.cos(lat * rad), ky = 110.57;
  for (const l of lineas) {
    for (let i = 1; i < l.puntos.length; i++) {
      const ax = (l.puntos[i - 1][1] - lon) * kx, ay = (l.puntos[i - 1][0] - lat) * ky;
      const bx = (l.puntos[i][1] - lon) * kx, by = (l.puntos[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx, qy);
      if (!mejor || d < mejor.d) mejor = { d, qx, qy };
    }
  }
  return mejor;
}

const rumboDe = (ex, ny) => ((Math.atan2(ex, ny) / rad) + 360) % 360;
const enZonaAvance = m => m.lat >= VISTA.latMin - AVANCE_MARGEN_GRADOS && m.lat <= VISTA.latMax + AVANCE_MARGEN_GRADOS && m.lon >= VISTA.lonMin - AVANCE_MARGEN_GRADOS && m.lon <= VISTA.lonMax + AVANCE_MARGEN_GRADOS;
const enVista = m => m.lat >= VISTA.latMin && m.lat <= VISTA.latMax && m.lon >= VISTA.lonMin && m.lon <= VISTA.lonMax;

// Dirección y rapidez de avance de un frente frío. El aire frío queda a la derecha del sentido en que se listan
// los puntos, así que el frente avanza hacia su izquierda (la normal). Con el análisis anterior se mide cuánto se
// desplazó la línea en esa dirección; sin él, la dirección es la normal y no hay rapidez.
function calcularAvance(puntos, previo) {
  const muestras = muestrearLinea(puntos).filter(enZonaAvance);
  if (!muestras.length) return null;
  const normal = m => ({ nx: -m.ty, ny: m.tx });
  const lineasPrev = previo ? previo.lineas.filter(l => l.tipo === 'COLD') : [];

  let base = 'inferida', desplazKm = null, velKmh = null, estado = 'avanza';
  let sx = 0, sy = 0;
  muestras.forEach(m => { const n = normal(m); sx += n.nx; sy += n.ny; });
  let rumbo = rumboDe(sx, sy);

  if (previo && lineasPrev.length) {
    const avances = [];
    muestras.forEach(m => {
      const q = masCercanoEn(m.lat, m.lon, lineasPrev);
      if (!q || q.d > 500) return;
      const n = normal(m);
      avances.push(-(q.qx * n.nx + q.qy * n.ny)); // km que la línea se movió hacia su lado cálido
    });
    if (avances.length >= 3) {
      base = 'comparacion';
      desplazKm = mediana(avances);
      velKmh = desplazKm / previo.horas;
      if (Math.abs(velKmh) < AVANCE_LENTO_KMH) estado = 'casi_estacionario';
      else if (velKmh < 0) { estado = 'retrocede'; rumbo = (rumbo + 180) % 360; }
    }
  }

  // El ancla de la flecha: la parte media del tramo visible en el mapa.
  const visibles = muestras.filter(enVista);
  const ancla = visibles.length ? visibles[Math.floor(visibles.length / 2)] : null;
  return {
    base, estado,
    rumbo: Math.round(rumbo),
    rumboTxt: compass(rumbo),
    velKmh: velKmh === null ? null : Math.round(Math.abs(velKmh)),
    desplazKm: desplazKm === null ? null : Math.round(Math.abs(desplazKm)),
    previoValido: previo && base === 'comparacion' ? new Date(previo.validoMs).toISOString() : null,
    previoHoras: previo && base === 'comparacion' ? Math.round(previo.horas) : null,
    lat: ancla ? Math.round(ancla.lat * 100) / 100 : null,
    lon: ancla ? Math.round(ancla.lon * 100) / 100 : null
  };
}

// Simulación: el análisis "anterior" es el mismo boletín con todo el frente 0.6° más al oeste (≈ 10 km/h en 6 h).
function previoSimulado(parsed) {
  return { validoMs: (parsed.validoMs ?? Date.now()) - PREVIO_IDEAL_H * HORA_MS, horas: PREVIO_IDEAL_H, lineas: parsed.lineas.map(l => ({ tipo: l.tipo, puntos: l.puntos.map(([la, lo]) => [la, lo - 0.6]) })) };
}

export async function loadWpcFrentes({ simular = false } = {}) {
  let fuente, parsed, previo = null;
  if (simular) {
    fuente = 'simulación';
    parsed = parseWpc(boletinSimulado());
    previo = previoSimulado(parsed);
  } else {
    const [r, archivo] = await Promise.all([
      cached('wpc', loadWpcText),
      cached('wpc-archivo', () => fetchRetry(WPC_ARCHIVO_URL, { headers: NOAA_HEADERS, timeoutMs: 5000, retries: 1 })).catch(() => null)
    ]);
    fuente = r.url;
    parsed = r.parsed;
    try { previo = elegirPrevio(archivo, parsed.validoMs); } catch { previo = null; }
  }
  const analizadas = parsed.lineas.map(l => ({ ...l, cerca: distLineaCajaKm(l.puntos) }));
  const elementos = analizadas
    .filter(l => l.cerca.d <= ELEMENTOS_KM)
    .sort((a, b) => a.cerca.d - b.cerca.d)
    .map(l => ({ tipo: l.tipo, tipoEs: TIPOS_WPC[l.tipo], puntos: l.puntos, distCajaKm: Math.round(l.cerca.d), avance: l.tipo === 'COLD' ? calcularAvance(l.puntos, previo) : null }));
  // La clasificación de municipios (encima / se acerca / ya pasó) usa solo frentes fríos a 300 km o menos.
  const frentes = elementos.filter(l => l.tipo === 'COLD' && l.distCajaKm <= MARGEN_KM).map(({ puntos, distCajaKm, avance }) => ({ puntos, distCajaKm, avance }));
  // Para comparar con el SMN cuentan los frentes de cualquier tipo (no las vaguadas).
  const hayFrente300 = analizadas.some(l => l.tipo !== 'TROF' && l.cerca.d <= MARGEN_KM);
  const masCercano = analizadas.length ? analizadas.reduce((a, b) => (b.cerca.d < a.cerca.d ? b : a)) : null;
  return {
    fuente,
    valido: parsed.validoMs !== null ? new Date(parsed.validoMs).toISOString() : null,
    emitido: parsed.emitidoMs !== null ? new Date(parsed.emitidoMs).toISOString() : null,
    previo: previo ? { valido: new Date(previo.validoMs).toISOString(), horas: Math.round(previo.horas) } : null,
    totalElementos: analizadas.length,
    elementos,
    frentes,
    hayFrente300,
    masCercano: masCercano ? { tipo: masCercano.tipo, tipoEs: TIPOS_WPC[masCercano.tipo], distKm: Math.round(masCercano.cerca.d), lat: masCercano.cerca.lat, lon: masCercano.cerca.lon } : null
  };
}

// Clasifica un municipio (desde las coordenadas de su cabecera) contra cada frente frío y se queda con el resultado más cercano.
// Si la proyección de la cabecera sobre la línea cae más allá del primer o del último punto, no se decide "ya pasó" ni "se acerca"
// por el lado de la línea: se usa la distancia al extremo más cercano. A más de 300 km es sin influencia; a 300 km o menos
// es "se acerca" solo si el frente avanza hacia el municipio (según la dirección de avance calculada).
function clasificarContraFrentes(lat, lon, frentes) {
  const kx = 111.32 * Math.cos(lat * rad), ky = 110.57;
  const resultados = [];
  for (const f of frentes) {
    const n = f.puntos.length;
    let mejor = null;
    for (let i = 1; i < n; i++) {
      const ax = (f.puntos[i - 1][1] - lon) * kx, ay = (f.puntos[i - 1][0] - lat) * ky;
      const bx = (f.puntos[i][1] - lon) * kx, by = (f.puntos[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const tRaw = len2 ? -(ax * dx + ay * dy) / len2 : 0;
      const t = Math.max(0, Math.min(1, tRaw));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (!mejor || d < mejor.d) {
        // En el boletín WPC el aire frío queda a la derecha del sentido en que se listan los puntos.
        mejor = { d, cross: dx * -ay - dy * -ax, fuera: (i === 1 && tRaw < 0) || (i === n - 1 && tRaw > 1), ex: ax + t * dx, ey: ay + t * dy };
      }
    }
    if (mejor) resultados.push({ ...mejor, avance: f.avance });
  }
  if (!resultados.length) return null;

  // Prioridad: un frente a menos de 50 km manda; luego los frentes cuya línea sí cubre al municipio; al final, los que no.
  const cerca = resultados.filter(r => r.d < ENCIMA_KM);
  const dentro = resultados.filter(r => !r.fuera);
  const pool = cerca.length ? cerca : dentro.length ? dentro : resultados;
  const r = pool.reduce((x, y) => (y.d < x.d ? y : x));
  const distKm = Math.round(r.d);
  if (r.d < ENCIMA_KM) return { estado: 'encima', distKm };
  if (r.fuera) {
    if (r.d > MARGEN_KM) return { estado: 'sin_influencia', distKm, fuera: true };
    const av = r.avance;
    // (ex, ey): del municipio al extremo; el vector del extremo al municipio es su opuesto.
    const rum = av ? av.rumbo * rad : null;
    const haciaMuni = av && av.estado !== 'casi_estacionario' ? (-r.ex) * Math.sin(rum) + (-r.ey) * Math.cos(rum) > 0 : false;
    return { estado: haciaMuni ? 'se_acerca' : 'sin_influencia', distKm, fuera: true };
  }
  if (r.cross < 0) return { estado: 'ya_paso', distKm };
  if (r.d <= MARGEN_KM) return { estado: 'se_acerca', distKm };
  return { estado: 'sin_influencia', distKm };
}

// ---------- Señales de Open-Meteo (próximas 72 h) ----------

const enArcoNorte = d => Number.isFinite(d) && (d >= 292.5 || d < 67.5); // N, NO y NE

// Las series horarias salen de la consulta única a Open-Meteo (ver _openmeteo.js): empiezan ayer a las 00:00.
const HORIZONTE_H = 72;

async function loadSenales() {
  const om = await loadOpenMeteo();
  return { series: om.list.map(l => l.hourly || {}), datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo };
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
  const fin = Math.min(n, i0 + HORIZONTE_H);
  for (let t = i0; t < fin; t++) {
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
    for (let t = i0; t < fin; t++) {
      const a = activas(t);
      if (a.length >= 2 && (!mejor || a.length > mejor.a.length)) mejor = { t, a };
    }
    if (mejor) aire = armar(mejor.t, mejor.a);
  }
  return { pasos, aire };
}

const HORA_MS = 3600000;
const SEPARACION_EVENTOS_H = 18;
const MIN_MUNICIPIOS_EVENTO = 5;
const ORDEN_TOLERANCIA_H = 12;

const mediana = arr => { const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Agrupa los pasos estimados de todos los municipios por cercanía en el tiempo: se ordenan por hora y se abre
// un evento nuevo cuando hay más de 18 h entre un paso y el siguiente. Un evento con menos de 5 municipios
// se marca como señal aislada de baja confianza.
function agruparEventos(candidatos) {
  const filas = [];
  candidatos.forEach(c => c.pasos.forEach(p => filas.push({ c, p, ms: localStringToMs(p.estimado) })));
  if (!filas.length) return [];
  filas.sort((a, b) => a.ms - b.ms);

  const grupos = [[filas[0]]];
  for (let i = 1; i < filas.length; i++) {
    if ((filas[i].ms - filas[i - 1].ms) / HORA_MS > SEPARACION_EVENTOS_H) grupos.push([]);
    grupos[grupos.length - 1].push(filas[i]);
  }

  return grupos.map((g, k) => {
    // Un municipio aparece una vez por evento, con su paso más temprano.
    const porMunicipio = new Map();
    g.forEach(f => { const actual = porMunicipio.get(f.c); if (!actual || f.ms < actual.ms) porMunicipio.set(f.c, f); });
    const miembros = Array.from(porMunicipio.values()).sort((a, b) => a.ms - b.ms);
    const norte = miembros.filter(f => f.c.lat >= 30).map(f => f.ms);
    const sur = miembros.filter(f => f.c.lat <= 28).map(f => f.ms);
    const ordenMal = norte.length >= 2 && sur.length >= 2 && mediana(sur) < mediana(norte) - ORDEN_TOLERANCIA_H * HORA_MS;
    const aislado = miembros.length < MIN_MUNICIPIOS_EVENTO;
    return {
      numero: k + 1,
      desde: miembros[0].p.estimado,
      hasta: miembros[miembros.length - 1].p.estimado,
      nota: ordenMal ? 'orden inconsistente, revisar' : null,
      aislado,
      etiqueta: aislado ? 'señal aislada (baja confianza)' : null,
      municipios: miembros.map(f => ({ municipio: f.c.municipio, estimado: f.p.estimado, nSenales: f.p.nSenales, senales: f.p.senales }))
    };
  });
}

// ---------- Estado combinado ----------

export async function loadFrenteEstado({ simular = false, plazoSenalesMs = PLAZO_OPEN_METEO_MS } = {}) {
  const ahoraMs = Date.now();
  const ahoraStr = localHourString(ahoraMs);
  const hoy = localDateString(ahoraMs);
  const manana = localDateString(ahoraMs + 24 * 3600 * 1000);
  const pasadoManana = localDateString(ahoraMs + 48 * 3600 * 1000);

  const [smnR, wpcR, senR] = await Promise.allSettled([
    withDeadline(loadSmnFrente(), DEADLINE_MS),
    withDeadline(loadWpcFrentes({ simular }), DEADLINE_MS),
    withDeadline(loadSenales(), plazoSenalesMs)
  ]);

  const wpc = wpcR.status === 'fulfilled' ? wpcR.value : null;
  const senData = senR.status === 'fulfilled' ? senR.value : null;
  const senales = senData ? senData.series : null;

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
    else if (!senales || !wpc) categoria = 'sin_datos'; // falta una fuente: no se puede afirmar que no hay influencia
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
    sinSenal: nombres('sin_senal'),
    sinDatos: nombres('sin_datos')
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
    senales: senData ? { ok: true, datosDe: senData.datosDe, desdeCache: senData.desdeCache, motivo: senData.motivo } : { ok: false, error: error(senR) },
    municipios,
    eventos,
    grupos,
    notas,
    hayError: smnR.status === 'rejected' || wpcR.status === 'rejected' || senR.status === 'rejected' || (smnR.status === 'fulfilled' && smnR.value.parcial) || Boolean(senData && senData.desdeCache)
  };
}

export { localStringToMs, compass, fold, haversine };
