import { gunzipSync } from 'node:zlib';
import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteoVerificacion, loadCorridasModelos, MODELOS } from './_openmeteo.js';
import { ESTACIONES, sumaDias } from './_verif-obs.js';

// Guardado de lo que pronosticamos (hoy y mañana) para los 72 municipios, separado por fuente:
// icon, gfs, ecmwf, best_match (Open-Meteo) y smn (pronóstico oficial por municipio del SMN).

export const FUENTES = ['icon', 'gfs', 'ecmwf', 'best_match', 'smn'];
export const FUENTE_NOMBRE = { icon: 'ICON', gfs: 'GFS', ecmwf: 'ECMWF', best_match: 'best match', smn: 'SMN oficial' };
const ID_MODELO = { icon_seamless: 'icon', gfs_seamless: 'gfs', ecmwf_ifs025: 'ecmwf', best_match: 'best_match' };
const SMN_URL = 'https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1';
const TZ = 'America/Hermosillo';

export const COLUMNAS_PRON = ['fecha_emision', 'fecha_objetivo', 'dias_adelante', 'municipio', 'fuente', 'origen', 'tmax', 'tmin', 'lluvia_mm', 'prob_lluvia', 'racha_kmh', 'corrida', 'guardado_en'];
export const LLAVE_PRON = ['fecha_emision', 'fecha_objetivo', 'municipio', 'fuente', 'origen'];

export function fechaSonora(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
const num = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const fila = (o, v) => [o.fecha_emision, o.fecha_objetivo, o.dias_adelante, o.municipio, o.fuente, o.origen, v.tmax, v.tmin, v.lluvia_mm, v.prob_lluvia, v.racha_kmh, o.corrida || null, o.guardado_en];

const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Open-Meteo: modelos ----------
export async function pronosticosModelos(ahoraMs = Date.now()) {
  const [om, corridas] = await Promise.all([loadOpenMeteoVerificacion(), loadCorridasModelos().catch(() => [])]);
  const hoy = fechaSonora(ahoraMs);
  const guardado = new Date(ahoraMs).toISOString();
  const corridaDe = id => { const c = corridas.find(x => x.id === id); return c && c.corrida ? c.corrida : (id === 'best_match' ? 'mezcla de modelos (best match)' : null); };
  const filas = [];
  MUNICIPIOS.forEach((m, i) => {
    const d = om.list[i] && om.list[i].daily;
    if (!d || !Array.isArray(d.time)) return;
    d.time.forEach((fecha, k) => {
      const dias = diasEntre(hoy, fecha);
      if (dias < 0 || dias > 1) return;
      for (const [id, fuente] of Object.entries(ID_MODELO)) {
        const g = campo => (d[`${campo}_${id}`] || [])[k];
        const v = { tmax: num(g('temperature_2m_max')), tmin: num(g('temperature_2m_min')), lluvia_mm: num(g('precipitation_sum')), prob_lluvia: num(g('precipitation_probability_max')), racha_kmh: num(g('wind_gusts_10m_max')) };
        if (Object.values(v).every(x => x === null)) continue;
        filas.push(fila({ fecha_emision: hoy, fecha_objetivo: fecha, dias_adelante: dias, municipio: m.municipio, fuente, origen: 'cron', corrida: corridaDe(id), guardado_en: guardado }, v));
      }
    });
  });
  return { filas, datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo };
}

// ---------- SMN: pronóstico oficial por municipio ----------
// Nombres del SMN que difieren de los de _municipios.js (comparados sin acentos ni mayúsculas).
const ALIAS_SMN = { 'general plutarco elias calles': 'General Plutarco Elías Calles', 'heroica nogales': 'Nogales' };

export async function pronosticoSmn(ahoraMs = Date.now()) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  let buf;
  try {
    const res = await fetch(SMN_URL, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; clima-sonora/1.0; +https://clima-sonora-6fne.vercel.app)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
  const mtime = buf.length > 8 ? buf.readUInt32LE(4) : 0; // el .gz trae la hora de generación del archivo
  const datos = JSON.parse(gunzipSync(buf).toString('utf8'));
  const hoy = fechaSonora(ahoraMs);
  const guardado = new Date(ahoraMs).toISOString();
  const porNombre = new Map(MUNICIPIOS.map(m => [fold(m.municipio), m.municipio]));
  const noEncontrados = new Set();
  const filas = [];
  for (const r of datos) {
    if (!/sonora/i.test(r.nes || '')) continue;
    const clave = fold(r.nmun);
    const nombre = porNombre.get(clave) || (ALIAS_SMN[clave] && porNombre.get(fold(ALIAS_SMN[clave])));
    if (!nombre) { noEncontrados.add(r.nmun); continue; }
    const fecha = `${String(r.dloc).slice(0, 4)}-${String(r.dloc).slice(4, 6)}-${String(r.dloc).slice(6, 8)}`;
    const dias = diasEntre(hoy, fecha);
    if (dias < 0 || dias > 1) continue;
    const n = k => (r[k] === undefined || r[k] === '' ? null : num(Number(r[k])));
    filas.push(fila({ fecha_emision: hoy, fecha_objetivo: fecha, dias_adelante: dias, municipio: nombre, fuente: 'smn', origen: 'cron', corrida: mtime ? new Date(mtime * 1000).toISOString() : null, guardado_en: guardado },
      { tmax: n('tmax'), tmin: n('tmin'), lluvia_mm: n('prec'), prob_lluvia: n('probprec'), racha_kmh: n('raf') }));
  }
  return { filas, noEncontrados: [...noEncontrados], generado: mtime ? new Date(mtime * 1000).toISOString() : null };
}

// ---------- Open-Meteo: pronósticos históricos de corto plazo (solo municipios con estación) ----------
// La API de pronósticos históricos arma cada día con las primeras horas de cada corrida: no equivale a lo que pronosticamos a las
// 05:30 h, así que se guarda aparte (origen = 'historico_corto_plazo', 0 días de adelanto) y nunca se mezcla con lo demás.
export async function pronosticosHistoricos(desde, hasta) {
  const guardado = new Date().toISOString();
  const filas = [];
  const ests = ESTACIONES.map(e => MUNICIPIOS.find(m => m.municipio === e.municipio)).filter(Boolean);
  const lat = ests.map(m => m.lat).join(','), lon = ests.map(m => m.lon).join(',');
  const base = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${desde}&end_date=${hasta}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max&timezone=${TZ}`;
  const variantes = [
    { url: `${base}&models=${MODELOS.map(m => m.id).join(',')}`, ids: MODELOS.map(m => m.id) },
    { url: base, ids: ['best_match'], sufijo: false }
  ];
  for (const v of variantes) {
    const res = await fetch(v.url);
    if (!res.ok) throw new Error(`Open-Meteo histórico: HTTP ${res.status}`);
    const j = await res.json();
    const lista = Array.isArray(j) ? j : [j];
    lista.forEach((loc, i) => {
      const d = loc.daily;
      if (!d || !d.time) return;
      d.time.forEach((fecha, k) => {
        for (const id of v.ids) {
          const g = campo => (d[v.sufijo === false ? campo : `${campo}_${id}`] || [])[k];
          const val = { tmax: num(g('temperature_2m_max')), tmin: num(g('temperature_2m_min')), lluvia_mm: num(g('precipitation_sum')), prob_lluvia: null, racha_kmh: num(g('wind_gusts_10m_max')) };
          if (val.tmax === null && val.tmin === null) continue;
          filas.push(fila({ fecha_emision: fecha, fecha_objetivo: fecha, dias_adelante: 0, municipio: ests[i].municipio, fuente: ID_MODELO[id], origen: 'historico_corto_plazo', corrida: null, guardado_en: guardado }, val));
        }
      });
    });
  }
  return filas;
}

export { sumaDias };
