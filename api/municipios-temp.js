import { MUNICIPIOS } from './_municipios.js';
import { loadLluviaDiaria } from './_lluvia.js';
import { loadSonoraFrio, rellenarMaximas } from './_frio-data.js';
import { loadOpenMeteoRespaldoMax } from './_openmeteo.js';

// Lista de máximas de hoy. La fuente es la MISMA que la de la página de frío (Open-Meteo best match, con respaldo de
// ICON, GFS o ECMWF para el municipio al que le falte); el mapa y el panel del municipio usan esta misma respuesta.
// La probabilidad de lluvia sale de la fuente única (_lluvia.js: Open-Meteo, día completo 00-24 h de Sonora).

const hoySonora = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Hermosillo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function maximasDeHoy(hoy) {
  try {
    const f = await loadSonoraFrio();
    const k = f.allDias.indexOf(hoy);
    if (k < 0) throw new Error('los datos de Open-Meteo no traen el día de hoy');
    return { municipios: f.municipios, k, desdeCache: f.desdeCache, datosDe: f.datosDe };
  } catch (errorPrincipal) {
    // Si best match no responde para nadie, se usan los otros modelos para todos.
    try {
      const r = await loadOpenMeteoRespaldoMax();
      const fechas = r.list[0]?.daily?.time || [];
      const k = fechas.indexOf(hoy);
      if (k < 0) throw errorPrincipal;
      const municipios = MUNICIPIOS.map(m => ({ municipio: m.municipio, cabecera: m.cabecera, tmax: fechas.map(() => null) }));
      rellenarMaximas(municipios, fechas, r.list);
      return { municipios, k, desdeCache: r.desdeCache, datosDe: r.datosDe };
    } catch (_) { throw errorPrincipal; }
  }
}

export default async function handler(req, res) {
  const hoy = hoySonora();
  let lluvia = new Map();
  let lluviaOk = true;
  try {
    const r = await loadLluviaDiaria();
    lluvia = new Map(r.municipios.map(m => [m.municipio, m.prob[0]]));
    lluviaOk = !r.desdeCache;
  } catch (err) {
    lluviaOk = false;
  }

  let datos;
  try {
    datos = await maximasDeHoy(hoy);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: { message: `No se pudieron consultar las máximas en Open-Meteo: ${err && err.message ? err.message : 'error desconocido'}` } });
    return;
  }

  const resultados = datos.municipios.map(m => {
    const v = m.tmax[datos.k];
    const respaldo = (m.tmaxRespaldo && m.tmaxRespaldo[hoy]) || null;
    const prob = lluvia.get(m.municipio);
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      maxtemp_c: Number.isFinite(v) ? v : null,
      fuente: Number.isFinite(v) ? (respaldo || 'best match') : null,
      respaldo: Boolean(respaldo),
      chance_of_rain: typeof prob === 'number' ? prob : null
    };
  });

  resultados.sort((a, b) => {
    if (a.maxtemp_c === null) return 1;
    if (b.maxtemp_c === null) return -1;
    return b.maxtemp_c - a.maxtemp_c || a.municipio.localeCompare(b.municipio, 'es');
  });

  // Misma duración de caché que la página de frío. Con datos guardados, sin lluvia o con algún hueco no se guarda.
  const completa = resultados.every(r => r.maxtemp_c !== null);
  res.setHeader('Cache-Control', lluviaOk && completa && !datos.desdeCache ? 's-maxage=900, stale-while-revalidate=300' : 'no-store');
  res.status(200).json({ generado: new Date().toISOString(), fecha: hoy, fuente: 'Open-Meteo (best match)', datosDe: datos.datosDe, desdeCache: datos.desdeCache, municipios: resultados });
}
