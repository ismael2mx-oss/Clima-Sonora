import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteo } from './_openmeteo.js';

// Datos diarios (con 1 día extra hacia atrás, past_days=1) para poder comparar el primer día
// del pronóstico contra el día anterior real, igual que el resto de la serie.
// Sale de la misma consulta única a Open-Meteo que usan las señales del frente frío.
export async function loadSonoraFrio() {
  const om = await loadOpenMeteo();
  const list = om.list;

  const allDias = list[0]?.daily?.time || [];
  // allDias[0] es "ayer" (solo referencia para comparar); los 5 días a mostrar empiezan en el índice 1.
  const municipios = MUNICIPIOS.map((m, i) => {
    const d = list[i]?.daily || {};
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      tmax: d.temperature_2m_max || [],
      tmin: d.temperature_2m_min || [],
      feels: d.apparent_temperature_min || [],
      gust: d.wind_gusts_10m_max || [],
      windDir: d.wind_direction_10m_dominant || [],
      snow: d.snowfall_sum || [],
      rainProb: d.precipitation_probability_max || []
    };
  });

  return { allDias, dias: allDias.slice(1), municipios, datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo };
}
