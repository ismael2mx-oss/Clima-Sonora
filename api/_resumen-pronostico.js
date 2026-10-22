import { MUNICIPIOS } from './_municipios.js';
import { REGIONES, validarRegiones } from './_regiones.js';
import { loadOpenMeteoPronostico, loadOpenMeteoModelos, loadCorridasModelos, MODELOS } from './_openmeteo.js';
import { loadLluviaDiaria } from './_lluvia.js';
import { loadSmnTextos, loadFrenteEstado } from './_frente-data.js';
import { calcularRegiones, compararModelos, analizarSmn, frasesDescenso, tendenciaTxt, vigenciaSmn, fechaLocal, UMBRALES } from './_pronostico-data.js';
import { loadPacificStorms, loadOutlookData } from './ciclones.js';
import { PORTS, nearest, stormSection, bboxOf, esAreaGlobal, fmtLat, fmtLon, fmtKm } from './resumen-ciclones.js';
import { loadAzAlerts, alertasSection, avanceTexto, horaSonora, failure } from './resumen-frio.js';

const TZ = 'America/Hermosillo';
const SITE = 'https://clima-sonora-6fne.vercel.app';
const SEP = '==================================================';

const fmtDia = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtCorto = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const diaLargo = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const hh = h => `${String(h).padStart(2, '0')}:00 h`;
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : 'sin dato');
const msg = r => (r.reason && r.reason.message) || 'error desconocido';

// ---------- estado de las fuentes ----------
function estadoOpenMeteo(r, ahora) {
  if (r.status === 'rejected') return { ok: false, texto: `FALLÓ — ${msg(r)}` };
  const v = r.value;
  const hora = `${horaSonora(v.datosDe)} h`;
  if (v.desdeCache) return { ok: false, texto: `DATOS GUARDADOS de las ${hora} (la consulta actual falló ${v.motivo || 'por un error de Open-Meteo'})` };
  const min = Math.round((ahora - Date.parse(v.datosDe)) / 60000);
  return { ok: true, texto: min >= 2 ? `OK, datos de las ${hora} (reutilizados de la memoria del servidor, hace ${min} min)` : `OK, consultado a las ${hora}` };
}

function metadatos({ ahora, corridas, rPron, rLluvia, rMod, rSmn, rFrente, rStorms, rOutlook, rAz, regionesMal }) {
  const L = [];
  L.push(`Generado: ${cap(fmtDia.format(new Date(ahora)))} h (hora de Sonora, UTC-7).`);
  const hoy = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(ahora));
  L.push(`Día analizado: hoy ${hoy}, día completo de 00:00 a 24:00 h hora de Sonora (la lluvia diaria es del día completo, no de las horas que quedan).`);
  L.push('Modelos de Open-Meteo y corrida usada (hora de inicialización del modelo):');
  corridas.forEach(c => {
    if (!c.corrida) { L.push(`  - ${c.nombre}: corrida no disponible (${c.error})`); return; }
    const d = new Date(c.corrida);
    L.push(`  - ${c.nombre}: corrida de las ${String(d.getUTCHours()).padStart(2, '0')} UTC del ${d.getUTCDate()}/${d.getUTCMonth() + 1} (${fmtCorto.format(d)} h de Sonora)`);
  });
  L.push('  - Valores por región y rangos: modelo "best match" de Open-Meteo (mezcla de modelos, que es la misma fuente de las demás páginas).');

  const filas = [];
  const om = (nombre, r) => { const e = estadoOpenMeteo(r, ahora); filas.push({ ok: e.ok, txt: `  - ${nombre}: ${e.texto}` }); };
  om('Open-Meteo horario (72 municipios: temperatura, viento, humedad, nubes, lluvia por hora)', rPron);
  om('Open-Meteo lluvia diaria (fuente única de lluvia)', rLluvia);
  om('Open-Meteo comparación de modelos ICON/GFS/ECMWF', rMod);
  if (rSmn.status === 'rejected') filas.push({ ok: false, txt: `  - SMN: FALLÓ — ${msg(rSmn)}` });
  else {
    const caidas = rSmn.value.filter(t => !t.ok);
    const buenas = rSmn.value.filter(t => t.ok).map(t => `${t.nombre}: aviso No. ${t.noAviso ?? 's/n'}${t.emitido ? ` emitido ${fmtCorto.format(new Date(t.emitido))} h` : ''} [${vigenciaSmn(t.emitido, ahora).texto}]`);
    filas.push({ ok: !caidas.length, txt: `  - SMN: ${buenas.length ? 'OK —\n      ' + buenas.join('\n      ') : 'sin páginas'}${caidas.length ? ` | FALLÓ ${caidas.map(t => `${t.nombre} (${t.error})`).join('; ')}` : ''}` });
  }
  if (rFrente.status === 'rejected') filas.push({ ok: false, txt: `  - WPC/frente frío: FALLÓ — ${msg(rFrente)}` });
  else {
    const e = rFrente.value;
    const partes = [];
    if (!e.wpc.ok) partes.push(`WPC FALLÓ (${e.wpc.error})`); else partes.push(`WPC OK${e.wpc.valido ? `, análisis válido ${fmtCorto.format(new Date(e.wpc.valido))} h` : ''}`);
    if (!e.senales.ok) partes.push(`señales de Open-Meteo FALLARON (${e.senales.error})`);
    else if (e.senales.desdeCache) partes.push(`señales con DATOS GUARDADOS de las ${horaSonora(e.senales.datosDe)} h (${e.senales.motivo || 'falla de Open-Meteo'})`);
    filas.push({ ok: e.wpc.ok && e.senales.ok && !e.senales.desdeCache, txt: `  - Frente frío: ${partes.join('; ')}` });
  }
  filas.push({ ok: rStorms.status === 'fulfilled', txt: `  - NHC ciclones activos: ${rStorms.status === 'fulfilled' ? 'OK' : `FALLÓ — ${msg(rStorms)}`}` });
  filas.push({ ok: rOutlook.status === 'fulfilled', txt: `  - NHC zonas de formación: ${rOutlook.status === 'fulfilled' ? 'OK' : `FALLÓ — ${msg(rOutlook)}`}` });
  filas.push({ ok: rAz.status === 'fulfilled', txt: `  - NWS Arizona: ${rAz.status === 'fulfilled' ? 'OK' : `FALLÓ — ${msg(rAz)}`}` });
  L.push('Estado de las fuentes (si algo falló o viene de datos guardados se avisa; nunca se rellena con ceros):');
  filas.forEach(f => L.push(f.txt));
  const malas = filas.filter(f => !f.ok).length;
  L.push(malas ? `ADVERTENCIA: ${malas} fuente(s) con falla o con datos guardados; las secciones afectadas lo indican.` : 'Todas las fuentes respondieron con datos recientes.');
  if (regionesMal.length) L.push(`ADVERTENCIA: la configuración de regiones tiene problemas: ${regionesMal.join('; ')}`);
  return { texto: L.join('\n'), ok: malas === 0 && !regionesMal.length };
}

// ---------- sistemas y avisos ----------
function seccionSmn(smnR) {
  if (smnR.status === 'rejected') return failure('el texto del SMN', smnR.reason);
  const a = analizarSmn(smnR.value);
  if (!a.general && !a.extendido) return failure('el texto del SMN', new Error(a.errores.join('; ') || 'sin páginas'));
  const L = [];
  const ahoraMs = Date.now();
  const etiqueta = p => (p ? `aviso No. ${p.noAviso ?? 's/n'}, emitido ${p.emitido ? `${fmtCorto.format(new Date(p.emitido))} h de Sonora` : 'sin fecha'} — ${vigenciaSmn(p.emitido, ahoraMs).texto}` : null);
  if (a.general) L.push(`SMN, Pronóstico Meteorológico General: ${etiqueta(a.general)}.`);
  if (a.extendido) L.push(`SMN, Pronóstico Extendido a 96 h: ${etiqueta(a.extendido)}.`);
  if (a.errores.length) L.push(`[No disponible: ${a.errores.join('; ')}]`);
  if (!a.general) L.push('[No disponible: el Pronóstico Meteorológico General (aviso diario) del SMN; solo se usó el pronóstico extendido, así que la lista de sistemas y avisos puede estar incompleta.]');
  L.push('Sistemas que menciona el SMN y que pueden afectar a Sonora (texto textual de cada frase):');
  if (!a.sistemas.length) L.push('  Ninguno de los sistemas buscados (frente frío, canal de baja presión, alta presión/anticiclón, corriente en chorro, vaguada, humedad del Pacífico, masa de aire polar) aparece en frases que nombren a Sonora o al noroeste.');
  a.sistemas.forEach(s => L.push(`  - ${s.sistemas.join(' + ')} [${s.alcance}; ${s.fuente}]:\n      "${s.texto}"`));
  if (a.general) {
    L.push('Avisos y pronósticos del SMN (aviso general) que mencionan Sonora:');
    if (a.pronosticoSonora.length) a.pronosticoSonora.forEach(c => L.push(`  - ${c}`)); else L.push('  Ninguno nombra a Sonora.');
  }
  if (a.pacificoNorte) { L.push('Pronóstico regional del SMN, "Pacífico Norte" (incluye Sonora):'); L.push(`  "${a.pacificoNorte}"`); }
  if (a.extendidoSonora.length) { L.push(`Pronóstico extendido a 96 h del SMN (${vigenciaSmn(a.extendido.emitido, ahoraMs).esDeHoy === false ? 'OJO: no es de hoy; ' : ''}emitido ${a.extendido.emitido ? fmtCorto.format(new Date(a.extendido.emitido)) + ' h' : 'sin fecha'}), frases que mencionan Sonora:`); a.extendidoSonora.forEach(c => L.push(`  - ${c}`)); }
  return L.join('\n');
}

function seccionFrente(rFrente) {
  if (rFrente.status === 'rejected') return failure('el estado del frente frío', rFrente.reason);
  const e = rFrente.value;
  const L = [];
  if (e.smn.ok) {
    if (e.smn.parcial) L.push(`SMN: lectura PARCIAL (${e.smn.paginas.filter(p => !p.ok).map(p => `${p.nombre}: ${p.error}`).join('; ')}); lo que sigue puede estar incompleto.`);
    if (!e.smn.frentes.length) L.push(e.smn.parcial ? 'SMN: sin frente frío numerado en las páginas que se pudieron leer.' : 'SMN: sin frente frío anunciado.');
    else e.smn.frentes.forEach(f => L.push(`SMN: frente frío núm. ${f.numero} (aviso No. ${f.noAviso ?? 's/n'}).`));
  } else L.push(`SMN: no disponible (${e.smn.error}).`);
  if (!e.wpc.ok) L.push(`WPC: [No disponible: ${e.wpc.error}]`);
  else {
    const w = e.wpc;
    const frios = w.elementos.filter(x => x.tipo === 'COLD');
    L.push(`WPC (análisis válido ${w.valido ? `${fmtCorto.format(new Date(w.valido))} h de Sonora` : 'sin hora'}): ${frios.length ? `${frios.length} frente(s) frío(s) a 600 km o menos de Sonora` : 'sin frentes fríos a 600 km o menos de Sonora'}.`);
    frios.forEach((f, i) => { L.push(`  ${i + 1}. ${f.distCajaKm === 0 ? 'cruza Sonora' : `a ${f.distCajaKm} km de Sonora`}${f.avance ? `; avance: ${avanceTexto(f.avance)}` : ''}`); });
    const otros = w.elementos.filter(x => x.tipo !== 'COLD' && x.tipo !== 'TROF');
    if (otros.length) L.push(`  Otros: ${otros.map(x => `${x.tipoEs} a ${x.distCajaKm} km`).join('; ')}.`);
  }
  const g = e.grupos, n = e.municipios.length;
  const km = cat => e.municipios.filter(m => m.categoria === cat).sort((a, b) => a.wpc.distKm - b.wpc.distKm).map(m => `${m.municipio} (${m.wpc.distKm} km)`);
  L.push(`Municipios (${n}): frente encima ${g.encima.length}; se acerca ${g.seAcerca.length}; ya pasó ${g.yaPaso.length}; paso probable ${g.paso.length}; aire más seco/fresco ${g.aire.length}; sin influencia cercana ${g.sinSenal.length}; sin datos ${g.sinDatos.length}.`);
  if (g.encima.length) L.push(`  Frente encima: ${km('encima').join(', ')}`);
  if (g.seAcerca.length) L.push(`  Se acerca: ${km('se_acerca').slice(0, 14).join(', ')}${g.seAcerca.length > 14 ? `, … (${g.seAcerca.length} en total)` : ''}`);
  if (g.yaPaso.length) L.push(`  Ya pasó: ${g.yaPaso.join(', ')}`);
  if (!e.senales.ok) L.push(`  Paso probable en las próximas 72 h: [No disponible: ${e.senales.error}]`);
  else {
    if (e.senales.desdeCache) L.push(`  (Señales calculadas con datos guardados de Open-Meteo de las ${horaSonora(e.senales.datosDe)} h.)`);
    if (!e.eventos.length) L.push('  Paso de frente probable (próximas 72 h): ningún municipio cumple los criterios.');
    e.eventos.forEach(ev => L.push(`  Evento ${ev.numero}: ${fmtCorto.format(new Date(Date.parse(ev.desde + ':00-07:00')))} h a ${fmtCorto.format(new Date(Date.parse(ev.hasta + ':00-07:00')))} h, ${ev.municipios.length} municipio(s)${ev.etiqueta ? ` — ${ev.etiqueta}` : ''}${ev.nota ? ` — Nota: ${ev.nota}` : ''}`));
  }
  (e.notas || []).forEach(nota => L.push(`  Nota: ${nota}`));
  L.push(`  Detalle completo: ${SITE}/api/resumen-frio y ${SITE}/frio.html`);
  return L.join('\n');
}

function seccionNws(azR) {
  if (azR.status === 'rejected') return failure('los avisos del NWS para Arizona', azR.reason);
  return 'Son avisos del Servicio Meteorológico Nacional de EE. UU. para ARIZONA; no son avisos para Sonora.\n' + alertasSection(azR.value);
}

// ---------- por región ----------
function bloqueRegion(nombre, r, modelos, hayLluvia) {
  const L = [];
  const lista = r.municipios.length > 12 ? `${r.municipios.slice(0, 12).join(', ')}, … (${r.n})` : r.municipios.join(', ');
  L.push(`--- ${nombre} (${r.n} municipios: ${lista}) ---`);
  // Los extremos llevan el municipio y su elevación para detectar a simple vista municipios mal asignados.
  const rango = (x, u, d = 1) => (x ? `${x.min.toFixed(d)}${u} (${x.minMun}${x.minElev !== null ? `, ${x.minElev} m` : ''}) a ${x.max.toFixed(d)}${u} (${x.maxMun}${x.maxElev !== null ? `, ${x.maxElev} m` : ''})` : 'sin dato');
  L.push(`Temperatura máxima de hoy: ${rango(r.tmax, ' °C')}`);
  L.push(`Mínima de la noche/madrugada siguiente (18:00 de hoy a 09:00 de mañana): ${rango(r.tmin, ' °C')}`);

  // Lluvia "best match": es la cifra de la página de lluvia y de /api/resumen-ciclones. En esta zona suele seguir al GFS.
  if (!hayLluvia) L.push('Lluvia (best match): [No disponible: falló la lluvia diaria de Open-Meteo]');
  else if (r.lluvia) {
    const ll = r.lluvia;
    L.push(`Lluvia, best match (misma cifra que la página de lluvia y /api/resumen-ciclones; día completo): probabilidad máxima ${ll.prob ? `${ll.prob.max}% (${ll.prob.maxMun})` : 'sin dato'}; acumulado máximo ${ll.mm ? `${ll.mm.max.toFixed(1)} mm (${ll.mm.maxMun})` : 'sin dato'}`);
  }

  if (!modelos) {
    L.push('Lluvia y tormentas por modelo: [No disponible: falló la consulta de ICON/GFS/ECMWF]');
  } else {
    const mm = m => (m.lluvia ? `${m.nombre} ${m.lluvia.mm.toFixed(1)} mm${m.lluvia.mm > 0 ? ` (${m.lluvia.municipio})` : ''}` : `${m.nombre} sin dato`);
    const l = modelos.lluvia;
    L.push(`Lluvia por modelo (acumulado de 00:00 a 24:00 h; máximo entre municipios): ${modelos.porModelo.map(mm).join(' · ')} → ${l.n} de ${l.total} modelos con ≥${UMBRALES.lluviaMm} mm${l.modelos.length ? ` (${l.modelos.join(', ')})` : ''} → ${l.veredicto}`);
    modelos.porModelo.filter(m => m.lluvia).forEach(m => L.push(`  - ${m.nombre}: ${m.lluvia.nMunicipios} de ${r.n} municipios con ≥${UMBRALES.lluviaMm} mm; franja con lluvia (≥0.1 mm/h): ${m.lluvia.franja || 'ninguna'}`));
    const t = modelos.tormenta;
    L.push(`Tormenta eléctrica por modelo (weather_code 95-99 en alguna hora del día): ${modelos.porModelo.map(m => (m.tormenta ? `${m.nombre} ${m.tormenta.municipios.length ? 'SÍ' : 'no'}` : `${m.nombre} sin dato`)).join(' · ')} → ${t.n} de ${t.total} modelos → ${t.veredicto}`);
    modelos.porModelo.filter(m => m.tormenta && m.tormenta.municipios.length).forEach(m => L.push(`  - ${m.nombre}: ${m.tormenta.municipios.length} municipio(s) (${m.tormenta.municipios.slice(0, 8).join(', ')}${m.tormenta.municipios.length > 8 ? ', …' : ''}); franja: ${m.tormenta.franja}`));
    L.push(`  CAPE máximo, indicador de apoyo (≥1,000 J/kg atmósfera inestable; ≥2,500 muy inestable): ${modelos.porModelo.map(m => (m.cape ? `${m.nombre} ${m.cape.v.toLocaleString('en-US')} J/kg (${m.cape.municipio}, ${hh(m.cape.hora)})` : `${m.nombre} sin dato`)).join(' · ')}`);
  }

  const v = r.viento;
  L.push(`Viento sostenido máximo (best match): ${v.sostenido ? `${v.sostenido.v} km/h del ${v.sostenido.dir ?? 'n/d'} a las ${hh(v.sostenido.hora)} (${v.sostenido.municipio})` : 'sin dato'}`);
  L.push(`Rachas máximas (best match): ${v.racha ? `${v.racha.v} km/h del ${v.racha.dir ?? 'n/d'} a las ${hh(v.racha.hora)} (${v.racha.municipio})` : 'sin dato'}; municipios con rachas ≥${UMBRALES.rachaKmh} km/h: ${v.conRacha50} de ${r.n}`);
  L.push(`Humedad relativa mínima de la tarde (12:00-19:00 h): ${rango(r.humedad, ' %', 0)}`);
  L.push(`Nubosidad de la tarde (12:00-19:00 h): ${r.nubes ? `${r.nubes.clase} (cobertura media ${r.nubes.media}%; entre ${Math.round(r.nubes.min)}% y ${Math.round(r.nubes.max)}% según el municipio)` : 'sin dato'}`);

  if (modelos) {
    L.push(`Confianza de modelos en rachas y calor (cuántos de ICON, GFS y ECMWF tienen al menos un municipio de la región sobre el umbral; solo se menciona un impacto si coinciden 2 o más):`);
    [modelos.rachas, modelos.calor].forEach(m => L.push(`  - ${m.nombre}: ${m.total ? `${m.n} de ${m.total} modelos${m.modelos.length ? ` (${m.modelos.join(', ')})` : ''}` : 'sin datos'} → ${m.veredicto}`));
  }
  return L.join('\n');
}

// ---------- ciclones ----------
function seccionCiclones(stormsR, outlookR) {
  const L = [];
  if (stormsR.status === 'rejected') L.push(failure('las tormentas activas del NHC', stormsR.reason));
  else if (!stormsR.value.storms.length) L.push('Sin tormentas activas en el Pacífico.');
  else {
    L.push(`${stormsR.value.storms.length} sistema(s) activo(s) en el Pacífico:`);
    stormsR.value.storms.forEach((s, i) => {
      // Se reutiliza el bloque de /api/resumen-ciclones y se corta antes de la lista de trayectoria.
      const bloque = stormSection(s, i).split('\n').filter(l => !/^ {3}(Trayectoria|Posiciones)|^ {5}\+/.test(l));
      L.push(bloque.join('\n'));
      const n = nearest(s.lat, s.lon, PORTS['Sonora']);
      L.push(`   Distancia mínima a Sonora: ${fmtKm(n.d)} (hasta ${n.name}, punto de referencia de la costa; no es la línea de costa exacta)`);
    });
  }
  L.push('');
  L.push('Zonas de formación (perspectiva del NHC):');
  if (outlookR.status === 'rejected') L.push(failure('las zonas de formación del NHC', outlookR.reason));
  else {
    const areas = (outlookR.value && outlookR.value.areas && outlookR.value.areas.features) || [];
    if (!areas.length) L.push('  Sin zonas de posible formación marcadas por el NHC en el Pacífico.');
    areas.forEach((f, i) => {
      const p = f.properties || {};
      const b = bboxOf(f.geometry);
      if (esAreaGlobal(b)) { L.push(`  ${i + 1}. Formación a 48 h: ${p.prob2day || 'n/d'}; a 7 días: ${p.prob7day || 'n/d'}; ubicación y distancia a Sonora: NO DISPONIBLES (el polígono que entrega el NHC cubre todo el globo y no permite ubicar la zona).`); return; }
      const cLat = (b.minLat + b.maxLat) / 2, cLon = (b.minLon + b.maxLon) / 2;
      const n = nearest(cLat, cLon, PORTS['Sonora']);
      L.push(`  ${i + 1}. Formación a 48 h: ${p.prob2day || 'n/d'}; a 7 días: ${p.prob7day || 'n/d'}; centro aproximado ${fmtLat(cLat)} ${fmtLon(cLon)}; distancia a Sonora: ${fmtKm(n.d)} (hasta ${n.name}).`);
    });
  }
  L.push(`  Detalle: ${SITE}/api/resumen-ciclones y ${SITE}/ciclones.html`);
  return L.join('\n');
}

// Ninguna fuente externa puede colgar el resumen: pasados 30 s se da por caída y se avisa en el texto.
function conPlazo(promesa, ms = 30000) {
  let t;
  const limite = new Promise((_, rechazo) => { t = setTimeout(() => rechazo(new Error('tiempo de espera agotado')), ms); });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(t));
}

// ---------- armado ----------
export async function buildResumenPronostico() {
  const ahora = Date.now();
  const [rPron, rLluvia, rMod, rCorridas, rSmn, rFrente, rStorms, rOutlook, rAz] = await Promise.allSettled([
    loadOpenMeteoPronostico(), loadLluviaDiaria(), loadOpenMeteoModelos(), loadCorridasModelos(),
    conPlazo(loadSmnTextos()), conPlazo(loadFrenteEstado()), conPlazo(loadPacificStorms()), conPlazo(loadOutlookData()), conPlazo(loadAzAlerts())
  ]);
  const corridas = rCorridas.status === 'fulfilled' ? rCorridas.value : MODELOS.map(m => ({ ...m, corrida: null, error: msg(rCorridas) }));
  const regionesMal = validarRegiones();

  const meta = metadatos({ ahora, corridas, rPron, rLluvia, rMod, rSmn, rFrente, rStorms, rOutlook, rAz, regionesMal });

  // Cálculos por región (solo si hay series horarias; si no, se dice claramente).
  let datos = null, errorDatos = null;
  if (rPron.status === 'fulfilled') {
    try { datos = calcularRegiones(rPron.value.list.map(l => l.hourly), rLluvia.status === 'fulfilled' ? rLluvia.value : null, ahora, rPron.value.list.map(l => l.elevation)); }
    catch (err) { errorDatos = err; }
  }
  const modelos = rMod.status === 'fulfilled' ? compararModelos(rMod.value.list, fechaLocal(ahora)) : null;

  const out = [];
  out.push('RESUMEN DE DATOS PARA EL PRONÓSTICO GENERAL DE LA MAÑANA — SONORA');
  out.push(`Versión visual de frentes fríos: ${SITE}/frio.html · Lluvia: ${SITE}/municipios-lluvia.html`);
  out.push('');
  out.push(SEP, 'METADATOS', SEP, meta.texto, '');

  out.push(SEP, 'SISTEMAS Y AVISOS OFICIALES', SEP);
  out.push('[SMN — texto oficial]', seccionSmn(rSmn), '');
  out.push('[Frente frío — WPC/SMN/Open-Meteo]', seccionFrente(rFrente), '');
  out.push('[NWS — Arizona, EE. UU.]', seccionNws(rAz), '');

  out.push(SEP, 'POR REGIÓN', SEP);
  if (!datos) out.push(failure('los datos horarios por región de Open-Meteo', rPron.status === 'rejected' ? rPron.reason : errorDatos));
  else {
    out.push(`Definiciones: máxima = mayor temperatura horaria de hoy (00-24 h); mínima = menor temperatura entre las 18:00 de hoy y las 09:00 de mañana; viento a 10 m; "rachas ≥${UMBRALES.rachaKmh} km/h" y "máximas ≥${UMBRALES.tmaxC} °C" se cuentan por municipio. Un municipio puede aparecer en dos regiones.`, '');
    Object.entries(datos.regiones).forEach(([nombre, r]) => out.push(bloqueRegion(nombre, r, modelos ? modelos[nombre] : null, rLluvia.status === 'fulfilled'), ''));
  }

  out.push(SEP, 'TENDENCIA (comparación con el día anterior)', SEP);
  if (!datos) out.push(failure('las series horarias de Open-Meteo', rPron.status === 'rejected' ? rPron.reason : errorDatos));
  else {
    out.push(`Umbral: cambios menores a ${UMBRALES.estableC} °C en el promedio de la región se consideran estables. Ayer y hoy son de Open-Meteo (mismo modelo), no observaciones.`);
    Object.entries(datos.regiones).forEach(([nombre, r]) => {
      const t = r.tendencia;
      out.push(`- ${nombre}: ${tendenciaTxt(t.tmaxHoyVsAyer, 'máximas hoy vs ayer')} (media ${num(t.tmaxMediaAyer)} → ${num(t.tmaxMediaHoy)} °C); ${tendenciaTxt(t.tminNocheVsPrevia, 'mínimas de esta noche vs la noche anterior')} (media ${num(t.tminMediaPrevia)} → ${num(t.tminMediaNoche)} °C); ${tendenciaTxt(t.tmaxMananaVsHoy, 'máximas de mañana vs hoy')}.`);
    });
  }
  out.push('');

  out.push(SEP, 'CICLONES TROPICALES Y ZONAS DE FORMACIÓN (PACÍFICO)', SEP, seccionCiclones(rStorms, rOutlook), '');

  out.push(SEP, 'NOTAS', SEP);
  // Impactos con consenso de modelos.
  if (modelos) {
    const imp = [];
    const nombres = { lluvia: `Lluvia (≥${UMBRALES.lluviaMm} mm en el día)`, tormenta: 'Tormenta eléctrica (weather_code 95-99)', rachas: null, calor: null };
    Object.entries(modelos).forEach(([reg, m]) => ['lluvia', 'tormenta', 'rachas', 'calor'].forEach(k => {
      if (m[k].mencionar) imp.push(`${nombres[k] || m[k].nombre} en ${reg}: ${m[k].n} de ${m[k].total} modelos (${m[k].modelos.join(', ')})`);
    }));
    out.push(imp.length ? 'Impactos con coincidencia de 2 o más modelos (se pueden mencionar):' : 'Ningún impacto (lluvia, tormenta eléctrica, rachas ≥50 km/h, máximas ≥40 °C) tiene coincidencia de 2 o más modelos en ninguna región: no mencionar impactos.');
    imp.forEach(i => out.push(`  - ${i}`));
    // El "best match" de Open-Meteo puede dar 0 mm donde ICON o ECMWF dan lluvia: se avisa para no confundirse.
    const bm = datos ? Math.max(...Object.values(datos.regiones).map(r => (r.lluvia && r.lluvia.mm ? r.lluvia.mm.max : 0))) : null;
    const conLluvia = Object.values(modelos).filter(m => m.lluvia.mencionar).length;
    if (bm === 0 && conLluvia) out.push(`AVISO: el "best match" (la cifra de la página de lluvia y de /api/resumen-ciclones) da 0 mm en todo Sonora, pero ICON y/o ECMWF marcan lluvia en ${conLluvia} región(es). En esta zona el best match suele seguir al GFS; para lluvia convectiva conviene guiarse por los acumulados de cada modelo.`);
  } else out.push('No se pudo comparar modelos; no hay base para afirmar impactos.');
  // Contraste con el SMN.
  if (rSmn.status === 'fulfilled') {
    const frases = frasesDescenso(rSmn.value);
    if (frases.length && datos) {
      const subiendo = Object.entries(datos.regiones).filter(([, r]) => Number.isFinite(r.tendencia.tminNocheVsPrevia) && r.tendencia.tminNocheVsPrevia >= UMBRALES.estableC).map(([n, r]) => `${n} (+${r.tendencia.tminNocheVsPrevia.toFixed(1)} °C)`);
      const bajando = Object.entries(datos.regiones).filter(([, r]) => Number.isFinite(r.tendencia.tminNocheVsPrevia) && r.tendencia.tminNocheVsPrevia <= -UMBRALES.estableC).map(([n, r]) => `${n} (${r.tendencia.tminNocheVsPrevia.toFixed(1)} °C)`);
      out.push('El SMN menciona descenso de temperatura / ambiente frío en el noroeste o Sonora:');
      frases.forEach(f => out.push(`  - "${f.texto}"`));
      out.push(`  Contraste con los datos (mínimas de esta noche vs la anterior): mínimas subiendo en ${subiendo.length ? subiendo.join('; ') : 'ninguna región'}; bajando en ${bajando.length ? bajando.join('; ') : 'ninguna región'}.`);
      if (subiendo.length && !bajando.length) out.push('  → Posible discrepancia: el SMN habla de descenso pero los datos de Open-Meteo no muestran mínimas bajando.');
    }
  }
  out.push('La comparación de modelos usa el máximo del día (00-24 h, hora de Sonora) en cualquier municipio de la región. La probabilidad de lluvia solo existe para el best match (Open-Meteo no la da por modelo).');
  out.push('Las regiones salen de api/_regiones.js (asignación propuesta; un municipio puede estar en dos regiones). Los umbrales de modelos están en api/_pronostico-data.js.');
  out.push('No se redacta el pronóstico: son solo datos ordenados.');
  return { text: out.join('\n'), ok: meta.ok && Boolean(datos) && Boolean(modelos) && rLluvia.status === 'fulfilled' };
}
