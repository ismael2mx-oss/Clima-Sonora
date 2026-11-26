import { MUNICIPIOS } from './_municipios.js';
import { loadOpenMeteo, loadOpenMeteoRespaldoMax, MODELOS } from './_openmeteo.js';

const finito = v => v !== null && v !== undefined && Number.isFinite(Number(v));

/**
 * Completa las máximas que best match no traiga con el primer modelo que sí las tenga (ICON, GFS, ECMWF, el mismo
 * orden que usa el mapa) y anota en m.tmaxRespaldo[fecha] de qué modelo salió. Así la página de frío, la lista de
 * máximas, el mapa y el panel muestran el mismo valor.
 */
export function rellenarMaximas(municipios, fechas, listaRespaldo) {
  municipios.forEach((m, i) => {
    const d = listaRespaldo[i]?.daily || {};
    fechas.forEach((fecha, k) => {
      if (finito(m.tmax[k])) return;
      const j = (d.time || []).indexOf(fecha);
      if (j < 0) return;
      for (const modelo of MODELOS) {
        const v = (d[`temperature_2m_max_${modelo.id}`] || [])[j];
        if (finito(v)) { m.tmax[k] = v; (m.tmaxRespaldo ||= {})[fecha] = modelo.nombre; break; }
      }
    });
  });
}

// Datos diarios (con 1 día extra hacia atrás, past_days=1) para poder comparar el primer día
// del pronóstico contra el día anterior real, igual que el resto de la serie.
// Sale de la misma consulta única a Open-Meteo que usan las señales del frente frío.
// Es la FUENTE ÚNICA de las temperaturas máximas (Open-Meteo best match) de todas las páginas.
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
      // copia: el respaldo de máximas no debe modificar los datos guardados de Open-Meteo
      tmax: allDias.map((_, k) => (finito((d.temperature_2m_max || [])[k]) ? d.temperature_2m_max[k] : null)),
      tmin: d.temperature_2m_min || [],
      feels: d.apparent_temperature_min || [],
      gust: d.wind_gusts_10m_max || [],
      windDir: d.wind_direction_10m_dominant || [],
      snow: d.snowfall_sum || [],
      rainProb: d.precipitation_probability_max || []
    };
  });

  if (municipios.some(m => m.tmax.slice(1).some(v => v === null))) {
    try { rellenarMaximas(municipios, allDias, (await loadOpenMeteoRespaldoMax()).list); } catch (_) { /* sin respaldo: quedan sin dato */ }
  }

  return { allDias, dias: allDias.slice(1), municipios, datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo };
}
