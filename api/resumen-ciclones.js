import { loadPacificStorms, loadOutlookData } from './ciclones.js';
import { loadSonoraRain } from './sonora-lluvia.js';

const TZ = 'America/Hermosillo';
const SITE = 'https://clima-sonora-6fne.vercel.app';

const PORTS = {
  'Sonora': [['Puerto Peñasco', 31.32, -113.54], ['Bahía Kino', 28.83, -111.94], ['Guaymas', 27.92, -110.90], ['Yavaros', 26.70, -109.52]],
  'Península de Baja California': [['Ensenada', 31.87, -116.62], ['Guerrero Negro', 27.97, -114.04], ['Santa Rosalía', 27.34, -112.27], ['Loreto', 26.01, -111.35], ['Bahía Magdalena', 24.79, -112.11], ['La Paz', 24.14, -110.31], ['Cabo San Lucas', 22.89, -109.91]],
  'Costa continental (Sinaloa a Oaxaca)': [['Topolobampo', 25.60, -109.05], ['Mazatlán', 23.22, -106.42], ['Puerto Vallarta', 20.65, -105.23], ['Manzanillo', 19.05, -104.32], ['Zihuatanejo', 17.64, -101.55], ['Acapulco', 16.85, -99.88], ['Puerto Escondido', 15.86, -97.07], ['Salina Cruz', 16.17, -95.20]]
};
const ALL_PORTS = Object.values(PORTS).flat();

const CATS = [
  { max: 34, label: 'Depresión tropical' }, { max: 64, label: 'Tormenta tropical' },
  { max: 83, label: 'Huracán categoría 1' }, { max: 96, label: 'Huracán categoría 2' },
  { max: 113, label: 'Huracán categoría 3 (huracán mayor)' }, { max: 137, label: 'Huracán categoría 4 (huracán mayor)' },
  { max: Infinity, label: 'Huracán categoría 5 (huracán mayor)' }
];
const CLASS_LABELS = {
  TD: 'Depresión tropical', TS: 'Tormenta tropical', HU: 'Huracán', STD: 'Depresión subtropical',
  STS: 'Tormenta subtropical', PTC: 'Potencial ciclón tropical', PC: 'Ciclón postropical', PT: 'Ciclón postropical'
};
const WW = {
  TWA: 'Vigilancia de tormenta tropical', TWR: 'Aviso de tormenta tropical',
  HWA: 'Vigilancia de huracán', HWR: 'Aviso de huracán'
};
const RISK = { Low: 'baja', Medium: 'media', High: 'alta' };
const TZ_OFFSETS = { CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, HST: -10, EST: -5, EDT: -4, AST: -4, UTC: 0, GMT: 0 };
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];

const kmh = kt => Math.round(kt * 1.852);
const catLabel = kt => (CATS.find(c => kt < c.max) || CATS[CATS.length - 1]).label;
const fmtKm = v => Math.round(v).toLocaleString('es-MX') + ' km';
const dir16 = deg => DIR16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const fmtLat = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'N' : 'S');
const fmtLon = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'E' : 'O');
const dateTimeFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtFull = d => dateTimeFmt.format(d) + ' h';
const fmtShort = d => shortFmt.format(d) + ' h';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * rad) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lon2 - lon1) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

function parseValidLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM) \w+ (\w+)$/.exec(s || '');
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[6] === 'PM') h += 12;
  const off = TZ_OFFSETS[m[7]];
  if (off === undefined) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h - off, Number(m[5])));
}

function nearest(lat, lon, ports) {
  let best = null;
  ports.forEach(([name, la, lo]) => {
    const d = haversine(lat, lon, la, lo);
    if (!best || d < best.d) best = { d, name, la, lo };
  });
  return best;
}

function stormSection(s, index) {
  const feats = (s.points && s.points.features) || [];
  const p0 = feats.map(f => f.properties).find(p => Number(p.tau) === 0) || null;
  const gustKt = p0 && Number(p0.gust) > 0 && Number(p0.gust) < 9999 ? Number(p0.gust) : null;
  const cls = s.classification === 'HU' ? catLabel(s.intensityKt) : (CLASS_LABELS[s.classification] || catLabel(s.intensityKt));
  const L = [];
  L.push(`${index + 1}. ${s.name} (${s.id.toUpperCase()})`);
  L.push(`   Tipo/categoría: ${cls}`);
  L.push(`   Vientos sostenidos: ${kmh(s.intensityKt)} km/h (${s.intensityKt} kt)`);
  L.push(`   Rachas: ${gustKt ? `${kmh(gustKt)} km/h (${gustKt} kt)` : 'no disponible'}`);
  L.push(`   Presión mínima: ${Number.isFinite(s.pressureMb) ? s.pressureMb + ' hPa' : 'no disponible'}`);
  L.push(`   Ubicación: ${fmtLat(s.lat)} ${fmtLon(s.lon)} (${s.lat.toFixed(1)}, ${s.lon.toFixed(1)})`);

  const dist = Object.entries(PORTS).map(([region, ports]) => {
    const n = nearest(s.lat, s.lon, ports);
    return `${region}: ${fmtKm(n.d)} (${n.name})`;
  });
  L.push(`   Distancia a puertos de referencia (no a la línea de costa exacta): ${dist.join('; ')}`);

  L.push(`   Desplazamiento: hacia el ${dir16(s.movementDir)} (${s.movementDir}°) a ${kmh(s.movementSpeedKt)} km/h (${s.movementSpeedKt} kt)`);
  L.push(`   Último aviso del NHC: ${fmtFull(new Date(s.lastUpdate))}`);

  const ww = new Set(((s.warnings && s.warnings.features) || []).map(f => f.properties && f.properties.tcww).filter(t => WW[t]));
  L.push(`   Avisos/vigilancias costeras vigentes: ${ww.size ? Array.from(ww).map(t => WW[t]).join(', ') : 'ninguno'}`);

  if (feats.length) {
    const rows = feats.map(f => f.properties).sort((a, b) => Number(a.tau) - Number(b.tau));
    L.push('   Trayectoria pronosticada por el NHC (hora de Sonora):');
    rows.forEach(p => {
      const when = parseValidLabel(p.fldatelbl);
      const kt = Number(p.maxwind);
      L.push(`     +${String(p.tau).padStart(3, ' ')} h · ${when ? fmtShort(when) : 'hora n/d'} · ${Number.isFinite(kt) ? kmh(kt) + ' km/h (' + catLabel(kt) + ')' : 'viento n/d'}`);
    });
    const coords = feats.slice().sort((a, b) => Number(a.properties.tau) - Number(b.properties.tau))
      .map(f => `+${f.properties.tau} h: ${fmtLat(f.geometry.coordinates[1])} ${fmtLon(f.geometry.coordinates[0])}`);
    L.push('   Posiciones pronosticadas: ' + coords.join(' | '));
  }
  return L.join('\n');
}

function bboxOf(geom) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const walk = c => {
    if (typeof c[0] === 'number') {
      minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return { minLat, maxLat, minLon, maxLon };
}

function outlookSection(outlook) {
  const areas = (outlook && outlook.areas && outlook.areas.features) || [];
  if (!areas.length) return 'Sin zonas de posible formación marcadas por el NHC en el Pacífico.';
  return areas.map((f, i) => {
    const p = f.properties || {};
    const b = bboxOf(f.geometry);
    const cLat = (b.minLat + b.maxLat) / 2, cLon = (b.minLon + b.maxLon) / 2;
    const n = nearest(cLat, cLon, ALL_PORTS);
    const brg = dir16(bearing(n.la, n.lo, cLat, cLon));
    const issued = p.idp_filedate ? ` (perspectiva del NHC emitida ${fmtFull(new Date(Number(p.idp_filedate)))})` : '';
    return [
      `${i + 1}. Zona ${i + 1}${issued}`,
      `   Probabilidad de formación a 48 horas: ${p.prob2day || 'n/d'} (${RISK[p.risk2day] || p.risk2day || 'n/d'})`,
      `   Probabilidad de formación a 7 días: ${p.prob7day || 'n/d'} (${RISK[p.risk7day] || p.risk7day || 'n/d'})`,
      `   Ubicación general: centro aproximado en ${fmtLat(cLat)} ${fmtLon(cLon)}; extensión de ${fmtLat(b.minLat)} a ${fmtLat(b.maxLat)} y de ${fmtLon(b.minLon)} a ${fmtLon(b.maxLon)}`,
      `   Referencia: a unos ${fmtKm(n.d)} al ${brg} de ${n.name}`
    ].join('\n');
  }).join('\n\n');
}

function rainSection(rain) {
  const out = [];
  rain.dias.forEach((date, i) => {
    const rows = rain.municipios
      .map(m => ({ name: m.municipio, p: m.prob[i], mm: m.mm[i] }))
      .sort((a, b) => (Number.isFinite(b.p) ? b.p : -1) - (Number.isFinite(a.p) ? a.p : -1) || (b.mm || 0) - (a.mm || 0));
    const valid = rows.filter(r => Number.isFinite(r.p));
    const avg = valid.length ? valid.reduce((a, r) => a + r.p, 0) / valid.length : null;
    const wettest = valid[0];
    const mmTop = rows.reduce((best, r) => (Number.isFinite(r.mm) && (!best || r.mm > best.mm) ? r : best), null);
    const label = cap(dayFmt.format(new Date(date + 'T12:00:00Z')));
    const tag = i === 0 ? ' (HOY)' : i === 1 ? ' (MAÑANA)' : '';

    out.push(`--- ${label}${tag} ---`);
    out.push(`Promedio estatal de probabilidad máxima de lluvia: ${avg !== null ? avg.toFixed(1) + '%' : 'no disponible'}`);
    out.push(`Municipio más lluvioso (mayor probabilidad): ${wettest ? `${wettest.name} (${wettest.p}%)` : 'no disponible'}`);
    out.push(`Mayor acumulado esperado: ${mmTop ? `${mmTop.name} (${mmTop.mm.toFixed(1)} mm)` : 'no disponible'}`);
    out.push(`Municipios con 50% o más: ${valid.filter(r => r.p >= 50).length} de ${rows.length}`);
    out.push('Municipios de mayor a menor probabilidad (probabilidad máxima del día; acumulado esperado):');
    rows.forEach((r, k) => {
      out.push(`${String(k + 1).padStart(3, ' ')}. ${r.name}: ${Number.isFinite(r.p) ? r.p + '%' : 'sin dato'} (${Number.isFinite(r.mm) ? r.mm.toFixed(1) + ' mm' : 'sin dato'})`);
    });
    out.push('');
  });
  return out.join('\n').trimEnd();
}

const failure = (what, err) => `[No disponible: no se pudo consultar ${what}. Motivo: ${err && err.message ? err.message : 'error desconocido'}]`;

export default async function handler(req, res) {
  const [stormsR, outlookR, rainR] = await Promise.allSettled([
    loadPacificStorms(),
    loadOutlookData(),
    loadSonoraRain()
  ]);

  const parts = [];
  const now = new Date();

  parts.push('RESUMEN DE CICLONES TROPICALES DEL PACÍFICO Y LLUVIA EN SONORA');
  parts.push(`Generado: ${fmtFull(now)} (hora de Sonora, UTC-7)`);
  parts.push('Fuentes: NHC/NOAA (ciclones y perspectiva de formación) y Open-Meteo (lluvia). Datos con hasta 15 minutos de retraso por caché.');
  parts.push(`Versión interactiva con mapa, modelos y satélite: ${SITE}/ciclones.html`);
  parts.push('');

  parts.push('==================================================');
  parts.push('TORMENTAS ACTIVAS');
  parts.push('==================================================');
  if (stormsR.status === 'rejected') {
    parts.push(failure('las tormentas activas del NHC', stormsR.reason));
  } else if (!stormsR.value.storms.length) {
    parts.push('Sin tormentas activas.');
  } else {
    parts.push(`${stormsR.value.storms.length} sistema(s) activo(s) en el Pacífico (ordenados por intensidad):`);
    parts.push('');
    parts.push(stormsR.value.storms.map(stormSection).join('\n\n'));
  }
  parts.push('');

  parts.push('==================================================');
  parts.push('ZONAS DE FORMACIÓN (PERSPECTIVA A 7 DÍAS, PACÍFICO)');
  parts.push('==================================================');
  parts.push(outlookR.status === 'rejected' ? failure('las zonas de formación del NHC', outlookR.reason) : outlookSection(outlookR.value));
  parts.push('');

  parts.push('==================================================');
  parts.push('LLUVIA EN SONORA, PRÓXIMOS 5 DÍAS (72 MUNICIPIOS)');
  parts.push('==================================================');
  parts.push(rainR.status === 'rejected' ? failure('la lluvia de Open-Meteo', rainR.reason) : rainSection(rainR.value));
  parts.push('');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
  res.status(200).send(parts.join('\n'));
}
