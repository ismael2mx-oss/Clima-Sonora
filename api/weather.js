// Traduce un código de clima WMO (Open-Meteo) a un código equivalente de WeatherAPI,
// para poder reutilizar el mapeo de iconos (CODE_GROUPS) que ya existe en el frontend.
function wmoToWeatherApiCode(wmo) {
  if (wmo === 0) return 1000; // despejado
  if (wmo === 1 || wmo === 2) return 1003; // parcialmente nublado
  if (wmo === 3) return 1006; // nublado
  if (wmo === 45 || wmo === 48) return 1135; // niebla
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67].includes(wmo)) return 1063; // lluvia
  if ([80, 81, 82].includes(wmo)) return 1180; // chubascos
  if ([71, 73, 75, 77, 85, 86].includes(wmo)) return 1213; // nieve
  if ([95, 96, 99].includes(wmo)) return 1087; // tormenta
  return 1006;
}

async function fetchOpenMeteo(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability&daily=precipitation_probability_max,temperature_2m_max,temperature_2m_min,weathercode&timezone=America/Hermosillo&forecast_days=5`;
  const upstream = await fetch(url);
  if (!upstream.ok) return null;
  return upstream.json();
}

function mergeRain(data, om) {
  const days = data.forecast.forecastday;

  const dailyRainMap = new Map();
  (om?.daily?.time || []).forEach((date, i) => {
    dailyRainMap.set(date, om.daily.precipitation_probability_max[i]);
  });

  const hourlyRainMap = new Map();
  (om?.hourly?.time || []).forEach((time, i) => {
    hourlyRainMap.set(time, om.hourly.precipitation_probability[i]);
  });

  days.forEach(d => {
    if (dailyRainMap.has(d.date)) {
      d.day.daily_chance_of_rain = dailyRainMap.get(d.date);
    }
    (d.hour || []).forEach(h => {
      const key = h.time.replace(' ', 'T');
      if (hourlyRainMap.has(key)) {
        h.chance_of_rain = hourlyRainMap.get(key);
      }
    });
  });
}

function appendExtraDays(data, om) {
  const days = data.forecast.forecastday;
  const existingDates = new Set(days.map(d => d.date));
  const dailyTimes = om?.daily?.time || [];

  dailyTimes.forEach((date, i) => {
    if (existingDates.has(date)) return;
    days.push({
      date,
      day: {
        maxtemp_c: om.daily.temperature_2m_max[i],
        mintemp_c: om.daily.temperature_2m_min[i],
        daily_chance_of_rain: om.daily.precipitation_probability_max[i],
        condition: { code: wmoToWeatherApiCode(om.daily.weathercode[i]), text: '', icon: '' }
      },
      hour: []
    });
  });

  days.sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(req, res) {
  const apiKey = process.env.WEATHERAPI_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'Falta configurar WEATHERAPI_KEY en el servidor.' } });
    return;
  }

  const q = req.query.q;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: { message: 'Falta el parámetro de ciudad/coordenadas (q).' } });
    return;
  }

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${apiKey}&q=${encodeURIComponent(q)}&days=3&aqi=no&alerts=no&lang=es`;

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();

    if (upstream.ok) {
      try {
        const lat = data?.location?.lat;
        const lon = data?.location?.lon;
        if (lat !== undefined && lon !== undefined) {
          const om = await fetchOpenMeteo(lat, lon);
          if (om) {
            mergeRain(data, om);
            appendExtraDays(data, om);
          }
        }
      } catch (err) {
        // Si Open-Meteo falla, seguimos con lo que ya tenemos de WeatherAPI (3 días, sin ajuste de lluvia).
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: 'No se pudo contactar a WeatherAPI.' } });
  }
}
