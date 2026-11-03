import { consultar, asegurarEsquema, hayBaseDeDatos } from './_db.js';
import { REGIONES } from './_regiones.js';
import { ESTACIONES, CALIDAD_TXT, MIN_HORAS_COBERTURA, sumaDias } from './_verif-obs.js';
import { FUENTES, FUENTE_NOMBRE, fechaSonora } from './_verif-pron.js';

// Comparación de lo pronosticado contra lo observado: error del día, sesgo, MAE (7 y 30 días), % de aciertos y ranking por región.

export const UMBRAL_ACIERTO_C = 2;     // máximas y mínimas "acertadas" dentro de ±2 °C
export const UMBRAL_LLUVIA_MM = 1;     // lluvia "sí" con 1 mm o más
export const SESGO_IMPORTANTE_C = 1.5; // sesgo mínimo para destacarlo
export const MIN_DIAS_SESGO = 7;

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (v, signo = false) => (Number.isFinite(v) ? `${signo && v > 0 ? '+' : ''}${v.toFixed(1)}` : 'n/d');
const pct = (a, n) => (n ? `${Math.round((100 * a) / n)}%` : 'n/d');
const ESTACION_DE = Object.fromEntries(ESTACIONES.map(e => [e.municipio, e]));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// ---------- carga de datos ----------
// Cada fila une un pronóstico con lo observado ese día en la estación del municipio.
export async function cargarComparaciones(origen, desdeFecha) {
  await asegurarEsquema();
  const filas = await consultar(
    `SELECT p.fecha_emision, p.fecha_objetivo, p.dias_adelante, p.municipio, p.fuente,
            p.tmax AS ftmax, p.tmin AS ftmin, p.lluvia_mm AS fmm, p.prob_lluvia AS fprob, p.racha_kmh AS fracha,
            o.estacion, o.calidad, o.tmax AS otmax, o.tmin AS otmin, o.lluvia_mm AS omm, o.lluvia_evento AS oevento, o.racha_kmh AS oracha,
            o.cobertura_ok, o.horas_reportadas
       FROM pronosticos p JOIN observaciones o ON o.fecha = p.fecha_objetivo AND o.municipio = p.municipio
      WHERE p.origen = $1 AND p.fecha_objetivo >= $2`, [origen, desdeFecha]);
  return filas.map(r => ({ ...r, dias_adelante: Number(r.dias_adelante), cobertura_ok: Number(r.cobertura_ok), horas_reportadas: Number(r.horas_reportadas) }));
}

const num = v => (v === null || v === undefined ? null : Number(v));
const ok = v => Number.isFinite(num(v));

// ---------- estadísticas de un conjunto de filas (ya sin días de baja cobertura) ----------
export function estadisticas(filas) {
  const errs = (f, o) => filas.filter(r => ok(r[f]) && ok(r[o])).map(r => num(r[f]) - num(r[o]));
  const resumen = e => ({ n: e.length, sesgo: mean(e), mae: mean(e.map(Math.abs)), acierto: e.filter(x => Math.abs(x) <= UMBRAL_ACIERTO_C).length });
  const lluvia = filas.filter(r => ok(r.fmm) && (ok(r.omm) || num(r.oevento) !== null)).map(r => {
    const obs = ok(r.omm) ? num(r.omm) >= UMBRAL_LLUVIA_MM : Number(r.oevento) === 1;
    const pron = num(r.fmm) >= UMBRAL_LLUVIA_MM;
    return { acierto: obs === pron, mmErr: ok(r.omm) ? num(r.fmm) - num(r.omm) : null };
  });
  const mmErr = lluvia.map(x => x.mmErr).filter(Number.isFinite);
  return {
    tmax: resumen(errs('ftmax', 'otmax')), tmin: resumen(errs('ftmin', 'otmin')),
    racha: resumen(errs('fracha', 'oracha')),
    lluvia: { n: lluvia.length, aciertos: lluvia.filter(x => x.acierto).length, nMm: mmErr.length, maeMm: mean(mmErr.map(Math.abs)), sesgoMm: mean(mmErr) }
  };
}

const enVentana = (filas, hasta, dias) => { const desde = sumaDias(hasta, -(dias - 1)); return filas.filter(r => r.fecha_objetivo >= desde && r.fecha_objetivo <= hasta); };
const conCobertura = filas => filas.filter(r => r.cobertura_ok === 1);
const porFuente = (filas, fuente, lead) => filas.filter(r => r.fuente === fuente && r.dias_adelante === lead);

// MAE combinado de máximas y mínimas, usado para el ranking.
function maeCombinado(e) { const n = e.tmax.n + e.tmin.n; return n ? ((e.tmax.mae || 0) * e.tmax.n + (e.tmin.mae || 0) * e.tmin.n) / n : null; }

export function rankingRegion(filas, region, hasta, dias, lead) {
  const munis = new Set(REGIONES[region] || []);
  const base = enVentana(conCobertura(filas), hasta, dias).filter(r => munis.has(r.municipio) && r.calidad !== 'aproximacion_lejana');
  const estaciones = [...new Set(base.map(r => r.estacion))];
  const filasR = FUENTES.map(f => { const e = estadisticas(porFuente(base, f, lead)); return { fuente: f, mae: maeCombinado(e), n: e.tmax.n + e.tmin.n, sesgoMax: e.tmax.sesgo, sesgoMin: e.tmin.sesgo }; })
    .filter(x => x.n >= 3 && Number.isFinite(x.mae)).sort((a, b) => a.mae - b.mae);
  const dist = new Set(base.map(r => r.fecha_objetivo)).size;
  return { ranking: filasR, estaciones, dias: dist };
}

// ---------- lecturas de la base ----------
async function ultimasEjecuciones() {
  const out = {};
  for (const t of ['pronostico', 'observaciones', 'historico']) {
    const f = await consultar('SELECT inicio, fin, estado, detalle FROM ejecuciones WHERE tarea = $1 ORDER BY inicio DESC LIMIT 1', [t]);
    out[t] = f[0] || null;
  }
  return out;
}

async function conteos() {
  const a = await consultar(`SELECT COUNT(DISTINCT fecha_emision) AS dias, MIN(fecha_emision) AS desde, MAX(fecha_emision) AS hasta, COUNT(*) AS filas FROM pronosticos WHERE origen = 'cron'`);
  const b = await consultar('SELECT COUNT(DISTINCT fecha) AS dias, MIN(fecha) AS desde, MAX(fecha) AS hasta, COUNT(*) AS filas FROM observaciones');
  const c = await consultar(`SELECT COUNT(*) AS filas, MIN(fecha_objetivo) AS desde, MAX(fecha_objetivo) AS hasta FROM pronosticos WHERE origen = 'historico_corto_plazo'`);
  return { pron: a[0], obs: b[0], hist: c[0] };
}

const horaSon = iso => (iso ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Hermosillo' }).format(new Date(iso)) + ' h' : 'nunca');

// ---------- datos para /api/resumen-pronostico: una línea por región ----------
export async function lineasVerificacionPorRegion() {
  if (!hayBaseDeDatos()) return null;
  const hoy = fechaSonora();
  const filas = await cargarComparaciones('cron', sumaDias(hoy, -35));
  const hasta = sumaDias(hoy, -1);
  const out = {};
  for (const region of Object.keys(REGIONES)) {
    const r = rankingRegion(filas, region, hasta, 30, 0);
    if (r.dias < 7 || !r.ranking.length) continue;
    const mejor = r.ranking[0];
    const bm = r.ranking.find(x => x.fuente === 'best_match');
    out[region] = `Verificación (últimos ${r.dias} días con datos, ${r.estaciones.length} estación(es); aproximación donde la estación es de Arizona): modelo más confiable ${FUENTE_NOMBRE[mejor.fuente]} (error medio ${f1(mejor.mae)} °C en máx+mín, sesgo máx ${f1(mejor.sesgoMax, true)} / mín ${f1(mejor.sesgoMin, true)} °C)${bm && bm !== mejor ? `; best match: error ${f1(bm.mae)} °C, sesgo máx ${f1(bm.sesgoMax, true)} / mín ${f1(bm.sesgoMin, true)} °C` : ''}`;
  }
  return out;
}

// ---------- texto de /api/verificacion ----------
export async function textoVerificacion({ muestra = false } = {}) {
  const L = [];
  const ahora = Date.now();
  const hoy = fechaSonora(ahora);
  L.push('VERIFICACIÓN DE PRONÓSTICOS — SONORA');
  L.push(`Generado: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'medium', hour12: false, timeZone: 'America/Hermosillo' }).format(new Date(ahora))} h (hora de Sonora, UTC-7)`);
  L.push('Compara lo que pronosticamos a las 05:30 h (ICON, GFS, ECMWF, best match y el pronóstico oficial del SMN) con lo observado en estaciones reales (METAR de aeropuertos). Día = 00:00 a 24:00 h hora de Sonora.');
  L.push('');
  if (!hayBaseDeDatos()) {
    L.push('[No disponible: la base de datos no está configurada (falta DATABASE_URL). Instala Neon desde el Marketplace de Vercel y vuelve a desplegar.]');
    return L.join('\n');
  }
  try { await asegurarEsquema(); } catch (err) { L.push(`[No disponible: no se pudo conectar a la base de datos: ${err.message}]`); return L.join('\n'); }

  const SEP = '==================================================';
  const [ej, cnt] = await Promise.all([ultimasEjecuciones(), conteos()]);
  L.push(SEP, 'ESTADO DE LOS DATOS', SEP);
  const linEj = (t, nombre, horasMax) => {
    const e = ej[t];
    if (!e) return `- ${nombre}: nunca se ha ejecutado`;
    const horas = Math.round((ahora - Date.parse(e.inicio)) / 3600000);
    const viejo = horasMax && horas > horasMax ? ` — ATENCIÓN: hace ${horas} h, debería ejecutarse cada día` : '';
    const estado = e.estado === 'en curso' && horas >= 1 ? 'no terminó (interrumpida o con tiempo agotado)' : e.estado;
    return `- ${nombre}: última ejecución ${horaSon(e.inicio)} (${estado})${viejo}`;
  };
  L.push(linEj('pronostico', 'Guardado del pronóstico (05:30 h)', 26), linEj('observaciones', 'Guardado de observaciones (10:00 h)', 26), linEj('historico', 'Carga histórica (única)', null));
  L.push(`- Pronósticos guardados (a las 05:30 h): ${cnt.pron.dias} día(s) desde ${cnt.pron.desde || 'n/d'} hasta ${cnt.pron.hasta || 'n/d'} (${cnt.pron.filas} filas)`);
  L.push(`- Observaciones guardadas: ${cnt.obs.dias} día(s) desde ${cnt.obs.desde || 'n/d'} hasta ${cnt.obs.hasta || 'n/d'}`);
  L.push(`- Histórico de corto plazo (carga inicial, se reporta aparte): ${cnt.hist.filas} filas, ${cnt.hist.desde || 'n/d'} a ${cnt.hist.hasta || 'n/d'}`);
  L.push(`- Estaciones: ${ESTACIONES.map(e => `${e.municipio} = ${e.id} (${CALIDAD_TXT[e.calidad]})`).join('; ')}`);
  L.push(`- Un día de una estación con menos de ${MIN_HORAS_COBERTURA} de 24 horas reportadas se marca "baja cobertura" y se excluye de los cálculos.`);
  L.push('');

  if (muestra) {
    L.push(SEP, 'ÚLTIMOS REGISTROS GUARDADOS (muestra)', SEP);
    const p = await consultar(`SELECT * FROM pronosticos WHERE origen = 'cron' ORDER BY guardado_en DESC, municipio LIMIT 4`);
    p.forEach(r => L.push(`pronosticos: ${JSON.stringify(r)}`));
    const o = await consultar('SELECT * FROM observaciones ORDER BY guardado_en DESC LIMIT 3');
    o.forEach(r => L.push(`observaciones: ${JSON.stringify(r)}`));
    const e = await consultar('SELECT * FROM ejecuciones ORDER BY inicio DESC LIMIT 4');
    e.forEach(r => L.push(`ejecuciones: ${JSON.stringify({ ...r, detalle: String(r.detalle || '').slice(0, 300) })}`));
    L.push('');
  }

  const hasta = sumaDias(hoy, -1);
  const filas = await cargarComparaciones('cron', sumaDias(hoy, -62));
  const validas = conCobertura(filas);
  const dias = new Set(validas.map(r => r.fecha_objetivo));

  // --- Resumen de ayer ---
  L.push(SEP, 'RESUMEN DE AYER (pronóstico emitido ayer a las 05:30 h vs observado)', SEP);
  const ult = [...new Set(filas.map(r => r.fecha_objetivo))].sort().pop();
  if (!ult) L.push('Todavía no hay pronósticos guardados con observaciones del mismo día. Cuando haya al menos un día completo aparecerá aquí.');
  else {
    L.push(`Fecha: ${ult}${ult !== hasta ? ` (el día más reciente con datos; ayer fue ${hasta})` : ''}. Error = pronóstico − observado.`);
    for (const est of ESTACIONES) {
      const rows = filas.filter(r => r.fecha_objetivo === ult && r.estacion === est.id && r.dias_adelante === 0);
      const base = rows[0];
      if (!base) { L.push(`- ${est.municipio} (${est.id}, ${CALIDAD_TXT[est.calidad]}): sin datos`); continue; }
      const cab = `- ${est.municipio} (${est.id}, ${CALIDAD_TXT[est.calidad]}; ${base.horas_reportadas} de 24 h reportadas)`;
      if (base.cobertura_ok !== 1) { L.push(`${cab}: BAJA COBERTURA, excluida de los cálculos (observado máx ${f1(num(base.otmax))} / mín ${f1(num(base.otmin))} °C, no confiable)`); continue; }
      const llu = ok(base.omm) ? `${f1(num(base.omm))} mm` : (Number(base.oevento) ? 'llovió (sin mm)' : 'no llovió');
      L.push(`${cab}: observado máx ${f1(num(base.otmax))} / mín ${f1(num(base.otmin))} °C, lluvia ${llu}${ok(base.oracha) ? `, racha ${f1(num(base.oracha))} km/h` : ''}`);
      FUENTES.forEach(f => { const r = rows.find(x => x.fuente === f); if (r) L.push(`    ${FUENTE_NOMBRE[f].padEnd(11)} máx ${f1(num(r.ftmax))} (${f1(num(r.ftmax) - num(r.otmax), true)}) · mín ${f1(num(r.ftmin))} (${f1(num(r.ftmin) - num(r.otmin), true)}) · lluvia ${f1(num(r.fmm))} mm`); });
    }
  }
  L.push('');

  // --- Ranking por región ---
  L.push(SEP, 'RANKING DE FUENTES POR REGIÓN (error medio absoluto de máximas y mínimas, °C; menor es mejor)', SEP);
  L.push('Solo cuentan estaciones de Sonora y de Arizona como aproximación; San Luis Río Colorado (aproximación lejana) va aparte. Las regiones sin estación no se pueden verificar.');
  for (const region of Object.keys(REGIONES)) {
    const t = [];
    for (const [lead, nombre] of [[0, 'hoy'], [1, 'mañana']]) for (const d of [7, 30]) {
      const r = rankingRegion(filas, region, hasta, d, lead);
      t.push(`  ${nombre}, últimos ${d} d (${r.dias} día(s) con datos): ${r.ranking.length ? r.ranking.map((x, i) => `${i + 1}) ${FUENTE_NOMBRE[x.fuente]} ${f1(x.mae)}`).join(' · ') : 'sin datos suficientes'}`);
    }
    const est = rankingRegion(filas, region, hasta, 30, 0).estaciones;
    const sinEstacion = !REGIONES[region].some(m => ESTACION_DE[m] && ESTACION_DE[m].calidad !== 'aproximacion_lejana');
    L.push(`- ${region}${sinEstacion ? ': SIN ESTACIÓN, no se puede verificar' : ` (estaciones: ${est.length ? est.join(', ') : 'sin datos aún'})`}`);
    if (!sinEstacion) t.forEach(x => L.push(x));
  }
  L.push('');

  // --- Sesgos ---
  L.push(SEP, `SESGOS IMPORTANTES (últimos 30 días, al menos ${MIN_DIAS_SESGO} días, sesgo de ${SESGO_IMPORTANTE_C} °C o más; pronóstico de hoy)`, SEP);
  const sesgos = [];
  for (const est of ESTACIONES) for (const f of FUENTES) {
    const e = estadisticas(porFuente(enVentana(validas.filter(r => r.estacion === est.id), hasta, 30), f, 0));
    for (const [v, nombre] of [['tmax', 'las máximas'], ['tmin', 'las mínimas']]) {
      if (e[v].n >= MIN_DIAS_SESGO && Math.abs(e[v].sesgo) >= SESGO_IMPORTANTE_C) sesgos.push({ t: Math.abs(e[v].sesgo), txt: `${FUENTE_NOMBRE[f]} pronostica ${f1(Math.abs(e[v].sesgo))} °C de ${e[v].sesgo > 0 ? 'más' : 'menos'} en ${nombre} de ${est.municipio} (${est.id}${est.calidad !== 'directa' ? ', ' + CALIDAD_TXT[est.calidad] : ''}; n=${e[v].n} días)` });
    }
  }
  sesgos.sort((a, b) => b.t - a.t);
  if (sesgos.length) sesgos.slice(0, 15).forEach(s => L.push(`- ${s.txt}`)); else L.push('Todavía no hay sesgos que cumplan el criterio (se necesitan al menos 7 días verificados).');
  L.push('');

  // --- Aciertos del mes ---
  const mesRef = Number((ult || hasta).slice(5, 7)), anioRef = (ult || hasta).slice(0, 4);
  const inicioMes = `${anioRef}-${String(mesRef).padStart(2, '0')}-01`;
  L.push(SEP, `PORCENTAJE DE ACIERTOS DE ${MESES[mesRef - 1].toUpperCase()} (pronóstico de hoy; máximas y mínimas dentro de ±${UMBRAL_ACIERTO_C} °C)`, SEP);
  const mes = validas.filter(r => r.fecha_objetivo >= inicioMes && r.calidad !== 'aproximacion_lejana' && r.dias_adelante === 0);
  const aciertos = FUENTES.map(f => ({ f, e: estadisticas(mes.filter(r => r.fuente === f)) })).filter(x => x.e.tmax.n >= 3);
  if (!aciertos.length) L.push('Todavía no hay suficientes días del mes verificados.');
  else {
    aciertos.sort((a, b) => b.e.tmax.acierto / b.e.tmax.n - a.e.tmax.acierto / a.e.tmax.n);
    aciertos.forEach(x => L.push(`- ${FUENTE_NOMBRE[x.f]}: máximas ${pct(x.e.tmax.acierto, x.e.tmax.n)} (n=${x.e.tmax.n}), mínimas ${pct(x.e.tmin.acierto, x.e.tmin.n)} (n=${x.e.tmin.n}), lluvia sí/no ${pct(x.e.lluvia.aciertos, x.e.lluvia.n)} (n=${x.e.lluvia.n})`));
    const m = aciertos[0];
    L.push(`Frase para publicar (verifica el contexto): "En ${MESES[mesRef - 1]}, ${FUENTE_NOMBRE[m.f]} acertó el ${pct(m.e.tmax.acierto, m.e.tmax.n)} de las máximas (±${UMBRAL_ACIERTO_C} °C) en las estaciones de referencia (n=${m.e.tmax.n} comparaciones)".`);
    L.push('Las estaciones de Arizona son una aproximación para Nogales y Agua Prieta; la lluvia sí/no usa 1 mm o más (Arizona) o evento de lluvia en el METAR (Sonora).');
  }
  L.push('');

  // --- San Luis Río Colorado (aparte) ---
  L.push(SEP, 'SAN LUIS RÍO COLORADO — APROXIMACIÓN LEJANA (estación de Yuma, ~26 km; se reporta por separado)', SEP);
  const slrc = validas.filter(r => r.calidad === 'aproximacion_lejana' && r.dias_adelante === 0);
  const filasS = FUENTES.map(f => ({ f, e: estadisticas(enVentana(slrc, hasta, 30).filter(r => r.fuente === f)) })).filter(x => x.e.tmax.n >= 1);
  if (!filasS.length) L.push('Sin datos verificados todavía.'); else filasS.forEach(x => L.push(`- ${FUENTE_NOMBRE[x.f]} (30 d, n=${x.e.tmax.n}): máx sesgo ${f1(x.e.tmax.sesgo, true)} error ${f1(x.e.tmax.mae)} · mín sesgo ${f1(x.e.tmin.sesgo, true)} error ${f1(x.e.tmin.mae)} °C`));
  L.push('');

  // --- Lluvia ---
  L.push(SEP, 'LLUVIA', SEP);
  L.push('Sonora (METAR): solo "llovió sí/no". Arizona: milímetros. NASA POWER: estimación por satélite (celdas de ~50 km, llega con ~3 días de retraso).');
  const llu = FUENTES.map(f => ({ f, e: estadisticas(enVentana(validas.filter(r => r.calidad !== 'aproximacion_lejana'), hasta, 30).filter(r => r.fuente === f && r.dias_adelante === 0)) })).filter(x => x.e.lluvia.n >= 3);
  llu.forEach(x => L.push(`- ${FUENTE_NOMBRE[x.f]} (30 d): acierto sí/no ${pct(x.e.lluvia.aciertos, x.e.lluvia.n)} (n=${x.e.lluvia.n})${x.e.lluvia.nMm >= 3 ? `; Arizona en mm: error medio ${f1(x.e.lluvia.maeMm)} mm, sesgo ${f1(x.e.lluvia.sesgoMm, true)} mm (n=${x.e.lluvia.nMm})` : ''}`));
  if (!llu.length) L.push('Todavía no hay suficientes días.');
  try {
    const sat = await consultar(`SELECT s.fecha, s.municipio, s.mm AS satelite, p.fuente, p.lluvia_mm AS pron FROM lluvia_satelite s JOIN pronosticos p ON p.fecha_objetivo = s.fecha AND p.municipio = s.municipio WHERE p.origen = 'cron' AND p.dias_adelante = 0 AND s.fecha >= $1`, [sumaDias(hoy, -62)]);
    const g = {};
    sat.forEach(r => { (g[r.fuente] ||= []).push({ e: Number(r.pron) - Number(r.satelite), acierto: (Number(r.pron) >= UMBRAL_LLUVIA_MM) === (Number(r.satelite) >= UMBRAL_LLUVIA_MM) }); });
    const lin = Object.entries(g).filter(([, v]) => v.length >= 5).map(([f, v]) => `${FUENTE_NOMBRE[f]}: error medio ${f1(mean(v.map(x => Math.abs(x.e))))} mm, acierto sí/no ${pct(v.filter(x => x.acierto).length, v.length)} (n=${v.length})`);
    L.push(lin.length ? `- Contra NASA POWER (aparte, solo días con dato satelital): ${lin.join(' · ')}` : '- Contra NASA POWER: todavía no hay suficientes días con dato satelital.');
  } catch (_) { /* sin satélite */ }
  L.push('');

  // --- Rachas ---
  L.push(SEP, 'RACHAS MÁXIMAS (km/h; solo estaciones que las reportan: Arizona y, a veces, los METAR de Sonora)', SEP);
  const rach = FUENTES.map(f => ({ f, e: estadisticas(enVentana(validas.filter(r => r.calidad !== 'aproximacion_lejana'), hasta, 30).filter(r => r.fuente === f && r.dias_adelante === 0)) })).filter(x => x.e.racha.n >= 3);
  if (rach.length) rach.forEach(x => L.push(`- ${FUENTE_NOMBRE[x.f]} (30 d, n=${x.e.racha.n}): sesgo ${f1(x.e.racha.sesgo, true)} km/h, error medio ${f1(x.e.racha.mae)} km/h`)); else L.push('Todavía no hay suficientes días con racha observada.');
  L.push('');

  // --- Histórico de corto plazo ---
  L.push(SEP, 'HISTÓRICO DE CORTO PLAZO (carga inicial de Open-Meteo; NO se mezcla con lo anterior)', SEP);
  L.push('Son pronósticos reconstruidos con las primeras horas de cada corrida (0 días de adelanto), no lo que se guardó a las 05:30 h. Sirven para conocer sesgos de los modelos en las estaciones.');
  try {
    const hist = await cargarComparaciones('historico_corto_plazo', sumaDias(hoy, -95));
    const hv = conCobertura(hist).filter(r => r.calidad !== 'aproximacion_lejana');
    const lh = ['icon', 'gfs', 'ecmwf', 'best_match'].map(f => ({ f, e: estadisticas(hv.filter(r => r.fuente === f)) })).filter(x => x.e.tmax.n >= 5);
    if (!lh.length) L.push('Todavía no se ha cargado el histórico (se ejecuta una sola vez).');
    else lh.forEach(x => L.push(`- ${FUENTE_NOMBRE[x.f]}: máximas sesgo ${f1(x.e.tmax.sesgo, true)} °C, error ${f1(x.e.tmax.mae)}, acierto ±2 °C ${pct(x.e.tmax.acierto, x.e.tmax.n)} (n=${x.e.tmax.n}) · mínimas sesgo ${f1(x.e.tmin.sesgo, true)}, error ${f1(x.e.tmin.mae)}, acierto ${pct(x.e.tmin.acierto, x.e.tmin.n)}`));
  } catch (err) { L.push(`[No disponible: ${err.message}]`); }
  L.push('');

  // --- Cobertura ---
  L.push(SEP, 'DÍAS EXCLUIDOS POR BAJA COBERTURA (últimos 30 días)', SEP);
  const desde30 = sumaDias(hasta, -29);
  const obs = await consultar('SELECT estacion, COUNT(*) AS dias, SUM(CASE WHEN cobertura_ok = 1 THEN 1 ELSE 0 END) AS buenos, AVG(horas_reportadas) AS horas FROM observaciones WHERE fecha >= $1 GROUP BY estacion', [desde30]);
  ESTACIONES.forEach(e => { const r = obs.find(x => x.estacion === e.id); L.push(r ? `- ${e.id} ${e.municipio}: ${Number(r.buenos)} de ${Number(r.dias)} días con cobertura suficiente (promedio ${Number(r.horas).toFixed(1)} h reportadas por día)${Number(r.buenos) < Number(r.dias) / 2 ? ' — casi siempre excluida' : ''}` : `- ${e.id} ${e.municipio}: sin observaciones`); });
  L.push('', 'Nota: no se aplica ninguna corrección automática al pronóstico; esto es solo medición (fase 1).');
  return L.join('\n');
}
