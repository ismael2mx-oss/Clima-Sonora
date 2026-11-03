// Base de datos de la verificación de pronósticos: Postgres en Neon (instalado desde el Marketplace de Vercel, que agrega
// la variable DATABASE_URL). Todas las fechas se guardan como texto ("2026-11-01") para evitar ambigüedades de zona horaria.

let sqlInyectado = null;    // para las pruebas locales (SQLite en memoria)
let esquemaListo = false;

export function _usarSql(fn) { sqlInyectado = fn; esquemaListo = false; }

const urlConexion = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || null;
export const hayBaseDeDatos = () => Boolean(sqlInyectado || urlConexion());

/** Ejecuta una consulta con parámetros ($1, $2, …) y devuelve un arreglo de filas (objetos). */
export async function consultar(texto, params = []) {
  if (sqlInyectado) return sqlInyectado(texto, params);
  const url = urlConexion();
  if (!url) throw new Error('No hay base de datos configurada (falta DATABASE_URL; instala Neon desde el Marketplace de Vercel).');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  return sql.query(texto, params);
}

const ESQUEMA = [
  // Lo que pronosticamos: una fila por emisión, fecha objetivo, municipio y fuente (icon, gfs, ecmwf, best_match, smn).
  // origen = 'cron' (guardado a las 05:30 h) o 'historico_corto_plazo' (carga histórica de Open-Meteo, no se mezcla con lo anterior).
  `CREATE TABLE IF NOT EXISTS pronosticos (
    fecha_emision TEXT NOT NULL, fecha_objetivo TEXT NOT NULL, dias_adelante INTEGER NOT NULL,
    municipio TEXT NOT NULL, fuente TEXT NOT NULL, origen TEXT NOT NULL,
    tmax DOUBLE PRECISION, tmin DOUBLE PRECISION, lluvia_mm DOUBLE PRECISION, prob_lluvia DOUBLE PRECISION, racha_kmh DOUBLE PRECISION,
    corrida TEXT, guardado_en TEXT NOT NULL,
    PRIMARY KEY (fecha_emision, fecha_objetivo, municipio, fuente, origen))`,
  'CREATE INDEX IF NOT EXISTS idx_pron_objetivo ON pronosticos (fecha_objetivo, municipio)',
  // Lo que realmente pasó, por estación y día (00-24 h hora de Sonora).
  `CREATE TABLE IF NOT EXISTS observaciones (
    fecha TEXT NOT NULL, estacion TEXT NOT NULL, municipio TEXT NOT NULL, calidad TEXT NOT NULL,
    tmax DOUBLE PRECISION, tmin DOUBLE PRECISION, lluvia_mm DOUBLE PRECISION, lluvia_evento INTEGER, racha_kmh DOUBLE PRECISION,
    horas_reportadas INTEGER NOT NULL, cobertura_ok INTEGER NOT NULL, n_reportes INTEGER, fuente TEXT, guardado_en TEXT NOT NULL,
    PRIMARY KEY (fecha, estacion))`,
  // Estimación de lluvia por satélite (NASA POWER, con unos 3 días de retraso).
  `CREATE TABLE IF NOT EXISTS lluvia_satelite (
    fecha TEXT NOT NULL, municipio TEXT NOT NULL, mm DOUBLE PRECISION, fuente TEXT NOT NULL, guardado_en TEXT NOT NULL,
    PRIMARY KEY (fecha, municipio))`,
  // Bitácora de las tareas automáticas, para comprobar que se están ejecutando.
  `CREATE TABLE IF NOT EXISTS ejecuciones (
    tarea TEXT NOT NULL, inicio TEXT NOT NULL, fin TEXT, estado TEXT NOT NULL, detalle TEXT,
    PRIMARY KEY (tarea, inicio))`
];

export async function asegurarEsquema() {
  if (esquemaListo) return;
  for (const q of ESQUEMA) await consultar(q);
  esquemaListo = true;
}

/**
 * Inserta filas en lotes. columnas: nombres; filas: arreglos de valores. conflicto: lista de columnas de la llave primaria.
 * modo 'ignorar' deja intacta la fila existente (la primera que se guardó gana); 'reemplazar' la actualiza.
 */
export async function insertarFilas(tabla, columnas, filas, conflicto, modo = 'ignorar', lote = 400) {
  let n = 0;
  for (let i = 0; i < filas.length; i += lote) {
    const parte = filas.slice(i, i + lote);
    const params = [];
    const grupos = parte.map(f => `(${f.map(v => { params.push(v === undefined ? null : v); return `$${params.length}`; }).join(', ')})`);
    const accion = modo === 'reemplazar'
      ? `DO UPDATE SET ${columnas.filter(c => !conflicto.includes(c)).map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
      : 'DO NOTHING';
    await consultar(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES ${grupos.join(', ')} ON CONFLICT (${conflicto.join(', ')}) ${accion}`, params);
    n += parte.length;
  }
  return n;
}

/** Registra el inicio de una tarea automática y devuelve una función para cerrarla con su resultado. */
export async function iniciarEjecucion(tarea) {
  const inicio = new Date().toISOString();
  let registrada = false;
  try {
    await asegurarEsquema();
    await consultar('INSERT INTO ejecuciones (tarea, inicio, estado) VALUES ($1, $2, $3)', [tarea, inicio, 'en curso']);
    registrada = true;
  } catch (_) { /* si la base falla, la tarea lo dirá en su respuesta */ }
  return async (estado, detalle) => {
    if (!registrada) return;
    try { await consultar('UPDATE ejecuciones SET fin = $1, estado = $2, detalle = $3 WHERE tarea = $4 AND inicio = $5', [new Date().toISOString(), estado, String(detalle || '').slice(0, 1500), tarea, inicio]); } catch (_) { /* nada */ }
  };
}
