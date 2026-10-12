import { loadFrenteEstado } from './_frente-data.js';

export default async function handler(req, res) {
  try {
    const simular = String(req.query.simular || '') === '1';
    const estado = await loadFrenteEstado({ simular });
    // Una respuesta con alguna fuente caída (o simulada) no se guarda en caché.
    res.setHeader('Cache-Control', estado.hayError || simular ? 'no-store' : 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json(estado);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar el estado del frente frío.' } });
  }
}
