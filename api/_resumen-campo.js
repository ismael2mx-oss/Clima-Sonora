import { vistaHorasFrio, vistaHeladas, vistaRiego, NIVELES_HELADA, RECOMENDACIONES_HELADA } from './_campo.js';
import { etiquetaDia } from './_resumen-lluvia.js';

// Texto plano de /api/resumen-campo: horas frío, heladas de 5 días y riego (ET0 menos lluvia).
const SITE = 'https://clima-sonora-6fne.vercel.app';
const TZ = 'America/Hermosillo';
const NOTA = 'Datos estimados con modelos meteorológicos (Open-Meteo). Para decisiones de manejo, consulte también a INIFAP o a su asesor técnico.';
const finito = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const n1 = v => (finito(v) ? Number(v).toFixed(1) : 'sin dato');
const signo = v => (finito(v) ? `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}` : 'sin dato');
const fallo = (que, err) => `[No disponible: no se pudo calcular ${que}. Motivo: ${err && err.message ? err.message : 'error desconocido'}]`;
const fechaCorta = f => { const d = new Date(f + 'T12:00:00Z'); return `${d.getUTCDate()} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const generado = ms => new Intl.DateTimeFormat('es-MX', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms)) + ' h';
const lista = (items, tope = 25) => (items.length <= tope ? items.join(', ') : `${items.slice(0, tope).join(', ')} y ${items.length - tope} más`);

function bloqueFrio(e) {
  const L = [];
  const p = e.promedio;
  L.push(`Temporada ${e.temporada} (${fechaCorta(e.inicio)} al ${fechaCorta(e.fin)})${e.abierta ? '' : ' — TEMPORADA CERRADA (se muestra el total final)'}. Datos hasta el ${fechaCorta(e.corte)} (último día completo), día ${e.diasTemporada} de la temporada.`);
  L.push('Método clásico (principal): horas con temperatura de 0 a 7.2 °C. Modelo Utah: unidades frío por hora (tabla estándar, el acumulado nunca baja de 0).');
  e.avisos?.forEach(a => L.push(`[Aviso: ${a}]`));
  L.push(`Promedio estatal: ${n1(p.horas)} horas frío clásicas y ${n1(p.utah)} unidades Utah.`);
  L.push(`Comparación con la temporada anterior (${e.temporadaAnterior}, a la misma fecha, ${fechaCorta(e.corteAnterior)}): ${n1(p.horasAnt)} h y ${n1(p.utahAnt)} u. Diferencia: ${signo(p.difH)} h (${finito(p.difPct) ? signo(p.difPct) + '%' : 'sin porcentaje'}) en horas clásicas; ${signo(p.difUtah)} u (${finito(p.difUtahPct) ? signo(p.difUtahPct) + '%' : 'sin porcentaje'}) en Utah.`);
  const conAnt = e.filas.filter(f => finito(f.difH));
  L.push(`Municipios con más horas que el año pasado: ${conAnt.filter(f => f.difH > 0).length}; con menos: ${conAnt.filter(f => f.difH < 0).length}; igual: ${conAnt.filter(f => f.difH === 0).length}.`);
  L.push(`Horas frío de la última semana (7 días hasta el ${fechaCorta(e.corte)}): promedio estatal ${n1(p.semana)} h; ayer (${fechaCorta(e.corte)}): ${n1(p.ayer)} h.`);
  const fila = f => `${f.municipio}: ${f.horas} h / ${n1(f.utah)} u (ayer ${f.ayer} h; semana ${f.semana ?? 'sin dato'} h; año pasado ${f.horasAnt ?? 'sin dato'} h${finito(f.difH) ? ', ' + signo(f.difH) + ' h' + (finito(f.difPct) ? ' / ' + signo(f.difPct) + '%' : '') : ''})`;
  L.push('', 'Los 10 municipios con MÁS horas frío (acumulado de la temporada):');
  e.filas.slice(0, 10).forEach((f, i) => L.push(`  ${i + 1}. ${fila(f)}`));
  L.push('', 'Los 10 municipios con MENOS horas frío:');
  [...e.filas].slice(-10).reverse().forEach((f, i) => L.push(`  ${i + 1}. ${fila(f)}`));
  const sem = [...e.filas].filter(f => finito(f.semana)).sort((a, b) => b.semana - a.semana);
  L.push('', `Mayor acumulado en la última semana: ${sem.slice(0, 5).map(f => `${f.municipio} (${f.semana} h)`).join(', ')}.`);
  if (e.sinComparacion) L.push(`[${e.sinComparacion} municipio(s) sin dato de la temporada anterior.]`);
  return L;
}

function bloqueHeladas(h) {
  const L = [];
  L.push('Mínima pronosticada (Open-Meteo, a 2 m; el aire a ras de suelo puede estar 1 a 3 °C más frío). Niveles: 🟢 Sin helada (más de 2 °C), 🟡 Riesgo (0 a 2 °C), 🟠 Ligera (0 a −2 °C), 🔴 Moderada (−2 a −5 °C), 🟣 Severa (menos de −5 °C).');
  if (h.desdeCache) L.push(`[Aviso: Open-Meteo no respondió y se usan datos guardados${h.motivo ? ' ' + h.motivo : ''}.]`);
  const presentes = new Set();
  h.dias.forEach((f, i) => {
    const frio = h.municipios.filter(m => finito(m.min[i])).sort((a, b) => a.min[i] - b.min[i]);
    const mas = frio[0];
    L.push('', `${etiquetaDia(f, i)}: mínima estatal más baja ${n1(mas?.min[i])} °C (${mas?.municipio ?? 'sin dato'}).`);
    const afectados = frio.filter(m => m.nivel[i] !== 'sin');
    if (!afectados.length) { L.push('  Sin municipios con riesgo ni helada.'); return; }
    for (const nv of [...NIVELES_HELADA].reverse().filter(n => n.id !== 'sin')) {
      const ms = afectados.filter(m => m.nivel[i] === nv.id);
      if (!ms.length) continue;
      presentes.add(nv.id);
      L.push(`  ${nv.emoji} ${nv.nombre} (${ms.length}): ${lista(ms.map(m => `${m.municipio} ${n1(m.min[i])} °C`))}`);
    }
  });
  if (presentes.size) {
    L.push('', 'Recomendaciones según el nivel más alto esperado:');
    for (const nv of [...NIVELES_HELADA].reverse().filter(n => presentes.has(n.id))) {
      const r = RECOMENDACIONES_HELADA[nv.id];
      L.push(`  ${nv.emoji} ${nv.nombre}. Ganado: ${r.ganado} Cultivos: ${r.cultivos}`);
    }
  } else L.push('', 'No se espera helada ni riesgo en los 5 días.');
  return L;
}

function bloqueRiego(r) {
  const L = [];
  const media = a => { const v = a.filter(finito); return v.length ? v.reduce((x, y) => x + Number(y), 0) / v.length : null; };
  L.push('ET₀ = evapotranspiración de referencia FAO-56 (Open-Meteo), en mm/día. Lluvia = lluvia esperada (best match, la misma de la página de lluvia). Balance = ET₀ − lluvia: es el agua que habría que reponer (negativo = la lluvia supera a la ET₀).');
  if (r.desdeCache) L.push(`[Aviso: Open-Meteo no respondió y se usan datos guardados${r.motivo ? ' ' + r.motivo : ''}.]`);
  L.push(`Promedio estatal por día (mm): ${r.dias.map((f, i) => `${etiquetaDia(f, i)} ET₀ ${n1(media(r.municipios.map(m => m.et0[i])))} / lluvia ${n1(media(r.municipios.map(m => m.lluvia[i])))}`).join(' | ')}`);
  L.push(`Promedio estatal 5 días: ET₀ ${n1(media(r.municipios.map(m => m.et0Total)))} mm, lluvia ${n1(media(r.municipios.map(m => m.lluviaTotal)))} mm, balance ${signo(media(r.municipios.map(m => m.balanceTotal)))} mm.`);
  L.push('', 'Por región (total de 5 días; el promedio de los municipios de la región; un municipio puede estar en dos regiones):');
  r.regiones.forEach(g => L.push(`  ${g.region}: ET₀ ${n1(g.et0Min)} a ${n1(g.et0Max)} mm (promedio ${n1(g.et0Prom)}), lluvia ${n1(g.lluviaProm)} mm, balance ${signo(g.balanceProm)} mm → ${finito(g.balanceProm) ? (g.balanceProm > 0 ? 'hay que reponer agua' : 'la lluvia cubre la demanda') : 'sin dato'}.`));
  const conBal = r.municipios.filter(m => finito(m.balanceTotal));
  L.push('', `Municipios con MAYOR balance (más agua por reponer): ${conBal.slice(0, 5).map(m => `${m.municipio} (${signo(m.balanceTotal)} mm)`).join(', ')}.`);
  L.push(`Municipios con MENOR balance (la lluvia cubre más): ${conBal.slice(-5).reverse().map(m => `${m.municipio} (${signo(m.balanceTotal)} mm)`).join(', ')}.`);
  const lloviendo = conBal.filter(m => m.lluviaTotal >= m.et0Total);
  L.push(`Municipios donde la lluvia de 5 días iguala o supera la ET₀: ${lloviendo.length}${lloviendo.length ? ' (' + lista(lloviendo.map(m => m.municipio), 15) + ')' : ''}.`);
  return L;
}

export async function buildResumenCampo() {
  const ahora = Date.now();
  const [frio, heladas, riego] = await Promise.allSettled([vistaHorasFrio(), vistaHeladas(), vistaRiego()]);
  const out = [];
  let ok = true;
  out.push('PRONÓSTICO PARA EL CAMPO — SONORA (72 municipios)');
  out.push('='.repeat(50));
  out.push(`Generado: ${generado(ahora)} (hora de Sonora, UTC-7).`);
  out.push(`Temporada de horas frío: ${frio.status === 'fulfilled' ? frio.value.temporada : 'sin dato'}. Fuente: Open-Meteo.`);
  out.push('');
  const bloque = (titulo, res, que, fn) => {
    out.push(titulo, '-'.repeat(50));
    if (res.status === 'fulfilled') { try { out.push(...fn(res.value)); } catch (err) { ok = false; out.push(fallo(que, err)); } } else { ok = false; out.push(fallo(que, res.reason)); }
    out.push('');
  };
  bloque('1) HORAS FRÍO', frio, 'las horas frío', bloqueFrio);
  bloque('2) HELADAS — PRÓXIMOS 5 DÍAS', heladas, 'las heladas', bloqueHeladas);
  bloque('3) RIEGO (ET₀ − LLUVIA) — PRÓXIMOS 5 DÍAS', riego, 'la evapotranspiración', bloqueRiego);
  out.push(NOTA);
  out.push(`Versión visual con tablas y PDF: ${SITE}/campo.html`);
  return { text: out.join('\n'), ok };
}

export { NOTA };
