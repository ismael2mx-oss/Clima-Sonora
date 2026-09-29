import { loadSonoraFrio } from './_frio-data.js';

export default async function handler(req, res) {
  try {
    const { dias, municipios } = await loadSonoraFrio();
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json({ generado: new Date().toISOString(), dias, municipios });
  } catch (err) {
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar el frío en Sonora.' } });
  }
}
