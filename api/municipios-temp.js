import { MUNICIPIOS } from './_municipios.js';
import { loadLluviaDiaria } from './_lluvia.js';

// La probabilidad de lluvia sale SIEMPRE de la fuente única (_lluvia.js: Open-Meteo, día completo 00-24 h de Sonora).
// Si no está disponible se devuelve null ("—" en la página); ya no se mezcla con la cifra de WeatherAPI.
async function fetchMaxTemp(apiKey, m, lluvia) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${m.lat},${m.lon}&days=1&aqi=no&alerts=no&lang=es`;
  const prob = lluvia.get(m.municipio);
  const chance = typeof prob === 'number' ? prob : null;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return { municipio: m.municipio, cabecera: m.cabecera, maxtemp_c: null, chance_of_rain: chance, condicion: null };
    const data = await upstream.json();
    const day = data?.forecast?.forecastday?.[0]?.day;
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      maxtemp_c: day ? day.maxtemp_c : null,
      chance_of_rain: chance,
      condicion: day ? day.condition.text : null
    };
  } catch (err) {
    return { municipio: m.municipio, cabecera: m.cabecera, maxtemp_c: null, chance_of_rain: chance, condicion: null };
  }
}

async function fetchInBatches(apiKey, items, batchSize, lluvia) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(m => fetchMaxTemp(apiKey, m, lluvia)));
    results.push(...batchResults);
  }
  return results;
}

export default async function handler(req, res) {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'Falta configurar WEATHERAPI_KEY en el servidor.' } });
    return;
  }

  let lluvia = new Map();
  let lluviaOk = true;
  try {
    const r = await loadLluviaDiaria();
    lluvia = new Map(r.municipios.map(m => [m.municipio, m.prob[0]]));
    lluviaOk = !r.desdeCache;
  } catch (err) {
    lluviaOk = false;
  }

  const resultados = await fetchInBatches(apiKey, MUNICIPIOS, 10, lluvia);

  // WeatherAPI a veces falla para algunos municipios: se reintentan una vez (en lotes más chicos) antes de responder.
  const fallidos = resultados.filter(r => r.maxtemp_c === null);
  if (fallidos.length) {
    await new Promise(r => setTimeout(r, 800));
    const nombres = new Set(fallidos.map(r => r.municipio));
    const otra = await fetchInBatches(apiKey, MUNICIPIOS.filter(m => nombres.has(m.municipio)), 4, lluvia);
    for (const n of otra) if (n.maxtemp_c !== null) resultados[resultados.findIndex(r => r.municipio === n.municipio)] = n;
  }

  resultados.sort((a, b) => {
    if (a.maxtemp_c === null) return 1;
    if (b.maxtemp_c === null) return -1;
    return b.maxtemp_c - a.maxtemp_c;
  });

  // Sin la lluvia de Open-Meteo (o con datos guardados) la respuesta no se guarda en caché.
  // Tampoco se guarda en caché una lista a la que le falte alguna máxima (si no, el hueco duraría 30 minutos).
  const completa = resultados.every(r => r.maxtemp_c !== null);
  res.setHeader('Cache-Control', lluviaOk && completa ? 's-maxage=1800, stale-while-revalidate=300' : 'no-store');
  res.status(200).json({ generado: new Date().toISOString(), municipios: resultados });
}
