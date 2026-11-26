import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteoVerificacion } from './_openmeteo.js';

// Respaldo del mapa (mapa.html): si a algún municipio le falta la máxima de hoy, la mínima de mañana o la probabilidad de lluvia
// de hoy en la fuente principal, se usa el primer modelo que sí tenga dato: best match, ICON, GFS y ECMWF (en ese orden).
const ORDEN = [['best_match', 'best match'], ['icon_seamless', 'ICON'], ['gfs_seamless', 'GFS'], ['ecmwf_ifs025', 'ECMWF']];
const finito = v => v !== null && v !== undefined && Number.isFinite(Number(v));

function primero(daily, campo, k) {
  for (const [id, nombre] of ORDEN) {
    const v = (daily[`${campo}_${id}`] || [])[k];
    if (finito(v)) return { v: Number(v), fuente: nombre };
  }
  return null;
}

export async function vistaMapaRespaldo() {
  const om = await loadOpenMeteoVerificacion();
  const municipios = MUNICIPIOS.map((m, i) => {
    const d = om.list[i]?.daily || {};
    return { municipio: m.municipio, tmaxHoy: primero(d, 'temperature_2m_max', 0), tminManana: primero(d, 'temperature_2m_min', 1), probHoy: primero(d, 'precipitation_probability_max', 0) };
  });
  return { vista: 'mapa-respaldo', dias: om.list[0]?.daily?.time || [], datosDe: om.datosDe, desdeCache: om.desdeCache, municipios };
}

export const VISTAS_MAPA = { 'mapa-respaldo': vistaMapaRespaldo };
