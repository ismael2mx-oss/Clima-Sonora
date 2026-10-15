import { loadSonoraFrio } from './_frio-data.js';
import { loadFrenteEstado } from './_frente-data.js';

// El plan Hobby de Vercel permite 12 funciones: el estado del frente frío comparte
// este endpoint (?parte=frente) en vez de tener el suyo.
async function responderFrente(req, res) {
  const simular = String(req.query.simular || '') === '1';
  const estado = await loadFrenteEstado({ simular });
  // Una respuesta con alguna fuente caída, con datos guardados de Open-Meteo o simulada no se guarda en caché.
  res.setHeader('Cache-Control', estado.hayError || simular ? 'no-store' : 's-maxage=900, stale-while-revalidate=300');
  res.status(200).json(estado);
}

export default async function handler(req, res) {
  try {
    if (String(req.query.parte || '') === 'frente') {
      await responderFrente(req, res);
      return;
    }
    const { dias, municipios, datosDe, desdeCache, motivo } = await loadSonoraFrio();
    // Si Open-Meteo falló y se usaron datos guardados, la respuesta no se guarda en caché.
    res.setHeader('Cache-Control', desdeCache ? 'no-store' : 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json({ generado: new Date().toISOString(), dias, municipios, datosDe, desdeCache, motivo });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar el frío en Sonora.' } });
  }
}
