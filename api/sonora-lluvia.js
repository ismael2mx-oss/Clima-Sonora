import { loadLluviaDiaria } from './_lluvia.js';

// Se conserva el nombre para quienes ya lo importan; el cálculo vive en _lluvia.js (fuente única de lluvia).
export async function loadSonoraRain() {
  return loadLluviaDiaria();
}

export default async function handler(req, res) {
  try {
    const { dias, municipios, datosDe, desdeCache, motivo } = await loadSonoraRain();
    // Con datos guardados por una falla de Open-Meteo, la respuesta no se guarda en caché.
    res.setHeader('Cache-Control', desdeCache ? 'no-store' : 's-maxage=1800, stale-while-revalidate=300');
    res.status(200).json({ generado: new Date().toISOString(), dias, municipios, datosDe, desdeCache, motivo });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar la lluvia de Sonora.' } });
  }
}
