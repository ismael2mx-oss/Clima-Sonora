import { MUNICIPIOS } from './_municipios.js';

async function fetchRainOpenMeteo(m) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${m.lat}&longitude=${m.lon}&daily=precipitation_probability_max&timezone=America/Hermosillo&forecast_days=1`;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return null;
    const data = await upstream.json();
    const val = data?.daily?.precipitation_probability_max?.[0];
    return typeof val === 'number' ? val : null;
  } catch (err) {
    return null;
  }
}

async function fetchMaxTemp(apiKey, m) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${m.lat},${m.lon}&days=1&aqi=no&alerts=no&lang=es`;
  try {
    const [upstream, rainOpenMeteo] = await Promise.all([fetch(url), fetchRainOpenMeteo(m)]);
    if (!upstream.ok) return { ...m, maxtemp_c: null, chance_of_rain: rainOpenMeteo, condicion: null };
    const data = await upstream.json();
    const day = data?.forecast?.forecastday?.[0]?.day;
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      maxtemp_c: day ? day.maxtemp_c : null,
      chance_of_rain: rainOpenMeteo !== null ? rainOpenMeteo : (day ? day.daily_chance_of_rain : null),
      condicion: day ? day.condition.text : null
    };
  } catch (err) {
    return { municipio: m.municipio, cabecera: m.cabecera, maxtemp_c: null, chance_of_rain: null, condicion: null };
  }
}

async function fetchInBatches(apiKey, items, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(m => fetchMaxTemp(apiKey, m)));
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

  const resultados = await fetchInBatches(apiKey, MUNICIPIOS, 10);

  resultados.sort((a, b) => {
    if (a.maxtemp_c === null) return 1;
    if (b.maxtemp_c === null) return -1;
    return b.maxtemp_c - a.maxtemp_c;
  });

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  res.status(200).json({ generado: new Date().toISOString(), municipios: resultados });
}
