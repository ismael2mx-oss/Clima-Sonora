// Avisos vigentes del National Weather Service (EE. UU.) para los condados de Arizona que colindan con Sonora y para Maricopa.
// Se incluyen TODOS los tipos de aviso (tornado, tormenta severa, inundación, polvo, viento, calor, helada, etc.).
// La comparten /api/resumen-frio y /api/resumen-pronostico.

const TZ = 'America/Hermosillo';
const NWS_URL = 'https://api.weather.gov/alerts/active?area=AZ';
const HEADERS = { 'User-Agent': 'clima-sonora (https://clima-sonora-6fne.vercel.app)', 'Accept': 'application/geo+json' };

// Código SAME (FIPS) de cada condado vigilado y los municipios de Sonora con los que colinda.
export const CONDADOS = {
  '004003': { nombre: 'Cochise', sonora: ['Agua Prieta', 'Naco'] },
  '004023': { nombre: 'Santa Cruz', sonora: ['Nogales', 'Santa Cruz'] },
  '004019': { nombre: 'Pima', sonora: ['Sáric', 'General Plutarco Elías Calles (Sonoyta)'] },
  '004027': { nombre: 'Yuma', sonora: ['San Luis Río Colorado'] },
  '004013': { nombre: 'Maricopa', sonora: [] } // no colinda con Sonora; se vigila por pedido
};

const fmt = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const fmtHora = iso => (iso ? `${fmt.format(new Date(iso))} h` : 'sin definir');

async function pedir(url, intentos = 3, timeoutMs = 8000) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      ultimo = err.name === 'AbortError' ? new Error('tiempo de espera agotado') : err;
      if (i < intentos - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`No se pudo contactar al National Weather Service (${ultimo && ultimo.message ? ultimo.message : 'error desconocido'}).`);
}

// Gravedad por el nombre del aviso: Warning (0) > Watch (1) > Advisory (2) > otros (3: Statement, Outlook, etc.).
const rangoTipo = evento => (/warning/i.test(evento) ? 0 : /watch/i.test(evento) ? 1 : /advisory/i.test(evento) ? 2 : 3);
const TIPO_TXT = ['Warning (aviso: el fenómeno ocurre o es inminente)', 'Watch (vigilancia: condiciones favorables)', 'Advisory (precaución)', 'otro tipo'];
const RANGO_SEVERIDAD = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };

// Descripción estándar del tipo de aviso, cuando el texto del NWS no trae una sección de peligro.
function peligroEstandar(evento) {
  const e = evento.toLowerCase();
  if (e.includes('tornado')) return 'tornados posibles; en estas situaciones también hay riesgo de granizo y vientos dañinos';
  if (e.includes('severe thunderstorm')) return 'tormentas severas: granizo de 2.5 cm o más y/o ráfagas de 93 km/h (58 mph) o más';
  if (e.includes('flash flood')) return 'inundaciones repentinas';
  if (e.includes('flood')) return 'inundaciones';
  if (e.includes('dust')) return 'tormenta de polvo con visibilidad muy reducida';
  if (e.includes('wind')) return 'vientos fuertes';
  if (e.includes('heat')) return 'calor extremo';
  if (e.includes('freeze') || e.includes('frost')) return 'helada';
  if (e.includes('red flag')) return 'condiciones críticas de incendio';
  return null;
}

const compacta = s => String(s || '').replace(/\s+/g, ' ').trim();

// Resumen del peligro: sección HAZARD/WHAT/IMPACT del texto (avisos), parámetros de granizo y ráfagas, ciudades incluidas y descripción estándar.
function resumenPeligro(p) {
  const d = String(p.description || '');
  const partes = [];
  const sec = nombre => { const m = new RegExp(`\\* ?${nombre}\\.\\.\\.([\\s\\S]*?)(?=\\n\\* |\\n\\n|$)`, 'i').exec(d); return m ? compacta(m[1]) : null; };
  const what = sec('WHAT'), hazard = sec('HAZARD'), impact = sec('IMPACT'), source = sec('SOURCE');
  [['Qué', what], ['Peligro', hazard], ['Origen', source], ['Impacto', impact]].forEach(([k, v]) => { if (v) partes.push(`${k}: ${v}`); });
  const par = p.parameters || {};
  const un = k => (Array.isArray(par[k]) && par[k][0] ? par[k][0] : null);
  const extras = [];
  if (un('maxHailSize')) extras.push(`granizo máx. ${un('maxHailSize')} in`);
  if (un('maxWindGust')) extras.push(`ráfagas máx. ${un('maxWindGust')}`);
  if (un('tornadoDetection')) extras.push(`tornado: ${un('tornadoDetection')}`);
  if (un('flashFloodDetection')) extras.push(`inundación repentina: ${un('flashFloodDetection')}`);
  if (extras.length) partes.push(`Parámetros del NWS: ${extras.join('; ')}`);
  const ciudades = /THIS INCLUDES THE (?:CITIES|CITY) OF ([\s\S]*?)(?:\.\s*\n|\.\s*$|\n\n)/i.exec(d);
  if (ciudades) partes.push(`Ciudades incluidas: ${compacta(ciudades[1]).toLowerCase().replace(/(^|[ ,.-])([a-záéíóú])/g, (m, a, b) => a + b.toUpperCase()).replace(/ And /g, ' y ')}`);
  if (!what && !hazard) {
    const std = peligroEstandar(p.event || '');
    if (std) partes.push(`Peligro (descripción estándar del tipo de aviso): ${std}`);
    if (!partes.length && d) partes.push(compacta(d).slice(0, 300));
  }
  return partes.join(' | ') || 'sin detalle';
}

/**
 * Devuelve { alertas, totalAz, otros, descargadoEn }. `alertas` solo trae las que tocan alguno de los condados vigilados,
 * ya ordenadas (Warning > Watch > Advisory; dentro de cada tipo, primero las que colindan con Sonora, luego por severidad y fin).
 */
export async function loadAvisosAz() {
  const data = await pedir(NWS_URL);
  const feats = data.features || [];
  const alertas = [];
  for (const f of feats) {
    const p = f.properties || {};
    const same = (p.geocode && p.geocode.SAME) || [];
    const codigos = same.filter(c => CONDADOS[c]);
    if (!codigos.length) continue;
    const condados = codigos.map(c => CONDADOS[c].nombre);
    // Si el aviso es por condado completo ("Cochise, AZ") colinda con seguridad; si es por zonas (p. ej. "Upper Gila River and
    // Aravaipa Valleys") puede no incluir la parte del condado que toca a Sonora.
    const nombresArea = String(p.areaDesc || '').split(';').map(x => x.trim());
    const completo = codigos.filter(c => nombresArea.includes(CONDADOS[c].nombre + ', AZ'));
    const municipios = Array.from(new Set(completo.flatMap(c => CONDADOS[c].sonora)));
    const posibles = Array.from(new Set(codigos.filter(c => !completo.includes(c)).flatMap(c => CONDADOS[c].sonora)));
    alertas.push({
      id: p.id,
      evento: p.event || 'Aviso',
      tipo: rangoTipo(p.event || ''),
      severidad: p.severity || 'Unknown',
      urgencia: p.urgency || null,
      emisor: p.senderName || null,
      condados,
      zonas: compacta(p.areaDesc),
      inicio: p.onset || p.effective || null,
      fin: p.ends || p.expires || null,
      peligro: resumenPeligro(p),
      colindaConSonora: municipios.length > 0,
      municipiosSonora: municipios,
      posibleColindancia: municipios.length === 0 && posibles.length > 0,
      municipiosPosibles: posibles
    });
  }
  alertas.sort((a, b) => a.tipo - b.tipo || Number(b.colindaConSonora) - Number(a.colindaConSonora) || Number(b.posibleColindancia) - Number(a.posibleColindancia) || (RANGO_SEVERIDAD[a.severidad] ?? 4) - (RANGO_SEVERIDAD[b.severidad] ?? 4) || String(a.fin).localeCompare(String(b.fin)));
  return { alertas, totalAz: feats.length, otros: feats.length - alertas.length, condados: Object.values(CONDADOS).map(c => c.nombre) };
}

// Lista de zonas completa; si pasa de ~420 caracteres se muestran las zonas que caben (nunca una zona cortada a la mitad)
// y se indica cuántas faltan ("y 5 zonas más").
function zonasTxt(areaDesc, max = 420) {
  const zonas = String(areaDesc || '').split(';').map(z => z.trim()).filter(Boolean);
  if (!zonas.length) return 'no especificadas';
  if (zonas.join('; ').length <= max) return zonas.join('; ');
  const mostradas = [];
  let largo = 0;
  for (const z of zonas) {
    const extra = (mostradas.length ? 2 : 0) + z.length;
    if (largo + extra > max && mostradas.length) break;
    mostradas.push(z);
    largo += extra;
  }
  const faltan = zonas.length - mostradas.length;
  return `${mostradas.join('; ')}${faltan > 0 ? ` y ${faltan} zona${faltan === 1 ? '' : 's'} más (${zonas.length} en total)` : ''}`;
}

export function textoAvisosAz(r) {
  const L = [];
  L.push(`Condados vigilados: ${Object.values(CONDADOS).map(c => c.nombre + (c.sonora.length ? '' : ' (no colinda con Sonora)')).join(', ')}. Se listan todos los tipos de aviso vigentes; horas en hora de Sonora (Arizona usa el mismo horario).`);
  if (!r.alertas.length) {
    L.push(`Sin avisos vigentes del NWS en esos condados (${r.totalAz} avisos activos en todo Arizona, ninguno en estos condados).`);
    return L.join('\n');
  }
  L.push(`${r.alertas.length} aviso(s) vigente(s) en esos condados, de ${r.totalAz} activos en todo Arizona (los de otros condados no se listan). Orden: Warning > Watch > Advisory; dentro de cada tipo, primero los que colindan con Sonora.`);
  r.alertas.forEach((a, i) => {
    L.push('');
    L.push(`${i + 1}. ${a.evento} — ${TIPO_TXT[a.tipo]}; severidad ${a.severidad}${a.urgencia ? `, urgencia ${a.urgencia}` : ''}${a.emisor ? `; emite ${a.emisor}` : ''}`);
    L.push(`   Condado(s) vigilado(s) afectado(s): ${a.condados.join(', ')}`);
    L.push(`   Zonas del aviso: ${zonasTxt(a.zonas)}`);
    L.push(`   Vigencia (hora de Sonora): ${fmtHora(a.inicio)} a ${fmtHora(a.fin)}`);
    L.push(`   Colinda con municipios de Sonora: ${a.colindaConSonora ? `SÍ — ${a.municipiosSonora.join(', ')} (aviso para el condado completo)` : a.posibleColindancia ? `NO CONFIRMADO — el aviso es por zonas del condado y puede no incluir la parte que colinda con ${a.municipiosPosibles.join(', ')}; revisa las zonas` : 'no'}`);
    L.push(`   Resumen del peligro: ${a.peligro}`);
  });
  return L.join('\n');
}
