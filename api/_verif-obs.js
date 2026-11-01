import { MUNICIPIOS } from './_municipios.js';

// Observaciones reales para verificar los pronósticos. Fuente: METAR de aeropuertos, vía el archivo de IEM (Iowa State),
// que entrega las observaciones con la hora ya en Sonora. Día = 00:00 a 24:00 hora de Sonora (UTC-7, sin horario de verano).

export const MIN_HORAS_COBERTURA = 18; // un día con menos de 18 de 24 horas reportadas se marca "baja cobertura" y no cuenta

// calidad: directa (aeropuerto en Sonora, a menos de 15 km) | aproximacion (Arizona, a menos de 20 km) | aproximacion_lejana (a 26 km)
export const ESTACIONES = [
  { id: 'MMHO', red: 'MX__ASOS', iem: 'MMHO', municipio: 'Hermosillo', calidad: 'directa', nombre: 'Hermosillo/García Intl', km: 9 },
  { id: 'MMGM', red: 'MX__ASOS', iem: 'MMGM', municipio: 'Guaymas', calidad: 'directa', nombre: 'Guaymas/Yáñez Intl', km: 6 },
  { id: 'MMPE', red: 'MX__ASOS', iem: 'MMPE', municipio: 'Puerto Peñasco', calidad: 'directa', nombre: 'Puerto Peñasco Intl', km: 6 },
  { id: 'MMCN', red: 'MX__ASOS', iem: 'MMCN', municipio: 'Cajeme', calidad: 'directa', nombre: 'Ciudad Obregón Intl', km: 15 },
  { id: 'KOLS', red: 'AZ_ASOS', iem: 'OLS', municipio: 'Nogales', calidad: 'aproximacion', nombre: 'Nogales Intl (Arizona)', km: 14 },
  { id: 'KDUG', red: 'AZ_ASOS', iem: 'DUG', municipio: 'Agua Prieta', calidad: 'aproximacion', nombre: 'Douglas/Bisbee Intl (Arizona)', km: 17 },
  { id: 'KNYL', red: 'AZ_ASOS', iem: 'NYL', municipio: 'San Luis Río Colorado', calidad: 'aproximacion_lejana', nombre: 'Yuma MCAS (Arizona)', km: 26 }
];

export const CALIDAD_TXT = {
  directa: 'estación en Sonora',
  aproximacion: 'aproximación (estación en Arizona)',
  aproximacion_lejana: 'aproximación lejana (estación en Arizona, ~26 km)'
};

const IEM_ASOS = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
const IEM_DAILY = 'https://mesonet.agron.iastate.edu/cgi-bin/request/daily.py';
const KT_A_KMH = 1.852;
const F_A_C = f => (f - 32) / 1.8;

async function pedirTexto(url, intentos = 3, timeoutMs = 25000) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'clima-sonora (https://clima-sonora-6fne.vercel.app)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      ultimo = err.name === 'AbortError' ? new Error('tiempo de espera agotado') : err;
      if (i < intentos - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    } finally { clearTimeout(t); }
  }
  throw ultimo;
}

const sumaDias = (fecha, n) => new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const partes = f => ({ y: f.slice(0, 4), m: String(Number(f.slice(5, 7))), d: String(Number(f.slice(8, 10))) });
export { sumaDias };

// ---------- observaciones horarias (METAR) ----------
export function parsearAsos(csv) {
  const out = [];
  const lineas = csv.split(/\r?\n/);
  for (let i = 1; i < lineas.length; i++) {
    const l = lineas[i];
    if (!l) continue;
    const c = l.split(',');
    if (c.length < 6) continue;
    const num = s => (s === undefined || s === '' || s === 'null' || s === 'M' ? null : Number(s));
    out.push({ valid: c[1], tmpf: num(c[2]), p01i: num(c[3]), gust: num(c[4]), wx: c[5] === 'null' ? '' : c[5] });
  }
  return out;
}

// ¿El código de tiempo presente indica lluvia en la estación? (RA, SH, TS, GR; no cuenta VC = "en las cercanías")
export function hayLluvia(wx) {
  return String(wx || '').split(/\s+/).filter(Boolean).some(t => !t.includes('VC') && /(RA|SH|TS|GR|GS)/.test(t));
}

/** Agrupa las observaciones por día local y calcula máxima, mínima, racha, evento de lluvia y cobertura horaria. */
export function resumirPorDia(obs, desde, hasta) {
  const dias = new Map();
  for (const o of obs) {
    const dia = o.valid.slice(0, 10);
    if (dia < desde || dia > hasta) continue;
    if (!dias.has(dia)) dias.set(dia, []);
    dias.get(dia).push(o);
  }
  const out = new Map();
  for (const [dia, lista] of dias) {
    const temps = lista.map(o => o.tmpf).filter(Number.isFinite).map(F_A_C);
    const gustKt = lista.map(o => o.gust).filter(Number.isFinite);
    const horas = new Set(lista.map(o => o.valid.slice(0, 13)));
    const p01 = lista.map(o => o.p01i).filter(Number.isFinite);
    out.set(dia, {
      tmax: temps.length ? Math.max(...temps) : null,
      tmin: temps.length ? Math.min(...temps) : null,
      racha_kmh: gustKt.length ? Math.max(...gustKt) * KT_A_KMH : null,
      lluvia_evento: lista.some(o => hayLluvia(o.wx)) || p01.some(v => v > 0) ? 1 : 0,
      lluvia_p01_mm: p01.length ? p01.reduce((a, b) => a + b, 0) * 25.4 : null,
      horas_reportadas: horas.size,
      n_reportes: lista.length
    });
  }
  return out;
}

// ---------- resumen diario de IEM (precipitación y racha de Arizona) ----------
export function parsearDaily(csv) {
  const lineas = csv.split(/\r?\n/).filter(Boolean);
  if (lineas.length < 2) return new Map();
  const cab = lineas[0].split(',');
  const ix = n => cab.indexOf(n);
  const iDia = ix('day'), iPrec = ix('precip_in'), iRacha = ix('max_wind_gust_kts');
  const out = new Map();
  for (let i = 1; i < lineas.length; i++) {
    const c = lineas[i].split(',');
    const num = s => (s === undefined || s === 'None' || s === '' ? null : Number(s));
    const p = num(c[iPrec]), g = num(c[iRacha]);
    out.set(c[iDia], { lluvia_mm: p === null ? null : p * 25.4, racha_kmh: g === null ? null : g * KT_A_KMH });
  }
  return out;
}

/**
 * Observaciones diarias de una estación entre dos fechas locales (inclusive).
 * Devuelve un arreglo de { fecha, estacion, municipio, calidad, tmax, tmin, lluvia_mm, lluvia_evento, racha_kmh,
 * horas_reportadas, cobertura_ok, n_reportes, fuente }. Los días sin ningún reporte no aparecen.
 */
export async function observacionesEstacion(est, desde, hasta) {
  const a = partes(desde), b = partes(sumaDias(hasta, 1));
  const url = `${IEM_ASOS}?station=${est.iem}&data=tmpf&data=p01i&data=gust&data=wxcodes&tz=America%2FHermosillo&format=onlycomma&latlon=no&elev=no&missing=null&trace=0.0001&direct=no&report_type=3&report_type=4&year1=${a.y}&month1=${a.m}&day1=${a.d}&year2=${b.y}&month2=${b.m}&day2=${b.d}`;
  const obs = parsearAsos(await pedirTexto(url));
  const dias = resumirPorDia(obs, desde, hasta);

  let diario = new Map();
  if (est.red === 'AZ_ASOS') {
    const p = partes(desde), q = partes(hasta);
    try {
      diario = parsearDaily(await pedirTexto(`${IEM_DAILY}?network=${est.red}&stations=${est.iem}&year1=${p.y}&month1=${p.m}&day1=${p.d}&year2=${q.y}&month2=${q.m}&day2=${q.d}&format=csv`));
    } catch (_) { /* si falla, se usa la suma horaria */ }
  }

  const filas = [];
  for (const [fecha, r] of dias) {
    const d = diario.get(fecha);
    const rachas = [r.racha_kmh, d && d.racha_kmh].filter(Number.isFinite);
    const lluviaMm = est.red === 'AZ_ASOS' ? (d && d.lluvia_mm !== null ? d.lluvia_mm : r.lluvia_p01_mm) : null;
    filas.push({
      fecha, estacion: est.id, municipio: est.municipio, calidad: est.calidad,
      tmax: r.tmax, tmin: r.tmin,
      // Los METAR mexicanos no traen milímetros: solo se sabe si llovió (evento). En Arizona sí hay milímetros.
      lluvia_mm: lluviaMm,
      lluvia_evento: est.red === 'AZ_ASOS' && Number.isFinite(lluviaMm) ? (lluviaMm >= 0.1 ? 1 : r.lluvia_evento) : r.lluvia_evento,
      racha_kmh: rachas.length ? Math.max(...rachas) : null,
      horas_reportadas: r.horas_reportadas, n_reportes: r.n_reportes,
      cobertura_ok: r.horas_reportadas >= MIN_HORAS_COBERTURA ? 1 : 0,
      fuente: 'METAR (IEM)'
    });
  }
  return filas.sort((x, y) => x.fecha.localeCompare(y.fecha));
}

// ---------- NASA POWER: lluvia estimada por satélite (llega con ~3 días de retraso, celdas de ~50 km) ----------
export async function lluviaPower(municipio, desde, hasta) {
  const m = MUNICIPIOS.find(x => x.municipio === municipio);
  if (!m) throw new Error(`municipio desconocido: ${municipio}`);
  const f = s => s.replace(/-/g, '');
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${m.lon}&latitude=${m.lat}&start=${f(desde)}&end=${f(hasta)}&format=JSON`;
  const j = JSON.parse(await pedirTexto(url, 2, 40000));
  const p = j && j.properties && j.properties.parameter && j.properties.parameter.PRECTOTCORR;
  const out = new Map();
  if (p) for (const [k, v] of Object.entries(p)) if (Number.isFinite(v) && v > -900) out.set(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`, v);
  return out;
}
