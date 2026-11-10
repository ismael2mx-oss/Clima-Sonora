import { MUNICIPIOS } from './_municipios.js';
import { loadLluviaDiaria } from './_lluvia.js';
import { loadOpenMeteoPronostico } from './_openmeteo.js';
import { consultar, hayBaseDeDatos, asegurarEsquema } from './_db.js';
import { fechaSonora } from './_verif-pron.js';

// Las tres listas de lluvia por municipio (página municipios-lluvia.html y /api/resumen-lluvia):
//  - "dia":    pronóstico FIJO del día completo (00-24 h, hora de Sonora). Sale de lo guardado en Neon a las 05:30 h (fuente best_match);
//              si todavía no hay guardado de hoy, se calcula en ese momento, se guarda y desde ahí no cambia.
//  - "horas":  EN VIVO, de la hora actual a las 23:59 h, calculado al momento con las horas que faltan del día.
//  - "semana": hoy + 4 días, con el mismo cálculo (loadLluviaDiaria) que la sección de lluvia de ciclones.html.

const TZ = 'America/Hermosillo';
const MIN_FILAS = Math.ceil(MUNICIPIOS.length * 0.9);
const fmtHora = new Intl.DateTimeFormat('es-MX', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const horaTexto = ms => fmtHora.format(new Date(ms)).replace(/^24/, '00') + ' h';
const horaNumero = ms => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms)));
const redondeaMm = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const finito = v => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)));

/** Mayor % primero y, en empate, más mm; después por nombre. Lo que no tiene dato va al final. */
export function ordenarLluvia(filas) {
  return [...filas].sort((a, b) => (finito(b.p) ? Number(b.p) : -1) - (finito(a.p) ? Number(a.p) : -1) || (b.mm || 0) - (a.mm || 0) || a.municipio.localeCompare(b.municipio, 'es'));
}

const cabeceraDe = new Map(MUNICIPIOS.map(m => [m.municipio, m.cabecera]));
const filaLluvia = (municipio, p, mm) => ({ municipio, cabecera: cabeceraDe.get(municipio) || municipio, p: finito(p) ? Math.round(Number(p)) : null, mm: finito(mm) ? redondeaMm(Number(mm)) : null });

// ---------- Pronóstico del día (fijo) ----------
async function leerGuardado(hoy) {
  return consultar(
    "SELECT municipio, prob_lluvia, lluvia_mm, guardado_en FROM pronosticos WHERE origen = 'cron' AND fuente = 'best_match' AND fecha_emision = $1 AND fecha_objetivo = $1",
    [hoy]
  );
}

function resultadoDia(hoy, filas, extra) {
  const emitidoMs = Math.min(...filas.map(f => Date.parse(f.guardado_en)).filter(Number.isFinite));
  return {
    vista: 'dia', fecha: hoy, fijo: true, emitidoMs, emitido: Number.isFinite(emitidoMs) ? new Date(emitidoMs).toISOString() : null,
    emitidoTexto: Number.isFinite(emitidoMs) ? horaTexto(emitidoMs) : null,
    filas: ordenarLluvia(filas.map(f => filaLluvia(f.municipio, f.prob_lluvia, f.lluvia_mm))),
    ...extra
  };
}

export async function listaDelDia(ahoraMs = Date.now()) {
  const hoy = fechaSonora(ahoraMs);
  let motivo = null;
  if (hayBaseDeDatos()) {
    try {
      await asegurarEsquema();
      let filas = await leerGuardado(hoy);
      if (filas.length >= MIN_FILAS) return resultadoDia(hoy, filas, { creadoAhora: false });
      // Todavía no hay pronóstico guardado de hoy: se calcula ahora, se guarda y desde aquí ya no cambia.
      const { tareaPronostico } = await import('./_verif-cron.js');
      const t = await tareaPronostico({ disparo: 'lista de lluvia (primera consulta del día)' });
      filas = await leerGuardado(hoy);
      if (filas.length >= MIN_FILAS) return resultadoDia(hoy, filas, { creadoAhora: true });
      motivo = `no se pudo guardar el pronóstico de hoy (${t.errores && t.errores.length ? t.errores.join('; ') : 'sin filas'})`;
    } catch (err) { motivo = `no se pudo consultar la base de datos (${err && err.message ? err.message : 'error'})`; }
  } else motivo = 'no hay base de datos configurada';
  // Último recurso: se calcula en vivo (puede cambiar entre consultas) y se avisa.
  const l = await loadLluviaDiaria();
  const ahora = Date.now();
  return {
    vista: 'dia', fecha: hoy, fijo: false, emitidoMs: ahora, emitido: new Date(ahora).toISOString(), emitidoTexto: horaTexto(ahora), creadoAhora: false,
    advertencia: `Este pronóstico NO quedó fijo: ${motivo}. Se calculó en este momento y puede cambiar en la próxima consulta.`,
    filas: ordenarLluvia(l.municipios.map(m => filaLluvia(m.municipio, m.prob[0], m.mm[0])))
  };
}

// ---------- Próximas horas (en vivo) ----------
export async function proximasHoras(ahoraMs = Date.now()) {
  const om = await loadOpenMeteoPronostico();
  const hoy = fechaSonora(ahoraMs);
  const h = horaNumero(ahoraMs);
  const tiempos = om.list[0]?.hourly?.time || [];
  const idx = [];
  tiempos.forEach((t, i) => { if (String(t).startsWith(hoy) && Number(String(t).slice(11, 13)) >= h) idx.push(i); });
  if (!idx.length) throw new Error('Open-Meteo no devolvió las horas que faltan de hoy.');
  const filas = MUNICIPIOS.map((m, i) => {
    const hr = om.list[i]?.hourly || {};
    const ps = idx.map(k => (hr.precipitation_probability || [])[k]).filter(finito).map(Number);
    const ms = idx.map(k => (hr.precipitation || [])[k]).filter(finito).map(Number);
    return filaLluvia(m.municipio, ps.length ? Math.max(...ps) : null, ms.length ? ms.reduce((a, b) => a + b, 0) : null);
  });
  return {
    vista: 'horas', fecha: hoy, fijo: false, calculadoMs: ahoraMs, calculado: new Date(ahoraMs).toISOString(), calculadoTexto: horaTexto(ahoraMs),
    desdeHora: h, desdeTexto: `${String(h).padStart(2, '0')}:00 h`, horas: idx.length,
    datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo,
    filas: ordenarLluvia(filas)
  };
}

// ---------- Lluvia 5 días (el mismo cálculo que ciclones.html) ----------
export async function lluviaCincoDias() {
  const l = await loadLluviaDiaria();
  return {
    vista: 'semana', dias: l.dias, datosDe: l.datosDe, desdeCache: l.desdeCache, motivo: l.motivo,
    municipios: l.municipios.map(m => ({ municipio: m.municipio, cabecera: m.cabecera, prob: m.prob, mm: m.mm }))  // mm sin redondear: el orden por mm en empates es idéntico al de ciclones.html
  };
}

export const VISTAS = { dia: listaDelDia, horas: proximasHoras, semana: lluviaCincoDias };
