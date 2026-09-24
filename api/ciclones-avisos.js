import { loadPacificStorms } from './ciclones.js';

const SITE = 'https://clima-sonora-6fne.vercel.app';
const TZ = 'America/Hermosillo';
const TIERS = [1500, 1000, 500];
const RI_KT_24H = 30;
const MX_BOX = { latMin: 14.4, latMax: 32.8, lonMin: -118.8, lonMax: -92.2 };
const PRUNE_DAYS = 45;

const PORTS = [
  ['Puerto Peñasco', 31.32, -113.54], ['Bahía Kino', 28.83, -111.94], ['Guaymas', 27.92, -110.90], ['Yavaros', 26.70, -109.52],
  ['Ensenada', 31.87, -116.62], ['Guerrero Negro', 27.97, -114.04], ['Santa Rosalía', 27.34, -112.27], ['Loreto', 26.01, -111.35],
  ['Bahía Magdalena', 24.79, -112.11], ['La Paz', 24.14, -110.31], ['Cabo San Lucas', 22.89, -109.91]
];

const CATS = [
  { max: 34, label: 'Depresión tropical' }, { max: 64, label: 'Tormenta tropical' },
  { max: 83, label: 'Huracán categoría 1' }, { max: 96, label: 'Huracán categoría 2' },
  { max: 113, label: 'Huracán categoría 3' }, { max: 137, label: 'Huracán categoría 4' },
  { max: Infinity, label: 'Huracán categoría 5' }
];
const WW = {
  TWA: 'Vigilancia de tormenta tropical', TWR: 'Aviso de tormenta tropical',
  HWA: 'Vigilancia de huracán', HWR: 'Aviso de huracán'
};
const TZ_OFFSETS = { CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, HST: -10, EST: -5, EDT: -4, AST: -4, UTC: 0, GMT: 0 };
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

const kmh = kt => Math.round(kt * 1.852);
const catLabel = kt => (CATS.find(c => kt < c.max) || CATS[CATS.length - 1]).label;
const fmtKm = v => Math.round(v).toLocaleString('es-MX') + ' km';
const compass = deg => DIRS[Math.round(((deg % 360) / 45)) % 8];
const fmtLat = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'N' : 'S');
const fmtLon = v => Math.abs(v).toFixed(1) + '°' + (v >= 0 ? 'E' : 'O');
const timeFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtTime = d => timeFmt.format(d) + ' h';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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

function parseDtg(n) {
  const s = String(n);
  if (s.length !== 10) return null;
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10))));
}

function stormPath(s) {
  const pts = ((s.points && s.points.features) || [])
    .map(f => ({
      tau: Number(f.properties.tau),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      when: parseValidLabel(f.properties.fldatelbl)
    }))
    .filter(p => Number.isFinite(p.tau))
    .sort((a, b) => a.tau - b.tau);
  if (!pts.length || pts[0].tau !== 0) pts.unshift({ tau: 0, lat: s.lat, lon: s.lon, when: new Date(s.lastUpdate) });
  else { pts[0].lat = s.lat; pts[0].lon = s.lon; }
  return pts;
}

function proximity(s) {
  const path = stormPath(s);
  let now = null, best = null;
  path.forEach((p, idx) => PORTS.forEach(([name, la, lo]) => {
    const d = haversine(p.lat, p.lon, la, lo);
    if (idx === 0 && (!now || d < now.d)) now = { d, name };
    if (!best || d < best.d) best = { d, name, p, idx };
  }));
  return { now, best, last: path.length - 1 };
}

function proximityLines(s) {
  const { now, best, last } = proximity(s);
  const lines = [`Ahora: ${fmtKm(now.d)} de ${now.name} (Sonora o península).`];
  if (best.idx === 0) {
    lines.push('Según el pronóstico oficial, se aleja.');
  } else {
    const when = best.p.when ? fmtTime(best.p.when) : `+${best.p.tau} h`;
    const tail = best.idx === last ? 'sigue acercándose al final del pronóstico (5 días)' : 'mínima pronosticada';
    lines.push(`En el pronóstico: ${tail}, ${fmtKm(best.d)} de ${best.name}, ${when}.`);
  }
  return lines;
}

function summaryLines(s) {
  return [
    `${catLabel(s.intensityKt)} · ${kmh(s.intensityKt)} km/h (${s.intensityKt} kt) · ${Number.isFinite(s.pressureMb) ? s.pressureMb + ' mb' : 'presión n/d'}`,
    `Posición ${fmtLat(s.lat)} ${fmtLon(s.lon)} · se mueve al ${compass(s.movementDir)} a ${kmh(s.movementSpeedKt)} km/h`,
    `Aviso del NHC: ${fmtTime(new Date(s.lastUpdate))}`
  ];
}

function warningTypesForMexico(s) {
  const types = new Set();
  ((s.warnings && s.warnings.features) || []).forEach(f => {
    const t = f.properties && f.properties.tcww;
    if (!WW[t] || !f.geometry) return;
    const coords = f.geometry.type === 'LineString' ? f.geometry.coordinates : [];
    if (coords.some(([lon, lat]) => lat >= MX_BOX.latMin && lat <= MX_BOX.latMax && lon >= MX_BOX.lonMin && lon <= MX_BOX.lonMax)) types.add(t);
  });
  return types;
}

function rapidIntensification(s) {
  const pts = ((s.pastPoints && s.pastPoints.features) || [])
    .map(f => ({ dtg: parseDtg(f.properties.dtg), kt: Number(f.properties.intensity), raw: String(f.properties.dtg) }))
    .filter(p => p.dtg && Number.isFinite(p.kt))
    .sort((a, b) => a.dtg - b.dtg);
  if (pts.length < 2) return null;
  const latest = pts[pts.length - 1];
  const target = latest.dtg.getTime() - 24 * 3600 * 1000;
  const old = pts.find(p => p.dtg.getTime() === target);
  if (!old) return null;
  const delta = latest.kt - old.kt;
  return delta >= RI_KT_24H ? { delta, from: old.kt, to: latest.kt, day: latest.raw.slice(0, 8) } : null;
}

function evaluate(storms, sent) {
  const candidates = [];
  const add = (key, tipo, title, s, lines, extraKeys = []) => candidates.push({ key, tipo, title, storm: s.name, id: s.id, lines, extraKeys });

  for (const s of storms) {
    const name = s.name;

    for (const t of warningTypesForMexico(s)) {
      add(`ww:${s.id}:${t}`, 'Aviso costero', `${name}: ${WW[t].toLowerCase()} para México`, s,
        [`${WW[t]} en la costa mexicana del Pacífico.`, ...summaryLines(s), ...proximityLines(s)]);
    }

    const { now, best } = proximity(s);
    const minDist = Math.min(now.d, best.d);
    const satisfied = TIERS.filter(t => minDist <= t);
    if (satisfied.length) {
      const tightest = Math.min(...satisfied);
      add(`near:${s.id}:${tightest}`, 'Cercanía', `${name} a menos de ${tightest.toLocaleString('es-MX')} km de Sonora o la península`, s,
        [...summaryLines(s), ...proximityLines(s)], satisfied.map(t => `near:${s.id}:${t}`));
    }

    const kt = s.intensityKt;
    if (kt >= 137) {
      add(`int:${s.id}:C5`, 'Intensidad', `${name} alcanza categoría 5`, s, summaryLines(s), [`int:${s.id}:M`, `int:${s.id}:H`]);
    } else if (kt >= 96) {
      add(`int:${s.id}:M`, 'Intensidad', `${name} se convierte en huracán mayor`, s, summaryLines(s), [`int:${s.id}:H`]);
    } else if (kt >= 64) {
      add(`int:${s.id}:H`, 'Intensidad', `${name} alcanza categoría de huracán`, s, summaryLines(s));
    }

    const ri = rapidIntensification(s);
    if (ri) {
      add(`ri:${s.id}:${ri.day}`, 'Intensidad', `${name}: intensificación rápida`, s,
        [`Ganó ${kmh(ri.delta)} km/h (${ri.delta} kt) en 24 h: de ${kmh(ri.from)} a ${kmh(ri.to)} km/h.`, ...summaryLines(s)]);
    }

    add(`new:${s.id}`, 'Nuevo ciclón', `Nuevo ciclón en el Pacífico: ${name}`, s,
      [...summaryLines(s), ...proximityLines(s)]);
  }

  const order = { 'Aviso costero': 0, 'Cercanía': 1, 'Intensidad': 2, 'Nuevo ciclón': 3 };
  candidates.sort((a, b) => order[a.tipo] - order[b.tipo]);
  return candidates;
}

function summaryAlert(storms, tipo, intro) {
  const lines = storms.length
    ? storms.flatMap(s => [`${s.name}`, ...summaryLines(s).map(l => '  ' + l), ...proximityLines(s).map(l => '  ' + l)])
    : ['No hay ciclones activos en el Pacífico en este momento.'];
  return { key: '', tipo, title: intro, storm: '', lines, extraKeys: [] };
}

function renderEmail(alerts) {
  const single = alerts.length === 1;
  const subject = (single ? `Ciclones: ${alerts[0].title}` : `Ciclones: ${alerts.length} novedades - ${alerts[0].title}`).slice(0, 110);

  const badge = { 'Aviso costero': '#FF2D2D', 'Cercanía': '#FF9F1C', 'Intensidad': '#E0409A', 'Nuevo ciclón': '#4CC9A0', 'Prueba': '#7FB3E8', 'Sistema activado': '#7FB3E8' };
  const blocks = alerts.map(a => `
    <div style="background:#161F38;border:1px solid #2a3556;border-radius:12px;padding:16px;margin:0 0 14px">
      <span style="display:inline-block;background:${badge[a.tipo] || '#7FB3E8'};color:#0F1729;font:600 11px monospace;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px">${esc(a.tipo)}</span>
      <h2 style="margin:10px 0 8px;font:600 17px Arial,sans-serif;color:#F2EEE3">${esc(a.title)}</h2>
      ${a.lines.map(l => `<div style="font:14px/1.6 Arial,sans-serif;color:#d9d5c9;white-space:pre-wrap">${esc(l)}</div>`).join('')}
    </div>`).join('');

  const html = `<!doctype html><html><body style="margin:0;background:#0F1729;padding:20px">
    <div style="max-width:560px;margin:0 auto">
      <div style="font:11px monospace;letter-spacing:.16em;text-transform:uppercase;color:#8993A8;margin-bottom:6px">Océano Pacífico — NHC / NOAA</div>
      <h1 style="margin:0 0 16px;font:600 20px Arial,sans-serif;color:#F2EEE3">Avisos de ciclones tropicales</h1>
      ${blocks}
      <a href="${SITE}/ciclones.html" style="display:inline-block;background:#D7A24C;color:#0F1729;font:600 13px Arial,sans-serif;text-decoration:none;padding:10px 16px;border-radius:8px">Ver mapa, modelos y satélite</a>
      <div style="margin-top:16px;font:11px Arial,sans-serif;color:#8993A8">Horas en hora de Sonora. Distancias a puertos de referencia, no a la línea de costa. Fuente: NHC/NOAA.</div>
    </div></body></html>`;

  const text = alerts.map(a => `${a.tipo.toUpperCase()}: ${a.title}\n${a.lines.join('\n')}`).join('\n\n') + `\n\nMapa, modelos y satélite: ${SITE}/ciclones.html`;
  return { subject, html, text };
}

function readBody(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

export default async function handler(req, res) {
  const testMode = req.method === 'GET' || String(req.query.prueba || '') === '1';
  const prev = readBody(req);
  const sent = prev.sent && typeof prev.sent === 'object' && !Array.isArray(prev.sent) ? { ...prev.sent } : {};
  if (Object.keys(sent).length > 800) {
    res.status(400).json({ error: { message: 'Estado demasiado grande.' } });
    return;
  }

  try {
    const { storms } = await loadPacificStorms();
    const nowIso = new Date().toISOString();

    if (testMode) {
      const alert = summaryAlert(storms, 'Prueba', 'Correo de prueba: situación actual');
      const email = renderEmail([alert]);
      res.status(200).json({ modo: 'prueba', alerts: [alert], ...email, newState: prev, tormentas: storms.length });
      return;
    }

    const firstRun = !prev.init;
    const candidates = evaluate(storms, sent);
    const fresh = candidates.filter(c => !sent[c.key]);

    const newSent = { ...sent };
    for (const c of candidates) {
      if (firstRun || !sent[c.key]) newSent[c.key] = nowIso;
      c.extraKeys.forEach(k => { if (firstRun || !newSent[k]) newSent[k] = nowIso; });
    }
    const cutoff = Date.now() - PRUNE_DAYS * 24 * 3600 * 1000;
    Object.keys(newSent).forEach(k => { if (Date.parse(newSent[k]) < cutoff) delete newSent[k]; });

    let alerts;
    if (firstRun) {
      alerts = [summaryAlert(storms, 'Sistema activado', 'Avisos de ciclones activados: situación actual')];
      alerts[0].lines.push('', 'A partir de ahora recibirás un correo cuando haya un ciclón nuevo, avisos o vigilancias para México, cercanía a Sonora o la península (1,500 / 1,000 / 500 km) o cambios fuertes de intensidad.');
    } else {
      alerts = fresh;
    }

    const newState = { v: 1, init: true, sent: newSent };
    if (!alerts.length) {
      res.status(200).json({ modo: 'normal', alerts: [], newState, tormentas: storms.length });
      return;
    }
    const email = renderEmail(alerts);
    res.status(200).json({ modo: 'normal', alerts, ...email, newState, tormentas: storms.length });
  } catch (err) {
    res.status(502).json({ error: { message: err.message || 'No se pudo consultar el NHC.' } });
  }
}
