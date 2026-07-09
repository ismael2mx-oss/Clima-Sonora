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
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'No se pudo contactar a WeatherAPI.' } });
  }
}
