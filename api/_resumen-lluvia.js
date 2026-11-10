import { listaDelDia, proximasHoras, lluviaCincoDias, ordenarLluvia, horaTexto } from './_lluvia-vistas.js';

// Texto plano de /api/resumen-lluvia: los mismos tres cálculos que usa la página municipios-lluvia.html.
const SITE = 'https://clima-sonora-6fne.vercel.app';
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pct = v => (Number.isFinite(v) ? `${v}%` : 'sin dato');
const mmTxt = v => (Number.isFinite(v) ? `${v.toFixed(1)} mm` : 'sin dato');
const fallo = (que, err) => `[No disponible: no se pudo calcular ${que}. Motivo: ${err && err.message ? err.message : 'error desconocido'}]`;
export const etiquetaDia = (fecha, i) => {
  const d = new Date(fecha + 'T12:00:00Z');
  const base = `${DIAS_CORTO[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
  return i === 0 ? `HOY (${base})` : i === 1 ? `MAÑANA (${base})` : base;
};

function tablaLista(filas) {
  const out = [];
  const conDato = filas.filter(f => Number.isFinite(f.p));
  const alta = conDato.filter(f => f.p >= 70).length;
  out.push(`Resumen: ${conDato.length} municipios con dato; ${alta} con 70% o más; ${conDato.filter(f => f.p >= 50).length} con 50% o más; ${conDato.filter(f => (f.mm || 0) >= 1).length} con 1 mm o más.`);
  out.push('Orden: de mayor a menor porcentaje y, en empate, de mayor a menor milímetros.');
  filas.forEach((f, i) => out.push(`${String(i + 1).padStart(2)}. ${f.municipio}${f.cabecera && f.cabecera !== f.municipio ? ` (cabecera: ${f.cabecera})` : ''}: ${pct(f.p)} · ${mmTxt(f.mm)}`));
  return out;
}

export async function buildResumenLluvia() {
  const ahora = Date.now();
  const [dia, horas, semana] = await Promise.allSettled([listaDelDia(ahora), proximasHoras(ahora), lluviaCincoDias()]);
  const out = [];
  let ok = true;
  out.push('LLUVIA POR MUNICIPIO — SONORA (72 municipios)');
  out.push('='.repeat(50));
  out.push(`Consulta generada a las ${horaTexto(ahora)} (hora de Sonora, UTC-7). Fuente: Open-Meteo (best match). % = probabilidad máxima; mm = milímetros esperados.`);
  out.push('');

  out.push('1) PRONÓSTICO DEL DÍA (lista fija)');
  out.push('-'.repeat(50));
  if (dia.status === 'fulfilled') {
    const d = dia.value;
    out.push(d.fijo
      ? `Pronóstico emitido hoy a las ${d.emitidoTexto}${d.creadoAhora ? ' (primera consulta del día: no había guardado de las 05:30 h, se calculó y se guardó en ese momento)' : ''}. Día completo (00:00 a 24:00 h). Esta lista no cambia durante el día, sin importar la hora en que se consulte.`
      : `Calculado a las ${d.emitidoTexto}. ${d.advertencia}`);
    out.push(...tablaLista(d.filas));
  } else { ok = false; out.push(fallo('el pronóstico del día', dia.reason)); }
  out.push('');

  out.push('2) PRÓXIMAS HORAS (en vivo)');
  out.push('-'.repeat(50));
  if (horas.status === 'fulfilled') {
    const h = horas.value;
    out.push(`Calculado a las ${h.calculadoTexto}; incluye solo las horas que faltan del día (de ${h.desdeTexto} a 23:59 h, ${h.horas} ${h.horas === 1 ? 'hora' : 'horas'}). % = probabilidad máxima en esas horas; mm = suma en esas horas.`);
    if (h.desdeCache) { ok = false; out.push(`[Aviso: Open-Meteo vino de datos guardados ${h.motivo}; datos de las ${horaTexto(Date.parse(h.datosDe))}.]`); }
    out.push(...tablaLista(h.filas));
  } else { ok = false; out.push(fallo('las próximas horas', horas.reason)); }
  out.push('');

  out.push('3) LLUVIA DE LOS PRÓXIMOS 5 DÍAS POR MUNICIPIO');
  out.push('-'.repeat(50));
  if (semana.status === 'fulfilled') {
    const s = semana.value;
    out.push('Cada día es completo (00:00 a 24:00 h) y es el mismo cálculo que usa la sección de lluvia de ciclones.html. El día de hoy aquí se recalcula en cada consulta, por eso puede diferir de la lista fija del bloque 1.');
    if (s.desdeCache) { ok = false; out.push(`[Aviso: Open-Meteo vino de datos guardados ${s.motivo}.]`); }
    out.push('Formato: % / mm por día. Orden: de mayor a menor porcentaje máximo de los 5 días.');
    out.push(`Días: ${s.dias.map(etiquetaDia).join(' | ')}`);
    const filas = s.municipios.map(m => ({ ...m, p: Math.max(-1, ...m.prob.filter(Number.isFinite)), mm5: m.mm.filter(Number.isFinite).reduce((a, b) => a + b, 0) }));
    filas.sort((a, b) => b.p - a.p || b.mm5 - a.mm5 || a.municipio.localeCompare(b.municipio, 'es'));
    for (const m of filas) {
      out.push(`- ${m.municipio}${m.cabecera && m.cabecera !== m.municipio ? ` (cab. ${m.cabecera})` : ''}: ${s.dias.map((_, i) => `${Number.isFinite(m.prob[i]) ? m.prob[i] + '%' : '—'} / ${Number.isFinite(m.mm[i]) ? m.mm[i].toFixed(1) : '—'} mm`).join(' | ')}`);
    }
  } else { ok = false; out.push(fallo('la lluvia de 5 días', semana.reason)); }
  out.push('');
  out.push(`Versión visual con botones y PDF: ${SITE}/municipios-lluvia.html`);
  return { text: out.join('\n'), ok };
}

export { ordenarLluvia };
