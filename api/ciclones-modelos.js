import { gunzipSync } from 'zlib';

const MODELS = {
  OFCL: 'NHC oficial',
  TVCN: 'Consenso TVCN',
  HCCA: 'Consenso HCCA',
  AVNI: 'GFS',
  AEMI: 'Media GEFS',
  HWFI: 'HWRF',
  HMNI: 'HMON',
  HFAI: 'HAFS-A',
  HFBI: 'HAFS-B',
  CMCI: 'CMC (Canadá)',
  UKXI: 'UKMET',
  NVGI: 'NAVGEM',
  CTCI: 'COAMPS-TC'
};

const MAX_TAU = 120;

function parseCoord(raw) {
  const s = raw.trim();
  const hemi = s.slice(-1);
  const val = parseInt(s.slice(0, -1), 10) / 10;
  if (Number.isNaN(val)) return null;
  return hemi === 'S' || hemi === 'W' ? -val : val;
}

function cycleToIso(dtg) {
  return `${dtg.slice(0, 4)}-${dtg.slice(4, 6)}-${dtg.slice(6, 8)}T${dtg.slice(8, 10)}:00:00Z`;
}

export default async function handler(req, res) {
  const id = String(req.query.id || '').toLowerCase();
  if (!/^(ep|cp|al)\d{6}$/.test(id)) {
    res.status(400).json({ error: { message: 'Identificador de tormenta inválido.' } });
    return;
  }

  try {
    const upstream = await fetch(`https://ftp.nhc.noaa.gov/atcf/aid_public/a${id}.dat.gz`, {
      headers: { 'User-Agent': 'clima-sonora/1.0 (pronosticos Sonora)' }
    });
    if (!upstream.ok) {
      res.setHeader('Cache-Control', 's-maxage=300');
      res.status(200).json({ id, models: [] });
      return;
    }

    const text = gunzipSync(Buffer.from(await upstream.arrayBuffer())).toString('latin1');

    const byTech = {};
    for (const line of text.split('\n')) {
      const f = line.split(',');
      if (f.length < 9) continue;
      const tech = f[4].trim();
      if (!MODELS[tech]) continue;
      const dtg = f[2].trim();
      const tau = parseInt(f[5], 10);
      if (Number.isNaN(tau) || tau < 0 || tau > MAX_TAU) continue;
      const lat = parseCoord(f[6]);
      const lon = parseCoord(f[7]);
      if (lat === null || lon === null) continue;

      let entry = byTech[tech];
      if (!entry || dtg > entry.dtg) {
        entry = byTech[tech] = { dtg, points: new Map() };
      }
      if (dtg === entry.dtg && !entry.points.has(tau)) {
        entry.points.set(tau, { tau, lat, lon, vmaxKt: parseInt(f[8], 10) || null });
      }
    }

    const models = Object.keys(MODELS)
      .filter(tech => byTech[tech] && byTech[tech].points.size >= 2)
      .map(tech => ({
        tech,
        label: MODELS[tech],
        cycle: cycleToIso(byTech[tech].dtg),
        points: Array.from(byTech[tech].points.values()).sort((a, b) => a.tau - b.tau)
      }));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json({ id, models });
  } catch (err) {
    res.status(502).json({ error: { message: 'No se pudieron leer los modelos del NHC.' } });
  }
}
