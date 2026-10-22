import { MUNICIPIOS } from './_municipios.js';

// Consultas a Open-Meteo para los 72 municipios, cada una en una sola llamada con varias coordenadas:
//  - loadOpenMeteo: datos diarios (frío, viento, nieve, lluvia) y horarios (señales del frente frío). Es la fuente
//    única de lluvia diaria (día completo, 00-24 h hora de Sonora) de todos los endpoints y páginas.
//  - loadOpenMeteoPronostico: horarios de ayer, hoy y mañana para el resumen del pronóstico.
//  - loadOpenMeteoModelos: máximos diarios de ICON, GFS y ECMWF para comparar modelos.
// Todas comparten la misma política: reintentos a los 5 y 15 s, respaldo de la última respuesta buena (hasta 6 h) y
// nunca guardar un error.

const TZ = 'America/Hermosillo';
const BASE = 'https://api.open-meteo.com/v1/forecast';

const VIGENCIA_MS = 15 * 60 * 1000;          // un resultado bueno se reutiliza 15 minutos
const RESPALDO_MAX_MS = 6 * 3600 * 1000;     // la última respuesta buena sirve de respaldo hasta 6 h
const ESPERAS_MS = [5000, 15000];            // reintentos tras un error: 5 s y 15 s
const TIMEOUT_INTENTO_MS = 15000;
export const PLAZO_OPEN_METEO_MS = 55000;    // tope total (el límite de la función es de 60 s)
const ENFRIAMIENTO_MS = 60000;               // tras agotar los reintentos, 60 s sin volver a insistir si hay respaldo

const esperar = ms => new Promise(r => setTimeout(r, ms));
const coords = () => `latitude=${MUNICIPIOS.map(m => m.lat).join(',')}&longitude=${MUNICIPIOS.map(m => m.lon).join(',')}`;
const motivoDe = err => (err && err.status === 429 ? 'por límite de peticiones' : `por un error de Open-Meteo (${err && err.message ? err.message : 'error desconocido'})`);

const HORARIAS = ['temperature_2m', 'dew_point_2m', 'pressure_msl', 'wind_direction_10m'];
const DIARIAS = [
  'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_min',
  'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'snowfall_sum',
  'precipitation_probability_max', 'precipitation_sum'
];
const HORARIAS_PRONOSTICO = [
  'temperature_2m', 'relative_humidity_2m', 'cloud_cover', 'precipitation', 'precipitation_probability',
  'weather_code', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m'
];
export const MODELOS = [
  { id: 'icon_seamless', nombre: 'ICON', meta: 'dwd_icon' },
  { id: 'gfs_seamless', nombre: 'GFS', meta: 'ncep_gfs025' },
  { id: 'ecmwf_ifs025', nombre: 'ECMWF', meta: 'ecmwf_ifs025' }
];
const DIARIAS_MODELOS = ['temperature_2m_max', 'wind_gusts_10m_max', 'precipitation_sum', 'precipitation_probability_max'];
// Por hora y por modelo: lluvia, código de tiempo (95-99 = tormenta eléctrica) y CAPE (energía para tormentas, J/kg).
const HORARIAS_MODELOS = ['precipitation', 'weather_code', 'cape'];

const tieneArreglos = (l, campo) => Array.isArray(l?.[campo]?.time);

async function pedirUnaVez(url, timeoutMs, validar) {
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
    if (list.length !== MUNICIPIOS.length || !list.every(validar)) throw new Error('respuesta incompleta de Open-Meteo');
    return list;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Hasta 3 intentos (el primero y 2 reintentos tras 5 s y 15 s), sin pasar del plazo total.
async function consultar(url, validar) {
  const inicio = Date.now();
  let ultimo;
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    const restante = PLAZO_OPEN_METEO_MS - (Date.now() - inicio);
    if (restante < 2000) break;
    try {
      return await pedirUnaVez(url, Math.min(TIMEOUT_INTENTO_MS, restante), validar);
    } catch (err) {
      ultimo = err;
      if (i < ESPERAS_MS.length) await esperar(Math.min(ESPERAS_MS[i], Math.max(0, PLAZO_OPEN_METEO_MS - (Date.now() - inicio) - 2000)));
    }
  }
  throw ultimo || new Error('tiempo de espera agotado');
}

const cargadores = [];

/**
 * Crea un cargador con su propia caché. Devuelve { list, datosDe, desdeCache, motivo }. `list` trae, por municipio,
 * lo que devuelva Open-Meteo. Si falla y hay una respuesta buena de menos de 6 h, se devuelve esa con
 * desdeCache = true; si no hay respaldo, lanza el error.
 */
function crearCargador(construirUrl, validar) {
  const estado = { ultimoBueno: null, ultimoFallo: 0, ultimoMotivo: null, enCurso: null };
  cargadores.push(estado);
  const resultado = (b, desdeCache, motivo) => ({ list: b.list, datosDe: new Date(b.at).toISOString(), desdeCache, motivo });
  return async function cargar() {
    const ahora = Date.now();
    const bueno = estado.ultimoBueno;
    if (bueno && ahora - bueno.at < VIGENCIA_MS) return resultado(bueno, false, null);
    const respaldo = bueno && ahora - bueno.at < RESPALDO_MAX_MS ? bueno : null;
    if (respaldo && ahora - estado.ultimoFallo < ENFRIAMIENTO_MS) return resultado(respaldo, true, estado.ultimoMotivo);
    if (!estado.enCurso) {
      estado.enCurso = consultar(construirUrl(), validar)
        .then(list => { estado.ultimoBueno = { at: Date.now(), list }; return estado.ultimoBueno; })
        .finally(() => { estado.enCurso = null; });
    }
    try {
      return resultado(await estado.enCurso, false, null);
    } catch (err) {
      estado.ultimoFallo = Date.now();
      estado.ultimoMotivo = motivoDe(err);
      if (respaldo) return resultado(respaldo, true, estado.ultimoMotivo);
      throw err;
    }
  };
}

export const loadOpenMeteo = crearCargador(
  () => `${BASE}?${coords()}&hourly=${HORARIAS.join(',')}&daily=${DIARIAS.join(',')}&timezone=${TZ}&past_days=1&forecast_days=5`,
  l => tieneArreglos(l, 'hourly') && tieneArreglos(l, 'daily')
);

// Ayer, hoy y mañana (72 h, hora de Sonora): de aquí salen temperaturas, lluvia horaria, viento, humedad y nubes.
export const loadOpenMeteoPronostico = crearCargador(
  () => `${BASE}?${coords()}&hourly=${HORARIAS_PRONOSTICO.join(',')}&timezone=${TZ}&past_days=1&forecast_days=2`,
  l => tieneArreglos(l, 'hourly')
);

// Un solo pedido con los tres modelos: cada variable llega con el sufijo del modelo (temperature_2m_max_icon_seamless).
// Hoy es el índice 0 de lo diario y las horas 0-23 de lo horario (día completo, hora de Sonora).
export const loadOpenMeteoModelos = crearCargador(
  () => `${BASE}?${coords()}&models=${MODELOS.map(m => m.id).join(',')}&daily=${DIARIAS_MODELOS.join(',')}&hourly=${HORARIAS_MODELOS.join(',')}&timezone=${TZ}&forecast_days=2`,
  l => tieneArreglos(l, 'daily') && tieneArreglos(l, 'hourly')
);

// Corrida más reciente de cada modelo (hora de inicialización, UTC). Si no se puede leer, devuelve null para ese modelo.
export async function loadCorridasModelos() {
  return Promise.all(MODELOS.map(async m => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`https://api.open-meteo.com/data/${m.meta}/static/meta.json`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (!Number.isFinite(j.last_run_initialisation_time)) throw new Error('sin hora de corrida');
      return { ...m, corrida: new Date(j.last_run_initialisation_time * 1000).toISOString(), disponible: Number.isFinite(j.last_run_availability_time) ? new Date(j.last_run_availability_time * 1000).toISOString() : null, error: null };
    } catch (err) {
      return { ...m, corrida: null, disponible: null, error: err.name === 'AbortError' ? 'tiempo de espera agotado' : err.message };
    }
  }));
}

// Para las pruebas locales.
export function _reiniciarOpenMeteo() { cargadores.forEach(e => { e.ultimoBueno = null; e.ultimoFallo = 0; e.ultimoMotivo = null; e.enCurso = null; }); }
