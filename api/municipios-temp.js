const MUNICIPIOS = [
  { "municipio": "Aconchi", "cabecera": "Aconchi", "lat": 29.8258, "lon": -110.2286 },
  { "municipio": "Agua Prieta", "cabecera": "Agua Prieta", "lat": 31.3278, "lon": -109.5464 },
  { "municipio": "Álamos", "cabecera": "Álamos", "lat": 27.0242, "lon": -108.9350 },
  { "municipio": "Altar", "cabecera": "Altar", "lat": 30.7133, "lon": -111.8336 },
  { "municipio": "Arivechi", "cabecera": "Arivechi", "lat": 28.9286, "lon": -109.1872 },
  { "municipio": "Arizpe", "cabecera": "Arizpe", "lat": 30.3361, "lon": -110.1669 },
  { "municipio": "Átil", "cabecera": "Átil", "lat": 30.8439, "lon": -111.5839 },
  { "municipio": "Bacadéhuachi", "cabecera": "Bacadéhuachi", "lat": 29.8092, "lon": -109.1408 },
  { "municipio": "Bacanora", "cabecera": "Bacanora", "lat": 28.9842, "lon": -109.4003 },
  { "municipio": "Bacerac", "cabecera": "Bacerac", "lat": 30.3553, "lon": -108.9297 },
  { "municipio": "Bacoachi", "cabecera": "Bacoachi", "lat": 30.6331, "lon": -109.9689 },
  { "municipio": "Bácum", "cabecera": "Bácum", "lat": 27.5506, "lon": -110.0828 },
  { "municipio": "Banámichi", "cabecera": "Banámichi", "lat": 30.0078, "lon": -110.2156 },
  { "municipio": "Baviácora", "cabecera": "Baviácora", "lat": 29.7153, "lon": -110.1650 },
  { "municipio": "Bavispe", "cabecera": "Bavispe", "lat": 30.4800, "lon": -108.9411 },
  { "municipio": "Benito Juárez", "cabecera": "Villa Juárez", "lat": 27.1278, "lon": -109.8425 },
  { "municipio": "Benjamín Hill", "cabecera": "Benjamín Hill", "lat": 30.1672, "lon": -111.1181 },
  { "municipio": "Caborca", "cabecera": "Heroica Caborca", "lat": 30.7142, "lon": -112.1483 },
  { "municipio": "Cajeme", "cabecera": "Ciudad Obregón", "lat": 27.4964, "lon": -109.9328 },
  { "municipio": "Cananea", "cabecera": "Heroica Ciudad de Cananea", "lat": 30.9828, "lon": -110.3017 },
  { "municipio": "Carbó", "cabecera": "Carbó", "lat": 29.6847, "lon": -110.9544 },
  { "municipio": "La Colorada", "cabecera": "La Colorada", "lat": 28.8028, "lon": -110.5806 },
  { "municipio": "Cucurpe", "cabecera": "Cucurpe", "lat": 30.3292, "lon": -110.7058 },
  { "municipio": "Cumpas", "cabecera": "Cumpas", "lat": 29.9936, "lon": -109.7825 },
  { "municipio": "Divisaderos", "cabecera": "Divisaderos", "lat": 29.6150, "lon": -109.4706 },
  { "municipio": "Empalme", "cabecera": "Empalme", "lat": 27.9575, "lon": -110.8161 },
  { "municipio": "Etchojoa", "cabecera": "Etchojoa", "lat": 26.9108, "lon": -109.6253 },
  { "municipio": "Fronteras", "cabecera": "Fronteras", "lat": 30.8983, "lon": -109.5600 },
  { "municipio": "General Plutarco Elías Calles", "cabecera": "Sonoyta", "lat": 31.8664, "lon": -112.8572 },
  { "municipio": "Granados", "cabecera": "Granados", "lat": 29.8622, "lon": -109.3106 },
  { "municipio": "Guaymas", "cabecera": "Heroica Guaymas", "lat": 27.9233, "lon": -110.8894 },
  { "municipio": "Hermosillo", "cabecera": "Hermosillo", "lat": 29.0750, "lon": -110.9583 },
  { "municipio": "Huachinera", "cabecera": "Huachinera", "lat": 30.2114, "lon": -108.9589 },
  { "municipio": "Huásabas", "cabecera": "Huásabas", "lat": 29.9042, "lon": -109.3014 },
  { "municipio": "Huatabampo", "cabecera": "Huatabampo", "lat": 26.8269, "lon": -109.6442 },
  { "municipio": "Huépac", "cabecera": "Huépac", "lat": 29.9114, "lon": -110.2136 },
  { "municipio": "Ímuris", "cabecera": "Ímuris", "lat": 30.7772, "lon": -110.8617 },
  { "municipio": "Magdalena", "cabecera": "Magdalena de Kino", "lat": 30.6303, "lon": -110.9694 },
  { "municipio": "Mazatán", "cabecera": "Mazatán", "lat": 29.0033, "lon": -110.1403 },
  { "municipio": "Moctezuma", "cabecera": "Moctezuma", "lat": 29.8022, "lon": -109.6803 },
  { "municipio": "Naco", "cabecera": "Naco", "lat": 31.3317, "lon": -109.9481 },
  { "municipio": "Nácori Chico", "cabecera": "Nácori Chico", "lat": 29.6864, "lon": -108.9786 },
  { "municipio": "Nacozari de García", "cabecera": "Nacozari de García", "lat": 30.3736, "lon": -109.6864 },
  { "municipio": "Navojoa", "cabecera": "Navojoa", "lat": 27.0817, "lon": -109.4456 },
  { "municipio": "Nogales", "cabecera": "Heroica Nogales", "lat": 31.3258, "lon": -110.9458 },
  { "municipio": "Ónavas", "cabecera": "Ónavas", "lat": 28.4606, "lon": -109.5294 },
  { "municipio": "Opodepe", "cabecera": "Opodepe", "lat": 29.9267, "lon": -110.6311 },
  { "municipio": "Oquitoa", "cabecera": "Oquitoa", "lat": 30.7419, "lon": -111.7347 },
  { "municipio": "Pitiquito", "cabecera": "Pitiquito", "lat": 30.6761, "lon": -112.0539 },
  { "municipio": "Puerto Peñasco", "cabecera": "Puerto Peñasco", "lat": 31.3067, "lon": -113.5400 },
  { "municipio": "Quiriego", "cabecera": "Quiriego", "lat": 27.5206, "lon": -109.2511 },
  { "municipio": "Rayón", "cabecera": "Rayón", "lat": 29.7144, "lon": -110.5736 },
  { "municipio": "Rosario", "cabecera": "Rosario de Tesopaco", "lat": 27.8406, "lon": -109.3708 },
  { "municipio": "Sahuaripa", "cabecera": "Sahuaripa", "lat": 29.0564, "lon": -109.2333 },
  { "municipio": "San Felipe de Jesús", "cabecera": "San Felipe de Jesús", "lat": 29.8586, "lon": -110.2411 },
  { "municipio": "San Ignacio Río Muerto", "cabecera": "San Ignacio Río Muerto", "lat": 27.8114, "lon": -110.2414 },
  { "municipio": "San Javier", "cabecera": "San Javier", "lat": 28.5953, "lon": -109.7394 },
  { "municipio": "San Luis Río Colorado", "cabecera": "San Luis Río Colorado", "lat": 32.4797, "lon": -114.7797 },
  { "municipio": "San Miguel de Horcasitas", "cabecera": "San Miguel de Horcasitas", "lat": 29.4886, "lon": -110.7272 },
  { "municipio": "San Pedro de la Cueva", "cabecera": "San Pedro de la Cueva", "lat": 29.2864, "lon": -109.7361 },
  { "municipio": "Santa Ana", "cabecera": "Santa Ana", "lat": 30.5439, "lon": -111.1211 },
  { "municipio": "Santa Cruz", "cabecera": "Santa Cruz", "lat": 31.2317, "lon": -110.5961 },
  { "municipio": "Sáric", "cabecera": "Sáric", "lat": 31.2028, "lon": -111.3792 },
  { "municipio": "Soyopa", "cabecera": "Soyopa", "lat": 28.7642, "lon": -109.6347 },
  { "municipio": "Suaqui Grande", "cabecera": "Suaqui Grande", "lat": 28.3956, "lon": -109.8883 },
  { "municipio": "Tepache", "cabecera": "Tepache", "lat": 29.5344, "lon": -109.5325 },
  { "municipio": "Trincheras", "cabecera": "Trincheras", "lat": 30.3986, "lon": -111.5314 },
  { "municipio": "Tubutama", "cabecera": "Tubutama", "lat": 30.8847, "lon": -111.4658 },
  { "municipio": "Ures", "cabecera": "Heroica Ciudad de Ures", "lat": 29.4281, "lon": -110.3894 },
  { "municipio": "Villa Hidalgo", "cabecera": "Villa Hidalgo", "lat": 30.1631, "lon": -109.3200 },
  { "municipio": "Villa Pesqueira", "cabecera": "Villa Pesqueira", "lat": 29.1183, "lon": -109.9689 },
  { "municipio": "Yécora", "cabecera": "Yécora", "lat": 28.3728, "lon": -108.9258 }
];

async function fetchMaxTemp(apiKey, m) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${m.lat},${m.lon}&days=1&aqi=no&alerts=no&lang=es`;
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return { ...m, maxtemp_c: null, chance_of_rain: null, condicion: null };
    const data = await upstream.json();
    const day = data?.forecast?.forecastday?.[0]?.day;
    return {
      municipio: m.municipio,
      cabecera: m.cabecera,
      maxtemp_c: day ? day.maxtemp_c : null,
      chance_of_rain: day ? day.daily_chance_of_rain : null,
      condicion: day ? day.condition.text : null
    };
  } catch (err) {
    return { municipio: m.municipio, cabecera: m.cabecera, maxtemp_c: null, chance_of_rain: null, condicion: null };
  }
}

async function fetchInBatches(apiKey, items, batchSize) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(m => fetchMaxTemp(apiKey, m)));
    results.push(...batchResults);
  }
  return results;
}

export default async function handler(req, res) {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'Falta configurar WEATHERAPI_KEY en el servidor.' } });
    return;
  }

  const resultados = await fetchInBatches(apiKey, MUNICIPIOS, 10);

  resultados.sort((a, b) => {
    if (a.maxtemp_c === null) return 1;
    if (b.maxtemp_c === null) return -1;
    return b.maxtemp_c - a.maxtemp_c;
  });

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');
  res.status(200).json({ generado: new Date().toISOString(), municipios: resultados });
}
