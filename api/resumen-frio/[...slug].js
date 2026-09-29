import { buildResumenFrio } from '../resumen-frio.js';

// Mismo contenido que /api/resumen-frio, ignorando el segmento extra de la URL
// (por ejemplo /api/resumen-frio/2026-11-15-0700), para poder variar la ruta
// y así evitar cachés externas que no respeten Cache-Control.
export default async function handler(req, res) {
  try {
    const text = await buildResumenFrio();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send(`No se pudo generar el resumen de frío. Motivo: ${err.message || 'error desconocido'}`);
  }
}
