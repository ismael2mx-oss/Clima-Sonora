import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteo } from './_openmeteo.js';

// ÚNICA fuente de la lluvia diaria de los 72 municipios: probabilidad máxima del día y acumulado (mm) de Open-Meteo,
// con el día completo (00-24 h, hora de Sonora). La usan /api/sonora-lluvia, /api/municipios-temp (página de lluvia),
// /api/resumen-ciclones y /api/resumen-pronostico, para que todas muestren las mismas cifras.
export async function loadLluviaDiaria() {
  const om = await loadOpenMeteo();
  const todos = om.list[0]?.daily?.time || [];
  // todos[0] es ayer (se pide para comparar tendencias); los 5 días de lluvia empiezan en el índice 1 (hoy).
  const dias = todos.slice(1);
  const municipios = MUNICIPIOS.map((m, i) => {
    const d = om.list[i]?.daily || {};
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      prob: (d.precipitation_probability_max || []).slice(1),
      mm: (d.precipitation_sum || []).slice(1)
    };
  });
  return { dias, municipios, datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo };
}
