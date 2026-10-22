import { MODELOS } from './_openmeteo.js';
import { municipiosPorRegion } from './_regiones.js';
import { compass, fold, dividirOraciones } from './_frente-data.js';

// Cálculos del resumen del pronóstico: por región (a partir de las series horarias de Open-Meteo), comparación de
// modelos, tendencia y lectura del texto del SMN. Son funciones puras: reciben datos ya descargados.

const TZ = 'America/Hermosillo';
export const UMBRALES = { lluviaMm: 1.0, rachaKmh: 50, tmaxC: 40, estableC: 1.0, tormentaDesde: 95, tormentaHasta: 99 };

// ---------- utilidades ----------
const hora2 = h => String(h).padStart(2, '0');
const ok = Number.isFinite;

export function fechaLocal(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Mejor valor (máximo o mínimo) de un arreglo entre los índices i y j (inclusive): { v, k } o null.
function extremo(arr, i, j, tipo) {
  let mejor = null;
  for (let k = Math.max(0, i); k <= Math.min(arr.length - 1, j); k++) {
    const v = arr[k];
    if (ok(v) && (mejor === null || (tipo === 'max' ? v > mejor.v : v < mejor.v))) mejor = { v, k };
  }
  return mejor;
}
function promedio(arr, i, j) {
  const v = arr.slice(Math.max(0, i), j + 1).filter(ok);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const redondea = (v, d = 1) => (ok(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// ---------- métricas de un municipio (día de hoy en hora de Sonora) ----------
// t0 = índice de las 00:00 de hoy en las series horarias (que empiezan ayer a las 00:00 y llegan hasta mañana 23:00).
export function metricasMunicipio(h, t0) {
  const T = h.temperature_2m || [], RH = h.relative_humidity_2m || [], CC = h.cloud_cover || [], P = h.precipitation || [];
  const PP = h.precipitation_probability || [], WC = h.weather_code || [], WS = h.wind_speed_10m || [], G = h.wind_gusts_10m || [], D = h.wind_direction_10m || [];
  const hoy = [t0, t0 + 23];
  const horasDonde = (arr, fn) => { const out = []; for (let k = hoy[0]; k <= hoy[1]; k++) if (ok(arr[k]) && fn(arr[k])) out.push(k - t0); return out; };
  const con = (e, dir) => (e ? { v: e.v, hora: e.k - t0, dir: dir && ok(dir[e.k]) ? compass(dir[e.k]) : null } : null);
  return {
    tmaxHoy: extremo(T, t0, t0 + 23, 'max'),
    tmaxAyer: extremo(T, t0 - 24, t0 - 1, 'max'),
    tmaxManana: extremo(T, t0 + 24, t0 + 47, 'max'),
    tminNoche: extremo(T, t0 + 18, t0 + 33, 'min'),        // 18:00 de hoy a 09:00 de mañana
    tminNochePrev: extremo(T, t0 - 6, t0 + 9, 'min'),      // 18:00 de ayer a 09:00 de hoy
    rhTarde: extremo(RH, t0 + 12, t0 + 19, 'min'),
    nubesTarde: promedio(CC, t0 + 12, t0 + 19),
    viento: con(extremo(WS, hoy[0], hoy[1], 'max'), D),
    racha: con(extremo(G, hoy[0], hoy[1], 'max'), D),
    horasLluvia: horasDonde(P, v => v >= 0.1),
    horasTormenta: horasDonde(WC, v => v >= UMBRALES.tormentaDesde && v <= UMBRALES.tormentaHasta),
    probPico: extremo(PP, hoy[0], hoy[1], 'max')
  };
}

// Franjas horarias contiguas a partir de una lista de horas del día: [15,16,17,20] -> "15:00–18:00 h y 20:00–21:00 h".
export function franjasTxt(horas) {
  const h = Array.from(new Set(horas)).sort((a, b) => a - b);
  if (!h.length) return null;
  const grupos = [];
  h.forEach(x => { const g = grupos[grupos.length - 1]; if (g && x === g[1] + 1) g[1] = x; else grupos.push([x, x]); });
  return grupos.map(([a, b]) => (b >= 22 && grupos.length === 1 ? `a partir de las ${hora2(a)}:00 h` : a === b ? `${hora2(a)}:00 h (1 h)` : `${hora2(a)}:00–${hora2(b + 1)}:00 h`)).join(' y ');
}

// ---------- regiones ----------
function rangoConNombres(items, getValor) {
  const con = items.map(m => ({ m, v: getValor(m) })).filter(x => ok(x.v));
  if (!con.length) return null;
  const min = con.reduce((a, b) => (b.v < a.v ? b : a));
  const max = con.reduce((a, b) => (b.v > a.v ? b : a));
  return { min: redondea(min.v), minMun: min.m.municipio, max: redondea(max.v), maxMun: max.m.municipio, n: con.length };
}

/**
 * serie: lista de series horarias (por índice de municipio); lluvia: { municipios:[{prob[], mm[]}] } (fuente única);
 * Devuelve { regiones: { nombre: {...datos} } } con temperaturas, lluvia, viento, humedad, nubes y tendencia.
 */
export function calcularRegiones(serie, lluvia, ahoraMs = Date.now()) {
  const hoyStr = fechaLocal(ahoraMs);
  const tiempos = serie[0]?.time || [];
  const t0 = tiempos.indexOf(`${hoyStr}T00:00`);
  if (t0 < 24) throw new Error('las series horarias de Open-Meteo no incluyen el día de hoy y el de ayer completos');
  const porRegion = municipiosPorRegion();
  const regiones = {};
  for (const [nombre, munis] of Object.entries(porRegion)) {
    const items = munis.map(m => ({ municipio: m.municipio, met: metricasMunicipio(serie[m.indice] || {}, t0), lluvia: lluvia ? lluvia.municipios[m.indice] : null }));
    const n = items.length;

    const tmax = rangoConNombres(items, x => x.met.tmaxHoy?.v);
    const tmin = rangoConNombres(items, x => x.met.tminNoche?.v);
    const dTmax = rangoConNombres(items, x => (x.met.tmaxHoy && x.met.tmaxAyer ? x.met.tmaxHoy.v - x.met.tmaxAyer.v : null));
    const media = fn => { const v = items.map(fn).filter(ok); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const tendencia = {
      tmaxHoyVsAyer: redondea(media(x => (x.met.tmaxHoy && x.met.tmaxAyer ? x.met.tmaxHoy.v - x.met.tmaxAyer.v : null))),
      tmaxMananaVsHoy: redondea(media(x => (x.met.tmaxManana && x.met.tmaxHoy ? x.met.tmaxManana.v - x.met.tmaxHoy.v : null))),
      tminNocheVsPrevia: redondea(media(x => (x.met.tminNoche && x.met.tminNochePrev ? x.met.tminNoche.v - x.met.tminNochePrev.v : null))),
      tmaxMediaHoy: redondea(media(x => x.met.tmaxHoy?.v)),
      tmaxMediaAyer: redondea(media(x => x.met.tmaxAyer?.v)),
      tminMediaNoche: redondea(media(x => x.met.tminNoche?.v)),
      tminMediaPrevia: redondea(media(x => x.met.tminNochePrev?.v))
    };

    // Lluvia: probabilidad y acumulado del día completo (fuente única) + horas con lluvia y tormenta de las series horarias.
    let ll = null;
    if (lluvia) {
      const prob = rangoConNombres(items, x => x.lluvia?.prob?.[0]);
      const mm = rangoConNombres(items, x => x.lluvia?.mm?.[0]);
      const conLluvia = items.filter(x => ok(x.lluvia?.mm?.[0]) && x.lluvia.mm[0] >= UMBRALES.lluviaMm).map(x => x.municipio);
      const horas = items.flatMap(x => x.met.horasLluvia);
      const pico = items.map(x => (x.met.probPico ? { ...x.met.probPico, municipio: x.municipio } : null)).filter(Boolean).reduce((a, b) => (!a || b.v > a.v ? b : a), null);
      const tormenta = items.filter(x => x.met.horasTormenta.length);
      ll = {
        prob, mm, conLluvia,
        franja: franjasTxt(horas),
        picoProb: pico ? { v: pico.v, hora: pico.k - t0, municipio: pico.municipio } : null,
        tormenta: { municipios: tormenta.map(x => x.municipio), franja: franjasTxt(tormenta.flatMap(x => x.met.horasTormenta)) }
      };
    }

    const vientoMax = items.map(x => (x.met.viento ? { ...x.met.viento, municipio: x.municipio } : null)).filter(Boolean).reduce((a, b) => (!a || b.v > a.v ? b : a), null);
    const rachaMax = items.map(x => (x.met.racha ? { ...x.met.racha, municipio: x.municipio } : null)).filter(Boolean).reduce((a, b) => (!a || b.v > a.v ? b : a), null);
    const viento = {
      sostenido: vientoMax ? { v: redondea(vientoMax.v, 0), dir: vientoMax.dir, hora: vientoMax.hora, municipio: vientoMax.municipio } : null,
      racha: rachaMax ? { v: redondea(rachaMax.v, 0), dir: rachaMax.dir, hora: rachaMax.hora, municipio: rachaMax.municipio } : null,
      conRacha50: items.filter(x => x.met.racha && x.met.racha.v >= UMBRALES.rachaKmh).length
    };

    const rh = rangoConNombres(items, x => x.met.rhTarde?.v);
    const nub = rangoConNombres(items, x => x.met.nubesTarde);
    const nubMedia = media(x => x.met.nubesTarde);
    const nubes = nub ? { media: redondea(nubMedia, 0), min: nub.min, max: nub.max, clase: nubMedia < 20 ? 'despejado' : nubMedia <= 60 ? 'parcialmente nublado' : 'nublado' } : null;

    regiones[nombre] = { n, municipios: items.map(x => x.municipio), tmax, tmin, dTmax, tendencia, lluvia: ll, viento, humedad: rh, nubes };
  }
  return { hoy: hoyStr, regiones };
}

export function tendenciaTxt(delta, sustantivo) {
  if (!ok(delta)) return `${sustantivo}: sin dato`;
  const signo = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const dir = Math.abs(delta) < UMBRALES.estableC ? 'estables' : delta > 0 ? 'subiendo' : 'bajando';
  return `${sustantivo} ${dir} (${signo}${Math.abs(delta).toFixed(1)} °C en promedio)`;
}

// ---------- comparación de modelos ----------
// Para cada región y cada impacto, cuántos modelos (de los disponibles) tienen al menos un municipio sobre el umbral.
const IMPACTOS = [
  { id: 'lluvia', nombre: `Lluvia (≥${UMBRALES.lluviaMm} mm en el día)`, campo: 'precipitation_sum', umbral: UMBRALES.lluviaMm },
  { id: 'rachas', nombre: `Rachas ≥${UMBRALES.rachaKmh} km/h`, campo: 'wind_gusts_10m_max', umbral: UMBRALES.rachaKmh },
  { id: 'calor', nombre: `Máximas ≥${UMBRALES.tmaxC} °C`, campo: 'temperature_2m_max', umbral: UMBRALES.tmaxC }
];

export function compararModelos(listaModelos) {
  const porRegion = municipiosPorRegion();
  // Un modelo está "disponible" si trae algún dato numérico del campo para el día de hoy.
  const disponible = (m, campo) => listaModelos.some(l => ok(l?.daily?.[`${campo}_${m.id}`]?.[0]));
  const out = {};
  for (const [region, munis] of Object.entries(porRegion)) {
    out[region] = IMPACTOS.map(imp => {
      const modelos = MODELOS.filter(m => disponible(m, imp.campo));
      const coinciden = modelos.filter(m => munis.some(mu => {
        const v = listaModelos[mu.indice]?.daily?.[`${imp.campo}_${m.id}`]?.[0];
        return ok(v) && v >= imp.umbral;
      }));
      const n = coinciden.length, total = modelos.length;
      const veredicto = total === 0 ? 'sin datos de modelos' : n >= 2 ? (n === total && total >= 3 ? 'coinciden todos → mencionar (confianza alta)' : 'coinciden → mencionar (confianza media)') : n === 1 ? 'baja confianza → no mencionar' : 'ningún modelo';
      return { id: imp.id, nombre: imp.nombre, n, total, modelos: coinciden.map(m => m.nombre), mencionar: n >= 2, veredicto };
    });
  }
  return out;
}

// ---------- texto del SMN ----------
const SISTEMAS = [
  { nombre: 'Frente frío', re: /frentes?\s+frios?/ },
  { nombre: 'Canal / zona de baja presión', re: /canal(es)?\s+de\s+baja\s+presion|zonas?\s+de\s+baja\s+presion|baja\s+presion/ },
  { nombre: 'Alta presión / anticiclón', re: /alta\s+presion|anticicl/ },
  { nombre: 'Corriente en chorro', re: /corrientes?\s+en\s+chorro/ },
  { nombre: 'Vaguada / circulación ciclónica en altura', re: /vaguada|circulacion\s+ciclonica|baja\s+segregada|baja\s+desprendida/ },
  { nombre: 'Humedad del Pacífico / monzón / onda tropical', re: /humedad[^.]{0,80}(pacifico|litoral)|monzon|onda\s+tropical/ },
  { nombre: 'Masa de aire polar / ambiente frío', re: /masa\s+de\s+aire\s+(polar|frio)/ },
  { nombre: 'Ciclón tropical (mención del SMN)', re: /tormenta\s+tropical|huracan|depresion\s+tropical/ }
];
const recorta = (s, n = 420) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const mencionaSonora = s => /\bsonora\b/.test(fold(s));
const mencionaNoroeste = s => /\bnoroeste\b/.test(fold(s));

// Recorte de una oración centrado en la primera mención de Sonora (sin distinguir mayúsculas), para frases muy largas.
function extractoSonora(oracion, n = 360) {
  if (oracion.length <= n) return oracion;
  const i = fold(oracion).search(/sonora/);
  const ini = i >= 0 && i + 60 > n ? Math.max(0, i - Math.floor(n / 2)) : 0;
  const fin = Math.min(oracion.length, ini + n);
  return `${ini > 0 ? '…' : ''}${oracion.slice(ini, fin).trim()}${fin < oracion.length ? '…' : ''}`;
}

// Cláusula de una oración-lista ("Chubascos (25 a 50 mm): Sonora (noreste), Chihuahua (...)") que corresponde a Sonora.
function clausulaSonora(oracion) {
  const idx = fold(oracion).search(/sonora/);
  if (idx < 0) return null;
  const colon = oracion.indexOf(':');
  if (colon < 0 || colon > idx) return null;
  const ultimoColon = oracion.lastIndexOf(':', idx);
  if (idx - ultimoColon > 40) return null;
  const principal = oracion.slice(0, colon).trim();
  if (principal.length > 160) return null; // no es una lista por estado, sino un párrafo con dos puntos
  const prevSemi = oracion.lastIndexOf(';', idx);
  const segmento = prevSemi > colon ? oracion.slice(prevSemi + 1, idx).replace(/\s*:\s*$/, '').trim() : '';
  const q = /Sonora\s*\(([^)]*)\)/i.exec(oracion.slice(idx));
  return `${principal}${segmento ? ' / ' + segmento : ''}: Sonora${q ? ` (${q[1]})` : ''}`;
}

const ENCABEZADOS_REGION = ['Pacífico Centro', 'Pacífico Sur', 'Mesa del Norte', 'Mesa Central', 'Golfo de México', 'Península de Yucatán', 'Valle de México', 'Península de Baja California'];

export function analizarSmn(textos) {
  const general = textos.find(t => t.id === 'general' && t.ok);
  const extendido = textos.find(t => t.id === 'extendido' && t.ok);
  const r = {
    general: general ? { noAviso: general.noAviso, emitido: general.emitido } : null,
    extendido: extendido ? { noAviso: extendido.noAviso, emitido: extendido.emitido } : null,
    sistemas: [], pronosticoSonora: [], pacificoNorte: null, extendidoSonora: [],
    errores: textos.filter(t => !t.ok).map(t => `${t.nombre}: ${t.error}`)
  };

  // Sistemas: se buscan en las dos páginas. Cada oración que nombra a Sonora o al noroeste y contiene algún sistema se muestra
  // una sola vez, con los sistemas que menciona; primero las del aviso general y, dentro de cada página, las que nombran a Sonora.
  const candidatas = [];
  [general, extendido].filter(Boolean).forEach((p, orden) => dividirOraciones(p.texto).forEach(o => {
    if (!(mencionaSonora(o) || mencionaNoroeste(o))) return;
    const f = fold(o);
    const sistemas = SISTEMAS.filter(sis => sis.re.test(f)).map(sis => sis.nombre);
    if (sistemas.length) candidatas.push({ o, sistemas, fuente: p.nombre, orden });
  }));
  candidatas.sort((x, y) => x.orden - y.orden || Number(mencionaSonora(y.o)) - Number(mencionaSonora(x.o)));
  const porPagina = new Map();
  candidatas.forEach(c => { const l = porPagina.get(c.orden) || []; if (l.length < 3) { l.push(c); porPagina.set(c.orden, l); } });
  r.sistemas = [...porPagina.values()].flat().map(c => ({ sistemas: c.sistemas, texto: extractoSonora(c.o, 520), fuente: c.fuente, alcance: mencionaSonora(c.o) ? 'menciona Sonora' : 'menciona el noroeste del país, sin nombrar a Sonora' }));

  if (general) {
    // Avisos / pronósticos del SMN que nombran a Sonora (cláusula de las listas por estado o la oración completa).
    const vistos = new Set();
    for (const o of dividirOraciones(general.texto)) {
      if (!mencionaSonora(o)) continue;
      const c = clausulaSonora(o) || extractoSonora(o, 520);
      if (!vistos.has(c)) { vistos.add(c); r.pronosticoSonora.push(c); }
    }
    // Párrafo regional "Pacífico Norte" (donde el SMN describe Sonora).
    const ini = general.texto.search(/Pacífico Norte\s*:/);
    if (ini >= 0) {
      const resto = general.texto.slice(ini);
      const cortes = ENCABEZADOS_REGION.map(h => resto.indexOf(`${h}:`)).filter(i => i > 0);
      const fin = cortes.length ? Math.min(...cortes) : 1200;
      r.pacificoNorte = recorta(resto.slice(0, fin).trim(), 1400);
    }
  }
  if (extendido) {
    const vistos = new Set();
    for (const o of dividirOraciones(extendido.texto)) {
      if (!mencionaSonora(o)) continue;
      const c = clausulaSonora(o) || extractoSonora(o, 520);
      if (!vistos.has(c)) { vistos.add(c); r.extendidoSonora.push(c); }
    }
    r.extendidoSonora = r.extendidoSonora.slice(0, 8);
  }
  return r;
}

// Frases del SMN sobre descenso de temperatura que mencionan Sonora o el noroeste (para contrastar con los datos).
export function frasesDescenso(textos) {
  const out = [];
  for (const t of textos.filter(x => x.ok)) {
    for (const o of dividirOraciones(t.texto)) {
      const f = fold(o);
      if (/descenso|disminu|baja(n|ra)?\s+(la\s+)?temperatura|ambiente\s+(muy\s+)?frio|ambiente\s+fresco/.test(f) && (mencionaSonora(o) || mencionaNoroeste(o))) out.push({ fuente: t.nombre, texto: recorta(o, 300) });
    }
  }
  return out.slice(0, 4);
}
