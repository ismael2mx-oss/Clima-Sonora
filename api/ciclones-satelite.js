const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

const LAYERS = {
  geocolor: { name: 'GOES-West_ABI_GeoColor', tms: 'GoogleMapsCompatible_Level7', maxNativeZoom: 7 },
  infrarrojo: { name: 'GOES-West_ABI_Band13_Clean_Infrared', tms: 'GoogleMapsCompatible_Level6', maxNativeZoom: 6 },
  sst: {
    name: 'GHRSST_L4_MUR_Sea_Surface_Temperature', tms: 'GoogleMapsCompatible_Level7', maxNativeZoom: 7,
    daily: true, legend: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_H.svg'
  },
  sstanom: {
    name: 'GHRSST_L4_MUR_Sea_Surface_Temperature_Anomalies', tms: 'GoogleMapsCompatible_Level7', maxNativeZoom: 7,
    daily: true, legend: 'https://gibs.earthdata.nasa.gov/legends/GHRSST_Sea_Surface_Temperature_Anomalies_H.svg'
  }
};

const CANDIDATES = 18;
const FRAMES = 12;
const CAPS_TTL_MS = 5 * 60 * 1000;

let capsCache = { at: 0, text: '' };

async function getCapabilities() {
  if (capsCache.text && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.text;
  const res = await fetch(`${GIBS}/wmts.cgi?SERVICE=WMTS&REQUEST=GetCapabilities`);
  if (!res.ok) throw new Error('GIBS no disponible.');
  capsCache = { at: Date.now(), text: await res.text() };
  return capsCache.text;
}

function layerBlock(xml, name) {
  const idx = xml.indexOf(`<ows:Identifier>${name}</ows:Identifier>`);
  if (idx < 0) return '';
  const start = xml.lastIndexOf('<Layer>', idx);
  const end = xml.indexOf('</Layer>', idx);
  return xml.slice(start, end);
}

function candidateTimes(block) {
  const ranges = [];
  const re = /<Value>([^<]+\/[^<]+\/PT(\d+)M)<\/Value>/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const [startIso, endIso] = m[1].split('/');
    ranges.push({ start: Date.parse(startIso), end: Date.parse(endIso), step: Number(m[2]) * 60000 });
  }
  ranges.sort((a, b) => b.end - a.end);

  const times = [];
  for (const r of ranges) {
    for (let t = r.end; t >= r.start && times.length < CANDIDATES; t -= r.step) times.push(t);
    if (times.length >= CANDIDATES) break;
  }
  return times;
}

async function frameHasData(layer, iso) {
  try {
    const res = await fetch(`${GIBS}/${layer.name}/default/${iso}/${layer.tms}/2/1/0.png`);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 2000;
  } catch (err) {
    return false;
  }
}

export default async function handler(req, res) {
  const key = String(req.query.capa || 'geocolor');
  const layer = LAYERS[key];
  if (!layer) {
    res.status(400).json({ error: { message: 'Capa de satélite no válida.' } });
    return;
  }

  try {
    const xml = await getCapabilities();
    const block = layerBlock(xml, layer.name);

    if (layer.daily) {
      const m = /<Default>(\d{4}-\d{2}-\d{2})<\/Default>/.exec(block);
      if (!m) throw new Error('Fecha no disponible.');
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
      res.status(200).json({ capa: key, layer: layer.name, tms: layer.tms, maxNativeZoom: layer.maxNativeZoom, daily: true, legend: layer.legend, frames: [m[1]] });
      return;
    }

    const isoTimes = candidateTimes(block).map(t => new Date(t).toISOString().replace('.000Z', 'Z'));

    const checks = await Promise.all(isoTimes.map(iso => frameHasData(layer, iso)));
    const frames = isoTimes.filter((_, i) => checks[i]).slice(0, FRAMES).reverse();

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    res.status(200).json({ capa: key, layer: layer.name, tms: layer.tms, maxNativeZoom: layer.maxNativeZoom, frames });
  } catch (err) {
    res.status(502).json({ error: { message: 'No se pudo consultar el satélite GOES-West.' } });
  }
}
