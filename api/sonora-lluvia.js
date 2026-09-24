import { MUNICIPIOS } from './_municipios.js';

export default async function handler(req, res) {
  const lats = MUNICIPIOS.map(m => m.lat).join(',');
  const lons = MUNICIPIOS.map(m => m.lon).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=precipitation_probability_max,precipitation_sum&timezone=America/Hermosillo&forecast_days=5`;

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error('Open-Meteo no disponible.');
    const data = await upstream.json();
    const list = Array.isArray(data) ? data : [data];
    if (list.length !== MUNICIPIOS.length) throw new Error('Respuesta incompleta de Open-Meteo.');

    const dias = list[0]?.daily?.time || [];
    const municipios = MUNICIPIOS.map((m, i) => ({
      municipio: m.municipio,
      cabecera: m.cabecera,
      prob: list[i]?.daily?.precipitation_probability_max || [],
      mm: list[i]?.daily?.precipitation_sum || []
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
    res.status(200).json({ generado: new Date().toISOString(), dias, municipios });
  } catch (err) {
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar la lluvia de Sonora.' } });
  }
}
