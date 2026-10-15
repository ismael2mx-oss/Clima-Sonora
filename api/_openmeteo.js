import { MUNICIPIOS } from './_municipios.js';

// Una sola llamada a Open-Meteo para los 72 municipios, con las variables diarias (frío, viento, nieve)
// y las horarias (señales del frente frío). La comparten /api/sonora-frio y /api/resumen-frio.

const TZ = 'America/Hermosillo';
const HORARIAS = ['temperature_2m', 'dew_point_2m', 'pressure_msl', 'wind_direction_10m'];
const DIARIAS = [
  'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_min',
  'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'snowfall_sum',
  'precipitation_probability_max'
];

const VIGENCIA_MS = 15 * 60 * 1000;          // un resultado bueno se reutiliza 15 minutos
const RESPALDO_MAX_MS = 6 * 3600 * 1000;     // la última respuesta buena sirve de respaldo hasta 6 h
const ESPERAS_MS = [5000, 15000];            // reintentos tras un error: 5 s y 15 s
const TIMEOUT_INTENTO_MS = 15000;
export const PLAZO_OPEN_METEO_MS = 55000;    // tope total (el límite de la función es de 60 s)
const ENFRIAMIENTO_MS = 60000;               // tras agotar los reintentos, 60 s sin volver a insistir si hay respaldo

// Solo se guardan respuestas buenas. Un error nunca se guarda: a lo sumo se reutiliza la última respuesta buena.
let ultimoBueno = null;   // { at, list }
let ultimoFallo = 0;
let ultimoMotivo = null;
let enCurso = null;

const esperar = ms => new Promise(r => setTimeout(r, ms));

function urlSonora() {
  const lats = MUNICIPIOS.map(m => m.lat).join(',');
  const lons = MUNICIPIOS.map(m => m.lon).join(',');
  return `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=${HORARIAS.join(',')}&daily=${DIARIAS.join(',')}&timezone=${TZ}&past_days=1&forecast_days=5`;
}

async function pedirUnaVez(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const err = new Error(res.status === 429 ? 'HTTP 429 (límite de peticiones)' : `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    if (data && data.error) throw new Error(data.reason || 'Open-Meteo devolvió un error');
    const completa = list.length === MUNICIPIOS.length && list.every(l => Array.isArray(l?.hourly?.time) && Array.isArray(l?.daily?.time));
    if (!completa) throw new Error('respuesta incompleta de Open-Meteo');
    return list;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Hasta 3 intentos (el primero y 2 reintentos tras 5 s y 15 s), sin pasar del plazo total.
async function consultar() {
  const url = urlSonora();
  const inicio = Date.now();
  let ultimo;
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    const restante = PLAZO_OPEN_METEO_MS - (Date.now() - inicio);
    if (restante < 2000) break;
    try {
      return await pedirUnaVez(url, Math.min(TIMEOUT_INTENTO_MS, restante));
    } catch (err) {
      ultimo = err;
      if (i < ESPERAS_MS.length) await esperar(Math.min(ESPERAS_MS[i], Math.max(0, PLAZO_OPEN_METEO_MS - (Date.now() - inicio) - 2000)));
    }
  }
  throw ultimo || new Error('tiempo de espera agotado');
}

const motivoDe = err => (err && err.status === 429 ? 'por límite de peticiones' : `por un error de Open-Meteo (${err && err.message ? err.message : 'error desconocido'})`);

/**
 * Devuelve { list, datosDe, desdeCache, motivo }. `list` trae, por municipio, `hourly` y `daily`.
 * Si Open-Meteo falla y hay una respuesta buena de menos de 6 h, se devuelve esa con desdeCache = true;
 * si no hay respaldo, lanza el error.
 */
export async function loadOpenMeteo() {
  const ahora = Date.now();
  if (ultimoBueno && ahora - ultimoBueno.at < VIGENCIA_MS) {
    return { list: ultimoBueno.list, datosDe: new Date(ultimoBueno.at).toISOString(), desdeCache: false, motivo: null };
  }
  const respaldo = ultimoBueno && ahora - ultimoBueno.at < RESPALDO_MAX_MS ? ultimoBueno : null;
  if (respaldo && ahora - ultimoFallo < ENFRIAMIENTO_MS) {
    return { list: respaldo.list, datosDe: new Date(respaldo.at).toISOString(), desdeCache: true, motivo: ultimoMotivo };
  }
  if (!enCurso) {
    enCurso = consultar().then(list => { ultimoBueno = { at: Date.now(), list }; return ultimoBueno; }).finally(() => { enCurso = null; });
  }
  try {
    const bueno = await enCurso;
    return { list: bueno.list, datosDe: new Date(bueno.at).toISOString(), desdeCache: false, motivo: null };
  } catch (err) {
    ultimoFallo = Date.now();
    ultimoMotivo = motivoDe(err);
    if (respaldo) return { list: respaldo.list, datosDe: new Date(respaldo.at).toISOString(), desdeCache: true, motivo: ultimoMotivo };
    throw err;
  }
}

// Para las pruebas locales.
export function _reiniciarOpenMeteo() { ultimoBueno = null; ultimoFallo = 0; ultimoMotivo = null; enCurso = null; }
