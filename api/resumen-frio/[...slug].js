import { respondResumenFrio } from '../resumen-frio.js';

// Mismo contenido que /api/resumen-frio, ignorando el segmento extra de la URL
// (por ejemplo /api/resumen-frio/2026-11-15-0700), para poder variar la ruta
// y así evitar cachés externas que no respeten Cache-Control.
export default respondResumenFrio;
