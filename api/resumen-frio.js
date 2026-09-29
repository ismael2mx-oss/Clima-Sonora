import { loadSonoraFrio } from './_frio-data.js';

const TZ = 'America/Hermosillo';
const SITE = 'https://clima-sonora-6fne.vercel.app';
const DROP_UMBRAL = 8; // °C, caída día a día para considerarse llegada de frente frío
const GUST_TOLVANERA = 50; // km/h

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
      hits.push(`${m.municipio}: ${bits.join('; ')}`);
    });
    if (hits.length) {
      alguno = true;
      out.push(`--- Llega ${dayLabel(frio.dias, k)} ---`);
      out.push(...hits);
      out.push('');
    }
  });
  if (!alguno) return `Sin caídas de ${DROP_UMBRAL} °C o más de un día a otro en los próximos 5 días (según el pronóstico actual).`;
  return out.join('\n').trimEnd();
}

function vientoSection(frio) {
  const out = [];
  frio.dias.forEach((_, k) => {
    const idx = k + 1;
    const rows = frio.municipios
      .map(m => ({ name: m.municipio, gust: m.gust[idx], dir: m.windDir[idx] }))
      .filter(r => Number.isFinite(r.gust))
      .sort((a, b) => b.gust - a.gust);

    out.push(`--- ${dayLabel(frio.dias, k)} ---`);
    if (!rows.length) {
      out.push('Sin datos de viento disponibles para este día.');
    } else {
      const tolvaneras = rows.filter(r => r.gust >= GUST_TOLVANERA).length;
      out.push(`Municipios con racha de ${GUST_TOLVANERA} km/h o más (posible tolvanera): ${tolvaneras} de ${rows.length}`);
      out.push('Municipios de mayor a menor racha (racha máxima; dirección dominante):');
      rows.forEach((r, i) => {
        const tag = r.gust >= GUST_TOLVANERA ? ' — posible tolvanera' : '';
        out.push(`${String(i + 1).padStart(3, ' ')}. ${r.name}: ${round1(r.gust)} km/h, ${dir16(r.dir)}${tag}`);
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

export async function buildResumenFrio() {
  const [frioR, azR] = await Promise.allSettled([loadSonoraFrio(), loadAzAlerts()]);

  const parts = [];
  const now = new Date();
  parts.push('RESUMEN DE FRENTES FRÍOS, HELADAS Y VIENTO EN SONORA');
  parts.push(`Generado: ${fmtFull(now)} (hora de Sonora, UTC-7)`);
  parts.push('Fuentes: Open-Meteo (temperatura, viento y nieve, 72 municipios) y National Weather Service (avisos de Arizona). Datos con hasta 15 minutos de retraso por caché.');
  parts.push(`Versión visual: ${SITE}/frio.html`);
  parts.push('');

  const sep = '==================================================';

  if (frioR.status === 'rejected') {
    parts.push(sep, 'RESUMEN POR DÍA', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'TEMPERATURAS MÍNIMAS POR DÍA (72 MUNICIPIOS)', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'LLEGADA DE FRENTE FRÍO', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'VIENTO', sep, failure('los datos de Open-Meteo', frioR.reason), '');
    parts.push(sep, 'NIEVE EN LA SIERRA', sep, failure('los datos de Open-Meteo', frioR.reason), '');
  } else {
    const frio = frioR.value;
    parts.push(sep, 'RESUMEN POR DÍA', sep, resumenPorDiaSection(frio), '');
    parts.push(sep, 'TEMPERATURAS MÍNIMAS POR DÍA (72 MUNICIPIOS)', sep, minimasPorDiaSection(frio), '');
    parts.push(sep, `LLEGADA DE FRENTE FRÍO (caída de ${DROP_UMBRAL} °C o más de un día a otro)`, sep, frentesSection(frio), '');
    parts.push(sep, 'VIENTO', sep, vientoSection(frio), '');
    parts.push(sep, 'NIEVE EN LA SIERRA', sep, nieveSection(frio), '');
  }

  parts.push(sep, 'AVISOS DE ARIZONA (NATIONAL WEATHER SERVICE)', sep);
  parts.push(azR.status === 'rejected' ? failure('los avisos activos del NWS para Arizona', azR.reason) : alertasSection(azR.value));
  parts.push('');

  return parts.join('\n');
}

export default async function handler(req, res) {
  try {
    const text = await buildResumenFrio();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send(`No se pudo generar el resumen de frío. Motivo: ${err.message || 'error desconocido'}`);
  }
}
