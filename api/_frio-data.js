import { MUNICIPIOS } from './_municipios.js';

// Pide 1 día extra hacia atrás (past_days=1) para poder comparar el primer día
// del pronóstico contra el día anterior real, igual que el resto de la serie.
export async function loadSonoraFrio() {
  const lats = MUNICIPIOS.map(m => m.lat).join(',');
  const lons = MUNICIPIOS.map(m => m.lon).join(',');
  const vars = [
    'temperature_2m_max', 'temperature_2m_min', 'apparent_temperature_min',
    'wind_gusts_10m_max', 'wind_direction_10m_dominant', 'snowfall_sum'
  ].join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=${vars}&timezone=America/Hermosillo&past_days=1&forecast_days=5`;

  const upstream = await fetch(url);
  if (!upstream.ok) throw new Error('Open-Meteo no disponible.');
  const data = await upstream.json();
  const list = Array.isArray(data) ? data : [data];
  if (list.length !== MUNICIPIOS.length) throw new Error('Respuesta incompleta de Open-Meteo.');

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
      snow: d.snowfall_sum || []
    };
  });

  return { allDias, dias: allDias.slice(1), municipios };
}
