export default async function handler(req, res) {
  const apiKey = process.env.WEATHERAPI_KEY;
  const q = req.query.q || 'Hermosillo';
  const dt = req.query.dt;
  const url = `https://api.weatherapi.com/v1/history.json?key=${apiKey}&q=${encodeURIComponent(q)}&dt=${dt}`;
  const upstream = await fetch(url);
  const data = await upstream.json();
  res.status(upstream.status).json(data);
}
