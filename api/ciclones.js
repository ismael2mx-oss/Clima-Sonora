const NHC_JSON = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const NHC_GIS = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const HEADERS = { 'User-Agent': 'clima-sonora/1.0 (pronosticos Sonora)' };

let layerIdCache = null;

async function getLayerIds() {
  if (layerIdCache) return layerIdCache;
  const res = await fetch(`${NHC_GIS}/layers?f=json`, { headers: HEADERS });
  if (!res.ok) throw new Error('No se pudo leer el catálogo de capas del NHC.');
  const data = await res.json();
  const map = {};
  for (const l of data.layers || []) map[l.name] = l.id;
  layerIdCache = map;
  return map;
}

function roundCoords(c) {
  if (typeof c[0] === 'number') return [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000];
  return c.map(roundCoords);
}

async function queryLayer(id) {
  if (id === undefined) return { type: 'FeatureCollection', features: [] };
  try {
    const res = await fetch(`${NHC_GIS}/${id}/query?where=1%3D1&outFields=*&f=geojson`, { headers: HEADERS });
    if (!res.ok) return { type: 'FeatureCollection', features: [] };
    const gj = await res.json();
    (gj.features || []).forEach(f => {
      if (f.geometry && f.geometry.coordinates) f.geometry.coordinates = roundCoords(f.geometry.coordinates);
    });
    return gj.features ? gj : { type: 'FeatureCollection', features: [] };
  } catch (err) {
    return { type: 'FeatureCollection', features: [] };
  }
}

async function loadStorm(storm, ids) {
  const bin = storm.binNumber;
  const [cone, track, points, pastTrack, pastPoints, warnings] = await Promise.all([
    queryLayer(ids[`${bin} Forecast Cone`]),
    queryLayer(ids[`${bin} Forecast Track`]),
    queryLayer(ids[`${bin} Forecast Points`]),
    queryLayer(ids[`${bin} Past Track`]),
    queryLayer(ids[`${bin} Past Points`]),
    queryLayer(ids[`${bin} Watch-Warning`])
  ]);
  return {
    id: storm.id,
    bin,
    name: storm.name,
    classification: storm.classification,
    intensityKt: Number(storm.intensity),
    pressureMb: Number(storm.pressure),
    lat: storm.latitudeNumeric,
    lon: storm.longitudeNumeric,
    movementDir: storm.movementDir,
    movementSpeedKt: storm.movementSpeed,
    lastUpdate: storm.lastUpdate,
    links: {
      publicAdvisory: storm.publicAdvisory && storm.publicAdvisory.url,
      forecastAdvisory: storm.forecastAdvisory && storm.forecastAdvisory.url,
      forecastDiscussion: storm.forecastDiscussion && storm.forecastDiscussion.url,
      forecastGraphics: storm.forecastGraphics && storm.forecastGraphics.url,
      windSpeedProbabilities: storm.windSpeedProbabilities && storm.windSpeedProbabilities.url
    },
    cone, track, points, pastTrack, pastPoints, warnings
  };
}

async function loadOutlook(ids) {
  const [areas, motion, current] = await Promise.all([
    queryLayer(ids['Seven-Day: Potential Development Region']),
    queryLayer(ids['Seven-Day: Development Motion']),
    queryLayer(ids['Seven-Day: Current Location'])
  ]);
  const onlyPacific = fc => ({
    type: 'FeatureCollection',
    features: fc.features.filter(f => f.properties && f.properties.basin && /pacific/i.test(f.properties.basin))
  });
  return { areas: onlyPacific(areas), motion: onlyPacific(motion), current: onlyPacific(current) };
}

export async function loadOutlookData() {
  return loadOutlook(await getLayerIds());
}

export async function loadPacificStorms() {
  const [csRes, ids] = await Promise.all([fetch(NHC_JSON, { headers: HEADERS }), getLayerIds()]);
  if (!csRes.ok) throw new Error('No se pudo leer la lista de tormentas activas del NHC.');
  const cs = await csRes.json();

  const pacific = (cs.activeStorms || []).filter(s => /^(EP|CP)/i.test(s.binNumber || ''));
  const storms = await Promise.all(pacific.map(s => loadStorm(s, ids)));
  storms.sort((a, b) => b.intensityKt - a.intensityKt);
  return { storms, ids };
}

export default async function handler(req, res) {
  try {
    const { storms, ids } = await loadPacificStorms();
    const outlook = await loadOutlook(ids);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    res.status(200).json({ generado: new Date().toISOString(), storms, outlook });
  } catch (err) {
    res.status(502).json({ error: { message: err.message || 'No se pudo obtener la información del NHC.' } });
  }
}
