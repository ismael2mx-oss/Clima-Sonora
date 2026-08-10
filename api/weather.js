async function mergeOpenMeteoRain(data) {
  const lat = data?.location?.lat;
  const lon = data?.location?.lon;
  const days = data?.forecast?.forecastday;
  if (lat === undefined || lon === undefined || !days) return;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability&daily=precipitation_probability_max&timezone=America/Hermosillo&forecast_days=3`;

  const upstream = await fetch(url);
  if (!upstream.ok) return;
  const om = await upstream.json();

  const dailyMap = new Map();
  (om?.daily?.time || []).forEach((date, i) => {
    dailyMap.set(date, om.daily.precipitation_probability_max[i]);
  });

  const hourlyMap = new Map();
  (om?.hourly?.time || []).forEach((time, i) => {
    hourlyMap.set(time, om.hourly.precipitation_probability[i]);
  });

  days.forEach(d => {
    if (dailyMap.has(d.date)) {
      d.day.daily_chance_of_rain = dailyMap.get(d.date);
    }
    (d.hour || []).forEach(h => {
      const key = h.time.replace(' ', 'T');
      if (hourlyMap.has(key)) {
        h.chance_of_rain = hourlyMap.get(key);
      }
    });
  });
}

export default async function handler(req, res) {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'Falta configurar WEATHERAPI_KEY en el servidor.' } });
    return;
  }

  const q = req.query.q;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: { message: 'Falta el parámetro de ciudad/coordenadas (q).' } });
    return;
  }

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(q)}&days=3&aqi=no&alerts=no&lang=es`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();

    if (upstream.ok) {
      try {
        await mergeOpenMeteoRain(data);
      } catch (err) {
        // Si Open-Meteo falla, seguimos con el dato de lluvia original de WeatherAPI.
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'No se pudo contactar a WeatherAPI.' } });
  }
}
