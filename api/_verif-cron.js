import { timingSafeEqual } from 'node:crypto';
import { MUNICIPIOS } from './_municipios.js';
import { asegurarEsquema, insertarFilas, iniciarEjecucion, hayBaseDeDatos, consultar } from './_db.js';
import { ESTACIONES, observacionesEstacion, lluviaPower, sumaDias } from './_verif-obs.js';
import { pronosticosModelos, pronosticoSmn, pronosticosHistoricos, fechaSonora, COLUMNAS_PRON, LLAVE_PRON } from './_verif-pron.js';

// Tareas automáticas de la verificación. Las dispara GitHub Actions a horas exactas (05:30 y 10:00 hora de Sonora)
// llamando a /api/cron/<tarea> con "Authorization: Bearer <CRON_SECRET>".

export function autorizacion(req) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return { ok: false, codigo: 503, mensaje: 'CRON_SECRET no está configurado en Vercel: la tarea no se ejecuta.' };
  const recibido = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const esperado = `Bearer ${secreto}`;
  const a = Buffer.from(recibido), b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, codigo: 401, mensaje: 'No autorizado.' };
  return { ok: true };
}

const COLS_OBS = ['fecha', 'estacion', 'municipio', 'calidad', 'tmax', 'tmin', 'lluvia_mm', 'lluvia_evento', 'racha_kmh', 'horas_reportadas', 'cobertura_ok', 'n_reportes', 'fuente', 'guardado_en', 'horas_ventana_max', 'horas_ventana_min', 'valida_max', 'valida_min'];
const r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const filaObs = (o, guardado) => [o.fecha, o.estacion, o.municipio, o.calidad, r2(o.tmax), r2(o.tmin), r2(o.lluvia_mm), o.lluvia_evento, r2(o.racha_kmh), o.horas_reportadas, o.cobertura_ok, o.n_reportes, o.fuente, guardado, o.horas_ventana_max, o.horas_ventana_min, o.valida_max, o.valida_min];
const msg = e => (e && e.message ? e.message : String(e));

// ---------- 05:30 h: guardar el pronóstico de hoy y de mañana ----------
export async function tareaPronostico({ forzar = false, disparo = 'manual' } = {}) {
  const cerrar = await iniciarEjecucion('pronostico');
  const res = { tarea: 'pronostico', fecha: fechaSonora(), disparo, fuentes: {}, errores: [] };
  try {
    if (!hayBaseDeDatos()) throw new Error('No hay base de datos configurada (falta DATABASE_URL).');
    await asegurarEsquema();
    const [mod, smn] = await Promise.allSettled([pronosticosModelos(), pronosticoSmn()]);
    const modo = forzar ? 'reemplazar' : 'ignorar'; // por defecto la primera copia del día se conserva
    if (mod.status === 'fulfilled') {
      const n = await insertarFilas('pronosticos', COLUMNAS_PRON, mod.value.filas, LLAVE_PRON, modo);
      res.fuentes.modelos = { filas: n, datosDeOpenMeteo: mod.value.datosDe, desdeCache: mod.value.desdeCache };
      if (mod.value.desdeCache) res.errores.push(`Open-Meteo vino de datos guardados (${mod.value.motivo})`);
    } else res.errores.push(`modelos (Open-Meteo): ${msg(mod.reason)}`);
    if (smn.status === 'fulfilled') {
      const n = await insertarFilas('pronosticos', COLUMNAS_PRON, smn.value.filas, LLAVE_PRON, modo);
      res.fuentes.smn = { filas: n, archivoGenerado: smn.value.generado, sinEmparejar: smn.value.noEncontrados };
    } else res.errores.push(`SMN: ${msg(smn.reason)}`);
    res.estado = res.errores.length ? (Object.keys(res.fuentes).length ? 'parcial' : 'error') : 'ok';
  } catch (err) { res.errores.push(msg(err)); res.estado = 'error'; }
  await cerrar(res.estado, JSON.stringify(res));
  return res;
}

// ---------- 10:00 h: guardar lo observado (ayer y, por si llegaron reportes tarde, los dos días anteriores) ----------
async function guardarObservaciones(desde, hasta, res) {
  const guardado = new Date().toISOString();
  const todas = [];
  // Una estación a la vez (con una pausa corta): pedirlas todas juntas hace que IEM responda 429.
  const resultados = [];
  for (const e of ESTACIONES) {
    try { resultados.push({ status: 'fulfilled', value: await observacionesEstacion(e, desde, hasta) }); } catch (err) { resultados.push({ status: 'rejected', reason: err }); }
    await new Promise(r => setTimeout(r, 400));
  }
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') { todas.push(...r.value.map(o => filaObs(o, guardado))); (res.estaciones ||= {})[ESTACIONES[i].id] = r.value.map(o => `${o.fecha}:${o.horas_reportadas}h[máx ${o.valida_max ? 'ok' : 'no'} (${o.horas_ventana_max} h), mín ${o.valida_min ? 'ok' : 'no'} (${o.horas_ventana_min} h)]`).join(' '); }
    else res.errores.push(`${ESTACIONES[i].id}: ${msg(r.reason)}`);
  });
  res.observaciones = await insertarFilas('observaciones', COLS_OBS, todas, ['fecha', 'estacion'], 'reemplazar');
}

async function guardarLluviaSatelite(desde, hasta, res) {
  const guardado = new Date().toISOString();
  const filas = [];
  const resultados = await Promise.allSettled(ESTACIONES.map(e => lluviaPower(e.municipio, desde, hasta)));
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') for (const [fecha, mm] of r.value) filas.push([fecha, ESTACIONES[i].municipio, r2(mm), 'NASA POWER', guardado]);
    else res.errores.push(`NASA POWER ${ESTACIONES[i].municipio}: ${msg(r.reason)}`);
  });
  res.lluviaSatelite = await insertarFilas('lluvia_satelite', ['fecha', 'municipio', 'mm', 'fuente', 'guardado_en'], filas, ['fecha', 'municipio'], 'reemplazar');
}

export async function tareaObservaciones({ fecha, disparo = 'manual' } = {}) {
  const cerrar = await iniciarEjecucion('observaciones');
  const hoy = fechaSonora();
  const hasta = fecha || sumaDias(hoy, -1);
  const res = { tarea: 'observaciones', hasta, disparo, errores: [] };
  try {
    if (!hayBaseDeDatos()) throw new Error('No hay base de datos configurada (falta DATABASE_URL).');
    await asegurarEsquema();
    // Los días guardados antes de la regla de cobertura por variable no traen esas columnas: se reprocesan (hasta 120 días atrás).
    let desde = sumaDias(hasta, -2);
    try {
      const sinRegla = await consultar('SELECT MIN(fecha) AS desde FROM observaciones WHERE valida_max IS NULL AND fecha >= $1', [sumaDias(hasta, -119)]);
      if (sinRegla[0] && sinRegla[0].desde && sinRegla[0].desde < desde) { desde = sinRegla[0].desde; res.reprocesadoDesde = desde; }
    } catch (_) { /* si no se puede consultar, se procesan los últimos 3 días */ }
    await guardarObservaciones(desde, hasta, res);
    await guardarLluviaSatelite(sumaDias(hoy, -12), sumaDias(hoy, -1), res); // NASA POWER llega con ~3 días de retraso
    res.estado = res.errores.length ? (res.observaciones ? 'parcial' : 'error') : 'ok';
  } catch (err) { res.errores.push(msg(err)); res.estado = 'error'; }
  await cerrar(res.estado, JSON.stringify(res));
  return res;
}

// ---------- carga histórica única (60-90 días): pronósticos de corto plazo + observaciones + lluvia satelital ----------
export async function tareaHistorico({ dias = 75 } = {}) {
  const cerrar = await iniciarEjecucion('historico');
  const n = Math.max(7, Math.min(120, Number(dias) || 75));
  const hasta = sumaDias(fechaSonora(), -1);
  const desde = sumaDias(hasta, -(n - 1));
  const res = { tarea: 'historico', desde, hasta, errores: [] };
  try {
    if (!hayBaseDeDatos()) throw new Error('No hay base de datos configurada (falta DATABASE_URL).');
    await asegurarEsquema();
    try {
      const filas = await pronosticosHistoricos(desde, hasta);
      res.pronosticosHistoricos = await insertarFilas('pronosticos', COLUMNAS_PRON, filas, LLAVE_PRON, 'ignorar');
    } catch (err) { res.errores.push(`pronósticos históricos: ${msg(err)}`); }
    await guardarObservaciones(desde, hasta, res);
    await guardarLluviaSatelite(desde, hasta, res);
    res.estado = res.errores.length ? 'parcial' : 'ok';
  } catch (err) { res.errores.push(msg(err)); res.estado = 'error'; }
  await cerrar(res.estado, JSON.stringify(res));
  return res;
}

// ---------- respaldo: si la tarea programada no corrió, el guardado se hace en la primera consulta posterior ----------
// GitHub Actions puede retrasar horas (o saltarse) una ejecución programada. Después de las 07:00 h (pronóstico) y de las 11:00 h
// (observaciones), /api/verificacion y /api/resumen-pronostico comprueban si ya está guardado lo de hoy y, si falta, lo guardan.
// Los guardados son idempotentes: si luego llega la ejecución programada, no duplica ni sobrescribe el pronóstico ya guardado.
const horaSonora = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Hermosillo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
let ultimoRespaldo = { at: 0, res: null };

export async function respaldoSiFalta() {
  if (!hayBaseDeDatos()) return null;
  if (ultimoRespaldo.res && Date.now() - ultimoRespaldo.at < 5 * 60 * 1000) return ultimoRespaldo.res;
  const out = { pronostico: null, observaciones: null };
  try {
    await asegurarEsquema();
    const hoy = fechaSonora(), ayer = sumaDias(hoy, -1), hora = horaSonora();
    const intentoReciente = async tarea => {
      const f = await consultar('SELECT inicio FROM ejecuciones WHERE tarea = $1 ORDER BY inicio DESC LIMIT 1', [tarea]);
      return Boolean(f[0]) && Date.now() - Date.parse(f[0].inicio) < 10 * 60 * 1000;
    };
    if (hora >= 7) {
      const r = await consultar("SELECT COUNT(DISTINCT fuente) AS n FROM pronosticos WHERE origen = 'cron' AND fecha_emision = $1", [hoy]);
      if (Number(r[0].n) >= 5) out.pronostico = 'ya estaba guardado';
      else if (await intentoReciente('pronostico')) out.pronostico = 'faltaba, pero hay un intento de guardado en los últimos 10 minutos';
      else { const t = await tareaPronostico({ disparo: 'respaldo (primera consulta después de las 07:00 h)' }); out.pronostico = `faltaba: se guardó ahora como respaldo (${t.estado}${t.errores.length ? '; ' + t.errores.join('; ') : ''})`; }
    }
    if (hora >= 11) {
      const r = await consultar('SELECT COUNT(DISTINCT estacion) AS n FROM observaciones WHERE fecha = $1', [ayer]);
      if (Number(r[0].n) >= ESTACIONES.length) out.observaciones = 'ya estaban guardadas';
      else if (await intentoReciente('observaciones')) out.observaciones = 'faltaban, pero hay un intento de guardado en los últimos 10 minutos';
      else { const t = await tareaObservaciones({ disparo: 'respaldo (primera consulta después de las 11:00 h)' }); out.observaciones = `faltaban: se guardaron ahora como respaldo (${t.estado}${t.errores.length ? '; ' + t.errores.join('; ') : ''})`; }
    }
  } catch (err) { out.error = err && err.message ? err.message : String(err); }
  ultimoRespaldo = { at: Date.now(), res: out };
  return out;
}

export { MUNICIPIOS };
