import { MUNICIPIOS } from './_municipios.js';
import { consultar, asegurarEsquema, insertarFilas, hayBaseDeDatos, iniciarEjecucion } from './_db.js';
import { fechaSonora } from './_verif-pron.js';

// Horas frío por municipio para la temporada de reposo (1 de noviembre al último día de febrero), con dos métodos:
//  - Clásico: horas con temperatura de 0 a 7.2 °C.
//  - Modelo Utah (unidades frío): tabla estándar por hora; el acumulado de la temporada nunca baja de 0.
// El acumulado diario se guarda en la tabla horas_frio (Neon) para no recalcular toda la temporada en cada consulta.
// Datos: temperatura horaria de Open-Meteo (API de archivo para días pasados; si falla, la API de pronóstico con fechas pasadas).

const TZ = 'America/Hermosillo';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MIN_HORAS_VALIDAS = 18;   // un día con menos horas con dato no se guarda (evita acumulados falsos)
const DIAS_POR_PEDIDO = 31;
export const COLUMNAS_HF = ['fecha', 'municipio', 'temporada', 'horas_dia', 'utah_dia', 'horas_acum', 'utah_acum', 'horas_validas', 'fuente', 'guardado_en'];

// ---------- fechas y temporada ----------
const aMs = f => Date.parse(f + 'T12:00:00Z');
export const sumaDias = (f, n) => new Date(aMs(f) + n * 86400000).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((aMs(b) - aMs(a)) / 86400000);
const bisiesto = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const ultimoFebrero = y => `${y}-02-${bisiesto(y) ? 29 : 28}`;
export const etiquetaTemporada = y => `${y}-${String(y + 1).slice(2)}`;

/** Año en que empieza la temporada a la que pertenece la fecha (null si está fuera de nov-feb). */
export function anioTemporada(fecha) {
  const y = Number(fecha.slice(0, 4)), m = Number(fecha.slice(5, 7));
  if (m >= 11) return y;
  if (m <= 2) return y - 1;
  return null;
}
export const inicioTemporada = y => `${y}-11-01`;
export const finTemporada = y => ultimoFebrero(y + 1);
/** Misma fecha un año antes (el 29 de febrero pasa al 28). */
export function mismaFechaAnioAnterior(fecha) {
  const y = Number(fecha.slice(0, 4)) - 1;
  return fecha.slice(5) === '02-29' ? `${y}-02-28` : `${y}-${fecha.slice(5)}`;
}

/**
 * Temporada de referencia y fecha de corte. Dentro de nov-feb: la temporada en curso con corte AYER (el día completo más reciente).
 * Fuera de temporada (marzo a octubre): la última temporada terminada, con corte en su último día ("cerrada").
 */
export function referencia(hoy = fechaSonora()) {
  const ayer = sumaDias(hoy, -1);
  const y = anioTemporada(ayer);
  if (y !== null) return { anio: y, temporada: etiquetaTemporada(y), corte: ayer, abierta: true };
  const ym = Number(ayer.slice(0, 4));
  const yy = ym - 1; // marzo-octubre: la temporada que empezó el noviembre anterior y terminó en febrero
  return { anio: yy, temporada: etiquetaTemporada(yy), corte: finTemporada(yy), abierta: false };
}
export function referenciaAnterior(ref) {
  const anio = ref.anio - 1;
  return { anio, temporada: etiquetaTemporada(anio), corte: mismaFechaAnioAnterior(ref.corte) };
}

// ---------- cálculo ----------
const r1 = t => Math.round(t * 10) / 10;
export const esHoraFrioClasica = t => { const x = r1(t); return x >= 0 && x <= 7.2; };

/** Unidades frío Utah de una hora (tabla estándar). */
export function unidadUtah(t) {
  const x = r1(t);
  if (x <= 1.4) return 0;
  if (x <= 2.4) return 0.5;
  if (x <= 9.1) return 1;
  if (x <= 12.4) return 0.5;
  if (x <= 15.9) return 0;
  if (x <= 18) return -0.5;
  return -1;
}

/**
 * Calcula los días de un municipio. dias: [{ fecha, temps: [24 valores] }] consecutivos; inicio: { horas, utah } acumulados
 * al terminar el día anterior. El acumulado Utah se actualiza hora por hora y nunca baja de 0; utah_dia es lo que cambió
 * el acumulado ese día (después de aplicar ese piso), así acumulado de hoy = acumulado de ayer + utah_dia.
 */
export function calcularDias(dias, inicio = { horas: 0, utah: 0 }) {
  let horas = inicio.horas || 0, utah = inicio.utah || 0;
  return dias.map(d => {
    const utahAntes = utah;
    let horasDia = 0, validas = 0;
    for (const t of d.temps) {
      if (!Number.isFinite(t)) continue;
      validas++;
      if (esHoraFrioClasica(t)) horasDia++;
      utah = Math.max(0, utah + unidadUtah(t));
    }
    horas += horasDia;
    return { fecha: d.fecha, horas_dia: horasDia, utah_dia: utah - utahAntes, horas_acum: horas, utah_acum: utah, horas_validas: validas };
  });
}

/** Detalle hora por hora de un día (para mostrar cómo se sumó). */
export function detalleDia(temps, utahInicial = 0) {
  let utah = utahInicial, clasicas = 0;
  const horas = temps.map((t, h) => {
    const frio = Number.isFinite(t) && esHoraFrioClasica(t);
    const u = Number.isFinite(t) ? unidadUtah(t) : 0;
    if (frio) clasicas++;
    utah = Math.max(0, utah + u);
    return { hora: h, t, frio, unidad: u, utahAcum: utah };
  });
  return { horas, clasicas, utahFinal: utah, utahDia: utah - utahInicial };
}

// ---------- descarga de temperaturas horarias ----------
const coords = () => `latitude=${MUNICIPIOS.map(m => m.lat).join(',')}&longitude=${MUNICIPIOS.map(m => m.lon).join(',')}`;
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function pedirHoras(base, desde, hasta) {
  const url = `${base}?${coords()}&start_date=${desde}&end_date=${hasta}&hourly=temperature_2m&timezone=${TZ}`;
  let ultimo;
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) { const e = new Error(res.status === 429 ? 'HTTP 429 (límite de peticiones)' : `HTTP ${res.status}`); throw e; }
      const j = await res.json();
      const list = Array.isArray(j) ? j : [j];
      if (j && j.error) throw new Error(j.reason || 'Open-Meteo devolvió un error');
      if (list.length !== MUNICIPIOS.length || !list.every(l => Array.isArray(l?.hourly?.time) && Array.isArray(l.hourly.temperature_2m))) throw new Error('respuesta incompleta de Open-Meteo');
      return list;
    } catch (err) {
      ultimo = err.name === 'AbortError' ? new Error('tiempo de espera agotado') : err;
      if (i < 2) await esperar(i === 0 ? 3000 : 8000);
    } finally { clearTimeout(timer); }
  }
  throw ultimo;
}

/** Devuelve { porMunicipio: [Map fecha -> temps[24]] } con la temperatura de cada hora (null si no hay dato). */
function ordenarPorDia(list) {
  return list.map(l => {
    const mapa = new Map();
    l.hourly.time.forEach((t, i) => {
      const f = String(t).slice(0, 10), h = Number(String(t).slice(11, 13));
      if (!mapa.has(f)) mapa.set(f, new Array(24).fill(null));
      const v = l.hourly.temperature_2m[i];
      mapa.get(f)[h] = Number.isFinite(v) ? v : null;
    });
    return mapa;
  });
}
const validas = temps => (temps || []).filter(Number.isFinite).length;

/**
 * Temperaturas horarias de todos los municipios de `desde` a `hasta`: archivo primero; para cualquier municipio/día
 * sin datos suficientes (o si el archivo falla) se usa la API de pronóstico con fechas pasadas como respaldo.
 * Devuelve { datos: [Map fecha -> { temps, fuente }], errores: [] }.
 */
export async function temperaturasHorarias(desde, hasta) {
  const datos = MUNICIPIOS.map(() => new Map());
  const errores = [];
  for (let ini = desde; ini <= hasta; ini = sumaDias(ini, DIAS_POR_PEDIDO)) {
    const fin = sumaDias(ini, DIAS_POR_PEDIDO - 1) < hasta ? sumaDias(ini, DIAS_POR_PEDIDO - 1) : hasta;
    let origen = null;
    try { origen = ordenarPorDia(await pedirHoras(ARCHIVE, ini, fin)); } catch (err) { errores.push(`archivo ${ini}..${fin}: ${err.message}`); }
    const dias = []; for (let f = ini; f <= fin; f = sumaDias(f, 1)) dias.push(f);
    let faltan = !origen || dias.some(f => origen.some(m => validas(m.get(f)) < MIN_HORAS_VALIDAS));
    let respaldo = null;
    if (faltan) {
      try { respaldo = ordenarPorDia(await pedirHoras(FORECAST, ini, fin)); } catch (err) { errores.push(`respaldo (pronóstico con fechas pasadas) ${ini}..${fin}: ${err.message}`); }
    }
    MUNICIPIOS.forEach((_, i) => {
      for (const f of dias) {
        const a = origen && origen[i].get(f), b = respaldo && respaldo[i].get(f);
        if (validas(a) >= MIN_HORAS_VALIDAS) datos[i].set(f, { temps: a, fuente: 'archive' });
        else if (validas(b) >= MIN_HORAS_VALIDAS) datos[i].set(f, { temps: b, fuente: 'forecast' });
      }
    });
  }
  return { datos, errores };
}

// ---------- guardado en Neon ----------
const num = v => (v === null || v === undefined ? null : Number(v));

/** Completa (y recalcula desde el primer día que falta) la temporada hasta la fecha de corte. */
export async function completarTemporada(anio, corte) {
  const inicio = inicioTemporada(anio);
  const out = { temporada: etiquetaTemporada(anio), corte, diasNuevos: 0, desde: null, errores: [] };
  if (corte < inicio) return out;
  const existentes = await consultar('SELECT fecha, COUNT(*) AS n FROM horas_frio WHERE temporada = $1 GROUP BY fecha', [etiquetaTemporada(anio)]);
  const completos = new Set(existentes.filter(r => Number(r.n) >= MUNICIPIOS.length).map(r => r.fecha));
  let primero = null;
  for (let f = inicio; f <= corte; f = sumaDias(f, 1)) { if (!completos.has(f)) { primero = f; break; } }
  if (!primero) return out;
  out.desde = primero;
  // Acumulados al terminar el día anterior al primero que falta.
  const previo = {};
  if (primero > inicio) {
    const filas = await consultar('SELECT municipio, horas_acum, utah_acum FROM horas_frio WHERE fecha = $1', [sumaDias(primero, -1)]);
    filas.forEach(r => { previo[r.municipio] = { horas: num(r.horas_acum), utah: num(r.utah_acum) }; });
    if (filas.length < MUNICIPIOS.length) throw new Error(`falta el día ${sumaDias(primero, -1)} para continuar los acumulados`);
  }
  const { datos, errores } = await temperaturasHorarias(primero, corte);
  out.errores.push(...errores);
  // Solo se guardan días completos y consecutivos: si a un municipio le falta un día, se detiene ahí (sin dejar huecos ni acumulados falsos).
  const guardado = new Date().toISOString();
  const filas = [];
  let ultimoCompleto = null;
  const acum = MUNICIPIOS.map(m => ({ ...(previo[m.municipio] || { horas: 0, utah: 0 }) }));
  for (let f = primero; f <= corte; f = sumaDias(f, 1)) {
    const faltantes = MUNICIPIOS.filter((_, i) => !datos[i].has(f)).map(m => m.municipio);
    if (faltantes.length) { out.errores.push(`día ${f}: sin temperaturas suficientes para ${faltantes.length} municipio(s) (${faltantes.slice(0, 5).join(', ')}${faltantes.length > 5 ? '…' : ''}); se detiene aquí`); break; }
    MUNICIPIOS.forEach((m, i) => {
      const { temps, fuente } = datos[i].get(f);
      const [r] = calcularDias([{ fecha: f, temps }], acum[i]);
      acum[i] = { horas: r.horas_acum, utah: r.utah_acum };
      filas.push([f, m.municipio, etiquetaTemporada(anio), r.horas_dia, r.utah_dia, r.horas_acum, r.utah_acum, r.horas_validas, fuente, guardado]);
    });
    ultimoCompleto = f;
    out.diasNuevos++;
  }
  if (filas.length) await insertarFilas('horas_frio', COLUMNAS_HF, filas, ['fecha', 'municipio'], 'reemplazar');
  out.hasta = ultimoCompleto;
  return out;
}

let enCurso = null;
/** Deja al día la temporada vigente (hasta ayer) y la anterior (hasta la misma fecha). Varias llamadas simultáneas comparten el trabajo. */
export function asegurarHorasFrio(hoy = fechaSonora()) {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const res = { temporadas: [], errores: [] };
    try {
      if (!hayBaseDeDatos()) throw new Error('No hay base de datos configurada (falta DATABASE_URL).');
      await asegurarEsquema();
      const ref = referencia(hoy), ant = referenciaAnterior(ref);
      const partes = await Promise.allSettled([completarTemporada(ref.anio, ref.corte), completarTemporada(ant.anio, ant.corte)]);
      partes.forEach((p, i) => {
        if (p.status === 'fulfilled') { res.temporadas.push(p.value); res.errores.push(...p.value.errores); }
        else res.errores.push(`temporada ${i === 0 ? ref.temporada : ant.temporada}: ${p.reason && p.reason.message ? p.reason.message : p.reason}`);
      });
    } catch (err) { res.errores.push(err && err.message ? err.message : String(err)); }
    return res;
  })().finally(() => { enCurso = null; });
  return enCurso;
}

/** Tarea diaria (cron): guarda el día anterior (y completa lo que falte) para las dos temporadas. */
export async function tareaHorasFrio({ disparo = 'manual' } = {}) {
  const cerrar = await iniciarEjecucion('horas-frio');
  const res = { tarea: 'horas-frio', fecha: fechaSonora(), disparo, errores: [] };
  try {
    const r = await asegurarHorasFrio();
    res.temporadas = r.temporadas; res.errores = r.errores;
    res.estado = r.errores.length ? (r.temporadas.length ? 'parcial' : 'error') : 'ok';
  } catch (err) { res.errores.push(err && err.message ? err.message : String(err)); res.estado = 'error'; }
  await cerrar(res.estado, JSON.stringify(res));
  return res;
}

// ---------- lectura para la página y el resumen ----------
const redondea = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export async function estadoHorasFrio(hoy = fechaSonora()) {
  const ref = referencia(hoy), ant = referenciaAnterior(ref);
  const leer = fecha => consultar('SELECT municipio, horas_dia, utah_dia, horas_acum, utah_acum, horas_validas, fuente FROM horas_frio WHERE fecha = $1', [fecha]);
  let actual = await leer(ref.corte);
  let corte = ref.corte, aviso = null;
  if (actual.length < MUNICIPIOS.length) {
    // La base todavía no llega al día de corte: se muestra el último día completo que haya.
    const u = await consultar('SELECT fecha, COUNT(*) AS n FROM horas_frio WHERE temporada = $1 GROUP BY fecha ORDER BY fecha DESC', [ref.temporada]);
    const d = u.find(r => Number(r.n) >= MUNICIPIOS.length);
    if (!d) throw new Error(`Todavía no hay horas frío guardadas para la temporada ${ref.temporada}.`);
    corte = d.fecha; actual = await leer(corte);
    aviso = `Los datos llegan hasta el ${corte}; no se pudo completar hasta el ${ref.corte}.`;
  }
  const corteAnt = corte === ref.corte ? ant.corte : mismaFechaAnioAnterior(corte);
  const previo = await leer(corteAnt);
  const semana = await consultar('SELECT municipio, SUM(horas_dia) AS h, SUM(utah_dia) AS u FROM horas_frio WHERE fecha >= $1 AND fecha <= $2 GROUP BY municipio', [sumaDias(corte, -6), corte]);
  const porMun = filas => new Map(filas.map(r => [r.municipio, r]));
  const A = porMun(actual), P = porMun(previo), S = porMun(semana);
  const filas = MUNICIPIOS.map(m => {
    const a = A.get(m.municipio), p = P.get(m.municipio), s = S.get(m.municipio);
    const horas = num(a.horas_acum), utah = num(a.utah_acum), horasAnt = p ? num(p.horas_acum) : null, utahAnt = p ? num(p.utah_acum) : null;
    return {
      municipio: m.municipio, cabecera: m.cabecera, horas, utah, ayer: num(a.horas_dia), utahAyer: num(a.utah_dia), semana: s ? num(s.h) : null, utahSemana: s ? redondea(num(s.u)) : null,
      horasAnt, utahAnt,
      difH: horasAnt === null ? null : horas - horasAnt, difPct: horasAnt ? redondea(((horas - horasAnt) / horasAnt) * 100) : null,
      difUtah: utahAnt === null ? null : redondea(utah - utahAnt), difUtahPct: utahAnt ? redondea(((utah - utahAnt) / utahAnt) * 100) : null,
      validas: num(a.horas_validas), fuente: a.fuente
    };
  }).sort((a, b) => b.horas - a.horas || b.utah - a.utah || a.municipio.localeCompare(b.municipio, 'es'));
  const prom = campo => { const v = filas.map(f => f[campo]).filter(Number.isFinite); return v.length ? redondea(v.reduce((x, y) => x + y, 0) / v.length) : null; };
  const promedio = { horas: prom('horas'), utah: prom('utah'), horasAnt: prom('horasAnt'), utahAnt: prom('utahAnt'), ayer: prom('ayer'), semana: prom('semana') };
  promedio.difH = promedio.horasAnt === null ? null : redondea(promedio.horas - promedio.horasAnt);
  promedio.difPct = promedio.horasAnt ? redondea(((promedio.horas - promedio.horasAnt) / promedio.horasAnt) * 100) : null;
  promedio.difUtah = promedio.utahAnt === null ? null : redondea(promedio.utah - promedio.utahAnt);
  promedio.difUtahPct = promedio.utahAnt ? redondea(((promedio.utah - promedio.utahAnt) / promedio.utahAnt) * 100) : null;
  return {
    temporada: ref.temporada, abierta: ref.abierta, inicio: inicioTemporada(ref.anio), fin: finTemporada(ref.anio), corte, diasTemporada: diasEntre(inicioTemporada(ref.anio), corte) + 1,
    temporadaAnterior: ant.temporada, corteAnterior: corteAnt, aviso, filas, promedio,
    sinComparacion: filas.filter(f => f.horasAnt === null).length
  };
}
