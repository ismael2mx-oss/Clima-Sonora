import { buildResumenCiclones } from '../resumen-ciclones.js';

// Mismo contenido que /api/resumen-ciclones, ignorando el segmento extra de la URL
// (por ejemplo /api/resumen-ciclones/2026-11-15-0700), para poder variar la ruta
// y así evitar cachés externas que no respeten Cache-Control.
export default async function handler(req, res) {
  try {
    const text = await buildResumenCiclones();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send(`No se pudo generar el resumen de ciclones. Motivo: ${err.message || 'error desconocido'}`);
  }
}
