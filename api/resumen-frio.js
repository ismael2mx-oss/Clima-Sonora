import { loadSonoraFrio } from './_frio-data.js';
import { loadFrenteEstado, localStringToMs } from './_frente-data.js';

const TZ = 'America/Hermosillo';
const SITE = 'https://clima-sonora-6fne.vercel.app';
const DROP_UMBRAL = 8; // °C, caída día a día para considerarse descenso fuerte de temperatura
const GUST_TOLVANERA = 50; // km/h
const RAIN_PROB_TOLVANERA = 30; // %, debajo de esto con racha fuerte se considera tolvanera
const FRENTE_DIRS = new Set(['N', 'NNO', 'NO', 'NNE', 'ONO']); // direcciones típicas tras un frente frío

const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const dir16 = deg => Number.isFinite(deg) ? DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] : 'n/d';

const dateTimeFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtFull = d => dateTimeFmt.format(d) + ' h';
const fmtShort = d => shortFmt.format(d) + ' h';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const round1 = v => Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
const t = v => Number.isFinite(v) ? `${round1(v)} °C` : 'sin dato';

function dayLabel(dias, k) {
  const label = cap(dayFmt.format(new Date(dias[k] + 'T12:00:00Z')));
  const tag = k === 0 ? ' (HOY)' : k === 1 ? ' (MAÑANA)' : '';
  return `${label}${tag}`;
}

function resumenPorDiaSection(frio) {
  const out = [];
  frio.dias.forEach((_, k) => {
    const idx = k + 1; // índice real en los arreglos (0 = ayer)
    const rows = frio.municipios
      .map(m => ({ name: m.municipio, tmin: m.tmin[idx] }))
      .filter(r => Number.isFinite(r.tmin));
    if (!rows.length) {
      out.push(`--- ${dayLabel(frio.dias, k)} ---`);
      out.push('Sin datos disponibles para este día.');
      out.push('');
      return;
    }
    rows.sort((a, b) => a.tmin - b.tmin);
    const avg = rows.reduce((s, r) => s + r.tmin, 0) / rows.length;
    const coldest = rows[0];
    const heladas = rows.filter(r => r.tmin < 0).length;
    const bajo5 = rows.filter(r => r.tmin < 5).length;

    out.push(`--- ${dayLabel(frio.dias, k)} ---`);
    out.push(`Promedio estatal de la mínima: ${t(avg)}`);
    out.push(`Municipio más frío: ${coldest.name} (${t(coldest.tmin)})`);
    out.push(`Municipios bajo 0 °C (helada): ${heladas} de ${rows.length}`);
    out.push(`Municipios bajo 5 °C: ${bajo5} de ${rows.length}`);
    out.push('');
  });
  return out.join('\n').trimEnd();
}

function minimasPorDiaSection(frio) {
  const out = [];
  frio.dias.forEach((_, k) => {
    const idx = k + 1;
    const rows = frio.municipios.map(m => ({
      name: m.municipio, tmin: m.tmin[idx], tmax: m.tmax[idx], feels: m.feels[idx]
    }));
    rows.sort((a, b) => (Number.isFinite(a.tmin) ? a.tmin : 999) - (Number.isFinite(b.tmin) ? b.tmin : 999));

    out.push(`--- ${dayLabel(frio.dias, k)} ---`);
    out.push('Municipios del más frío al menos frío (mínima; máxima; sensación térmica mínima):');
    rows.forEach((r, i) => {
      out.push(`${String(i + 1).padStart(3, ' ')}. ${r.name}: mín. ${t(r.tmin)}; máx. ${t(r.tmax)}; sensación mín. ${t(r.feels)}`);
    });
    out.push('');
  });
  return out.join('\n').trimEnd();
}

function frentesSection(frio) {
  const out = [];
  let alguno = false;
  frio.dias.forEach((_, k) => {
    const idx = k + 1;
    const hits = [];
    frio.municipios.forEach(m => {
      const tmaxPrev = m.tmax[idx - 1], tmaxNow = m.tmax[idx];
      const tminPrev = m.tmin[idx - 1], tminNow = m.tmin[idx];
      const dMax = Number.isFinite(tmaxPrev) && Number.isFinite(tmaxNow) ? tmaxPrev - tmaxNow : null;
      const dMin = Number.isFinite(tminPrev) && Number.isFinite(tminNow) ? tminPrev - tminNow : null;
      const flagMax = dMax !== null && dMax >= DROP_UMBRAL;
      const flagMin = dMin !== null && dMin >= DROP_UMBRAL;
      if (!flagMax && !flagMin) return;
      const bits = [];
      if (flagMax) bits.push(`máxima ${t(tmaxPrev)} → ${t(tmaxNow)} (-${round1(dMax)} °C)`);
      if (flagMin) bits.push(`mínima ${t(tminPrev)} → ${t(tminNow)} (-${round1(dMin)} °C)`);
      const esFrente = FRENTE_DIRS.has(dir16(m.windDir[idx]));
      hits.push(`${m.municipio}: ${bits.join('; ')}${esFrente ? ' — posible frente frío' : ''}`);
    });
    if (hits.length) {
      alguno = true;
      out.push(`--- ${dayLabel(frio.dias, k)} ---`);
      out.push(...hits);
      out.push('');
    }
  });
  if (!alguno) return `Sin caídas de ${DROP_UMBRAL} °C o más de un día a otro en los próximos 5 días (según el pronóstico actual).`;
  return out.join('\n').trimEnd();
}

function vientoTag(gust, rainProb) {
  if (!Number.isFinite(gust) || gust < GUST_TOLVANERA) return '';
  if (Number.isFinite(rainProb) && rainProb >= RAIN_PROB_TOLVANERA) return 'viento fuerte';
  return 'posible tolvanera';
}

function vientoSection(frio) {
  const out = [];
  frio.dias.forEach((_, k) => {
    const idx = k + 1;
    const rows = frio.municipios
      .map(m => ({ name: m.municipio, gust: m.gust[idx], dir: m.windDir[idx], rainProb: m.rainProb[idx] }))
      .filter(r => Number.isFinite(r.gust))
      .sort((a, b) => b.gust - a.gust);

    out.push(`--- ${dayLabel(frio.dias, k)} ---`);
    if (!rows.length) {
      out.push('Sin datos de viento disponibles para este día.');
    } else {
      const tagged = rows.map(r => ({ ...r, tag: vientoTag(r.gust, r.rainProb) }));
      const tolvaneras = tagged.filter(r => r.tag === 'posible tolvanera').length;
      const fuertes = tagged.filter(r => r.tag === 'viento fuerte').length;
      out.push(`Municipios con racha de ${GUST_TOLVANERA} km/h o más: ${tolvaneras + fuertes} de ${rows.length} (posible tolvanera: ${tolvaneras} · viento fuerte con lluvia probable: ${fuertes})`);
      out.push(`"Posible tolvanera" = racha de ${GUST_TOLVANERA} km/h o más con menos de ${RAIN_PROB_TOLVANERA}% de probabilidad de lluvia. "Viento fuerte" = misma racha pero con ${RAIN_PROB_TOLVANERA}% o más de probabilidad de lluvia.`);
      out.push('Municipios de mayor a menor racha (racha máxima; dirección dominante):');
      tagged.forEach((r, i) => {
        out.push(`${String(i + 1).padStart(3, ' ')}. ${r.name}: ${round1(r.gust)} km/h, ${dir16(r.dir)}${r.tag ? ' — ' + r.tag : ''}`);
      });
    }
    out.push('');
  });
  return out.join('\n').trimEnd();
}

function nieveSection(frio) {
  const out = [];
  let alguna = false;
  frio.dias.forEach((_, k) => {
    const idx = k + 1;
    const rows = frio.municipios
      .map(m => ({ name: m.municipio, cm: m.snow[idx] }))
      .filter(r => Number.isFinite(r.cm) && r.cm > 0)
      .sort((a, b) => b.cm - a.cm);
    if (rows.length) {
      alguna = true;
      out.push(`--- ${dayLabel(frio.dias, k)} ---`);
      rows.forEach(r => out.push(`${r.name}: ${round1(r.cm)} cm`));
      out.push('');
    }
  });
  if (!alguna) return 'Sin nieve pronosticada en los próximos 5 días en ningún municipio (según Open-Meteo).';
  return out.join('\n').trimEnd();
}

const FRIO_VIENTO_RE = /freeze|frost|wind|dust|cold|snow|winter/i;

async function loadAzAlerts() {
  const res = await fetch('https://api.weather.gov/alerts/active?area=AZ', {
    headers: { 'User-Agent': 'clima-sonora (https://clima-sonora-6fne.vercel.app)', 'Accept': 'application/geo+json' }
  });
  if (!res.ok) throw new Error('No se pudo contactar al National Weather Service.');
  const data = await res.json();
  return (data.features || []).filter(f => FRIO_VIENTO_RE.test(f.properties?.event || ''));
}

function alertasSection(feats) {
  if (!feats.length) return 'Sin avisos vigentes de frío, heladas o viento para Arizona (National Weather Service).';
  return feats.map((f, i) => {
    const p = f.properties;
    const start = p.onset || p.effective;
    const end = p.ends || p.expires;
    const vigencia = [start ? fmtShort(new Date(start)) : 'n/d', end ? fmtShort(new Date(end)) : 'sin definir'].join(' a ');
    const resumen = p.headline || (p.description ? p.description.slice(0, 220).replace(/\s+/g, ' ') + '…' : 'sin resumen');
    return [
      `${i + 1}. ${p.event}`,
      `   Zona: ${p.areaDesc || 'no especificada'}`,
      `   Vigencia (hora de Sonora): ${vigencia}`,
      `   Resumen: ${resumen}`
    ].join('\n');
  }).join('\n\n');
}

const failure = (what, err) => `[No disponible: no se pudo consultar ${what}. Motivo: ${err && err.message ? err.message : 'error desconocido'}]`;

const fmtLat = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'N' : 'S');
const fmtLon = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'E' : 'O');
const fmtLocal = s => fmtShort(new Date(localStringToMs(s)));
const diaCorto = d => cap(dayFmt.format(new Date(d + 'T12:00:00Z')));
const listaNombres = arr => (arr.length ? `${arr.length} — ${arr.join(', ')}` : '0 — ninguno');

function frenteSection(e) {
  const L = [];
  if (e.simulacion) L.push('[SIMULACIÓN: la posición del frente es un ejemplo ficticio para probar el sistema; no es real.]');

  if (!e.smn.ok) {
    L.push(`- Oficial SMN: no disponible (${e.smn.error})`);
  } else {
    if (!e.smn.frentes.length) {
      L.push('- Oficial SMN: Sin frente frío anunciado por el SMN');
    } else {
      e.smn.frentes.forEach((f, i) => {
        const cuando = f.emitido ? `${fmtFull(new Date(f.emitido))} hora de Sonora` : 'fecha no disponible';
        L.push(`${i === 0 ? '- Oficial SMN: ' : '  '}Frente frío núm. ${f.numero} (aviso${f.noAviso ? ' No. ' + f.noAviso : ''} del ${cuando}; ${f.fuente})`);
        L.push(`    "${f.frase}"`);
      });
    }
    const caidas = e.smn.paginas.filter(p => !p.ok);
    if (caidas.length) L.push(`  (No se pudo leer ${caidas.map(p => `"${p.nombre}": ${p.error}`).join('; ')}; se usaron solo las páginas disponibles.)`);
  }

  if (!e.wpc.ok) {
    L.push(`- Posición WPC: no disponible (${e.wpc.error})`);
  } else {
    const w = e.wpc;
    const analisis = w.valido ? `análisis válido ${fmtFull(new Date(w.valido))}` : 'hora del análisis no disponible';
    const horas = w.valido ? Math.round((Date.now() - Date.parse(w.valido)) / 3600000) : null;
    const viejo = horas !== null && horas > 9 ? `, con ${horas} h de antigüedad` : '';
    L.push(`- Posición WPC (${analisis}${viejo}; ${w.fuente === 'simulación' ? 'SIMULACIÓN' : 'boletín codificado de frentes de superficie, WPC/NOAA'}):`);
    if (w.elementos.length) {
      L.push(`    Frentes y vaguadas a 600 km o menos de Sonora: ${w.elementos.length} (de ${w.totalElementos} en el boletín de Norteamérica)`);
      w.elementos.forEach((x, i) => {
        const a = x.puntos[0], b = x.puntos[x.puntos.length - 1];
        L.push(`    ${i + 1}. ${cap(x.tipoEs)}: ${x.distCajaKm === 0 ? 'cruza Sonora' : `a ${x.distCajaKm} km de Sonora`} (de ${fmtLat(a[0])} ${fmtLon(a[1])} a ${fmtLat(b[0])} ${fmtLon(b[1])})`);
      });
    } else if (w.masCercano) {
      L.push(`    Sin frentes ni vaguadas a 600 km o menos de Sonora; el más cercano es ${w.masCercano.tipoEs} a ${w.masCercano.distKm} km (cerca de ${fmtLat(w.masCercano.lat)} ${fmtLon(w.masCercano.lon)}), entre ${w.totalElementos} elementos del boletín.`);
    } else {
      L.push('    El boletín no trae frentes ni vaguadas.');
    }
    L.push('    (La clasificación de municipios usa solo los frentes fríos a 300 km o menos de Sonora.)');
  }
  (e.notas || []).forEach(n => L.push(`- Nota: ${n}`));

  const g = e.grupos;
  const total = e.municipios.length;
  const suma = g.encima.length + g.seAcerca.length + g.yaPaso.length + g.paso.length + g.aire.length + g.sinSenal.length;
  L.push(`- Municipios afectados (clasificación de los ${total}, cada uno en una sola categoría):`);
  L.push(`    Frente encima (WPC, a menos de 50 km): ${listaNombres(g.encima)}`);
  L.push(`    Se acerca (WPC, a 50-300 km, sin pasar): ${listaNombres(g.seAcerca)}`);
  L.push(`    Ya pasó (WPC): ${listaNombres(g.yaPaso)}`);

  if (!e.senales.ok) {
    L.push(`    Paso de frente probable y aire más seco/fresco: no disponible (${e.senales.error})`);
  } else {
    L.push(`    Paso de frente probable (subida de presión obligatoria y 3 de 4 señales; próximas 72 h, hora de Sonora): ${g.paso.length} municipio(s) en ${e.eventos.length} evento(s)`);
    if (!e.eventos.length) L.push('      Ningún municipio cumple los criterios.');
    e.eventos.forEach(ev => {
      L.push(`      Evento ${ev.numero} (${fmtLocal(ev.desde)} a ${fmtLocal(ev.hasta)}): ${ev.municipios.length} municipio(s)${ev.nota ? ` — Nota: ${ev.nota}` : ''}`);
      ev.municipios.forEach(m => L.push(`        ${m.municipio}: ${fmtLocal(m.estimado)} — ${m.nSenales} de 4 señales: ${m.senales.map(s => s.texto).join('; ')}`));
    });

    const aire = e.municipios.filter(m => m.categoria === 'aire').sort((a, b) => a.aire.estimado.localeCompare(b.aire.estimado));
    L.push(`    Aire más seco/fresco (2 señales, o 3 sin subida de presión; no es paso de frente): ${aire.length ? aire.length : '0 — ninguno'}`);
    const porDia = new Map();
    aire.forEach(m => { const d = m.aire.estimado.slice(0, 10); porDia.set(d, [...(porDia.get(d) || []), `${m.municipio} (${m.aire.estimado.slice(11, 16)} h)`]); });
    porDia.forEach((items, d) => L.push(`      ${diaCorto(d)}: ${items.join(', ')}`));
  }
  L.push(`    ${e.senales.ok ? 'Sin señal' : 'Sin clasificar por falta de Open-Meteo'}: ${listaNombres(g.sinSenal)}`);
  L.push(`    Suma de categorías: ${suma} de ${total}${suma === total ? '' : ' (REVISAR: no coincide)'}`);

  if (e.senales.ok) {
    L.push('  Criterios: señales = viento del N/NO/NE sostenido 3 h, subida de presión de más de 3 hPa en 12 h (obligatoria para paso de frente), baja del punto de rocío de más de 5 °C en 12 h y baja de temperatura de 5 °C o más; cada una se confirma contra la misma hora del día anterior para descartar el ciclo día-noche. Eventos distintos: más de 36 h entre pasos de un mismo municipio, o viento que pasa de N/NO a E/ENE. "Orden inconsistente": la mediana de los municipios del sur (lat. 28° o menos) llega más de 12 h antes que la de los del norte (lat. 30° o más).');
  }
  return L.join('\n');
}

export async function buildResumenFrio({ simular = false } = {}) {
  const [estadoR, frioR, azR] = await Promise.allSettled([loadFrenteEstado({ simular }), loadSonoraFrio(), loadAzAlerts()]);

  const parts = [];
  const now = new Date();
  parts.push('RESUMEN DE FRENTES FRÍOS, HELADAS Y VIENTO EN SONORA');
  parts.push(`Generado: ${fmtFull(now)} (hora de Sonora, UTC-7)`);
  parts.push('Fuentes: Servicio Meteorológico Nacional (texto oficial), WPC/NOAA (posición de frentes), Open-Meteo (temperatura, viento, presión, nieve; 72 municipios) y National Weather Service (avisos de Arizona). Datos con hasta 15 minutos de retraso por caché.');
  parts.push(`Versión visual: ${SITE}/frio.html`);
  parts.push('');

  const sep = '==================================================';

  parts.push(sep, 'ESTADO DEL FRENTE FRÍO', sep);
  parts.push(estadoR.status === 'rejected' ? failure('el estado del frente frío', estadoR.reason) : frenteSection(estadoR.value));
  parts.push('');

  if (frioR.status === 'rejected') {
    parts.push(sep, 'RESUMEN POR DÍA', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'TEMPERATURAS MÍNIMAS POR DÍA (72 MUNICIPIOS)', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'DESCENSO FUERTE DE TEMPERATURA', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'VIENTO', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'NIEVE EN LA SIERRA', sep, failure('los datos de Open-Meteo', frioR.reason), '');
  } else {
    const frio = frioR.value;
    parts.push(sep, 'RESUMEN POR DÍA', sep, resumenPorDiaSection(frio), '');
    parts.push(sep, 'TEMPERATURAS MÍNIMAS POR DÍA (72 MUNICIPIOS)', sep, minimasPorDiaSection(frio), '');
    parts.push(sep, `DESCENSO FUERTE DE TEMPERATURA (caída de ${DROP_UMBRAL} °C o más de un día a otro)`, sep, frentesSection(frio), '');
    parts.push(sep, 'VIENTO', sep, vientoSection(frio), '');
    parts.push(sep, 'NIEVE EN LA SIERRA', sep, nieveSection(frio), '');
  }

  parts.push(sep, 'AVISOS DE ARIZONA (NATIONAL WEATHER SERVICE)', sep);
  parts.push(azR.status === 'rejected' ? failure('los avisos activos del NWS para Arizona', azR.reason) : alertasSection(azR.value));
  parts.push('');

  const ok = estadoR.status === 'fulfilled' && !estadoR.value.hayError && frioR.status === 'fulfilled' && azR.status === 'fulfilled';
  return { text: parts.join('\n'), ok };
}

export async function respondResumenFrio(req, res) {
  try {
    const simular = String(req.query?.simular || '') === '1';
    const { text, ok } = await buildResumenFrio({ simular });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    // Si alguna fuente falló (o es una simulación), la respuesta no se guarda en caché.
    res.setHeader('Cache-Control', ok && !simular ? 's-maxage=900, stale-while-revalidate=300' : 'no-store');
    res.status(200).send(text);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send(`No se pudo generar el resumen de frío. Motivo: ${err.message || 'error desconocido'}`);
  }
}

export default respondResumenFrio;
