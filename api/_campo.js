import { MUNICIPIOS } from './_municipios.js';
import { REGIONES } from './_regiones.js';
import { loadOpenMeteo, loadOpenMeteoRiego } from './_openmeteo.js';
import { loadLluviaDiaria } from './_lluvia.js';
import { estadoHorasFrio, asegurarHorasFrio } from './_horas-frio.js';

// Pronóstico para el campo: horas frío, heladas (5 días) y riego (ET0 menos lluvia, 5 días).
// Las tres vistas salen de /api/sonora-lluvia?vista=campo-frio | campo-heladas | campo-riego y alimentan campo.html y /api/resumen-campo.

const finito = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const r1 = v => (finito(v) ? Math.round(Number(v) * 10) / 10 : null);
const cabeceraDe = new Map(MUNICIPIOS.map(m => [m.municipio, m.cabecera]));

// ---------- Heladas ----------
export const NIVELES_HELADA = [
  { id: 'sin', emoji: '🟢', nombre: 'Sin helada', rango: 'más de 2 °C', color: '#4CAF7D' },
  { id: 'riesgo', emoji: '🟡', nombre: 'Riesgo', rango: '0 a 2 °C', color: '#E6C84C' },
  { id: 'ligera', emoji: '🟠', nombre: 'Ligera', rango: '0 a −2 °C', color: '#F0933E' },
  { id: 'moderada', emoji: '🔴', nombre: 'Moderada', rango: '−2 a −5 °C', color: '#E0524B' },
  { id: 'severa', emoji: '🟣', nombre: 'Severa', rango: 'menos de −5 °C', color: '#9B59D0' }
];
export const ORDEN_NIVEL = Object.fromEntries(NIVELES_HELADA.map((n, i) => [n.id, i]));

/** Nivel según la temperatura mínima pronosticada. En los límites se toma el nivel más frío (0 °C ya es helada ligera; -2 °C, moderada). */
export function nivelHelada(t) {
  if (!finito(t)) return null;
  const x = Number(t);
  if (x > 2) return 'sin';
  if (x > 0) return 'riesgo';
  if (x > -2) return 'ligera';
  if (x >= -5) return 'moderada';
  return 'severa';
}

export const RECOMENDACIONES_HELADA = {
  riesgo: { ganado: 'Vigilar a las crías por la noche y revisar los bebederos al amanecer.', cultivos: 'Tener listo el material para cubrir plantas sensibles y seguir el pronóstico.' },
  ligera: { ganado: 'Proteger a las crías (refugio y cobertizo contra el viento) y revisar que no se congelen los bebederos.', cultivos: 'Riego ligero antes de la helada (el suelo húmedo conserva calor), cubrir plantas sensibles y proteger los frutales jóvenes.' },
  moderada: { ganado: 'Refugio y alimento extra para crías y animales débiles; romper el hielo de los bebederos varias veces al día.', cultivos: 'Riego antes de la helada, cubrir plantas y proteger frutales (cobertores, ventilación o calefacción donde se pueda); cosechar lo sensible si ya está listo.' },
  severa: { ganado: 'Resguardar crías y animales débiles en refugio cerrado, dar alimento extra y proteger bebederos y tuberías del hielo.', cultivos: 'Riego antes de la helada, doble cobertura de plantas, protección de frutales y brotes, y cosechar lo sensible; se esperan daños sin protección.' }
};

export async function vistaHeladas() {
  const om = await loadOpenMeteo();
  const todos = om.list[0]?.daily?.time || [];
  const dias = todos.slice(1, 6); // todos[0] es ayer: hoy es el índice 1
  const municipios = MUNICIPIOS.map((m, i) => {
    const min = (om.list[i]?.daily?.temperature_2m_min || []).slice(1, 6).map(r1);
    const nivel = min.map(nivelHelada);
    const peor = nivel.reduce((p, n) => (n && (p === null || ORDEN_NIVEL[n] > ORDEN_NIVEL[p]) ? n : p), null);
    const minimo = Math.min(...min.filter(finito));
    return { municipio: m.municipio, cabecera: m.cabecera, min, nivel, peor, minimo: Number.isFinite(minimo) ? minimo : null };
  });
  municipios.sort((a, b) => (a.minimo === null) - (b.minimo === null) || a.minimo - b.minimo || a.municipio.localeCompare(b.municipio, 'es'));
  return { vista: 'campo-heladas', dias, niveles: NIVELES_HELADA, recomendaciones: RECOMENDACIONES_HELADA, datosDe: om.datosDe, desdeCache: om.desdeCache, motivo: om.motivo, municipios };
}

// ---------- Riego (ET0) ----------
export async function vistaRiego() {
  const [et, ll] = await Promise.all([loadOpenMeteoRiego(), loadLluviaDiaria()]);
  const dias = et.list[0].daily.time.slice(0, 5);
  const idxLluvia = dias.map(d => ll.dias.indexOf(d));
  const municipios = MUNICIPIOS.map((m, i) => {
    const e = (et.list[i].daily.et0_fao_evapotranspiration || []).slice(0, 5).map(r1);
    const lm = ll.municipios[i];
    const lluvia = idxLluvia.map(k => (k >= 0 && lm ? r1(lm.mm[k]) : null));
    const balance = e.map((v, k) => (finito(v) && finito(lluvia[k]) ? r1(v - lluvia[k]) : null));
    const suma = a => (a.every(finito) ? r1(a.reduce((x, y) => x + Number(y), 0)) : null);
    return { municipio: m.municipio, cabecera: m.cabecera, et0: e, lluvia, balance, et0Total: suma(e), lluviaTotal: suma(lluvia), balanceTotal: suma(e) !== null && suma(lluvia) !== null ? r1(suma(e) - suma(lluvia)) : null };
  });
  municipios.sort((a, b) => (b.balanceTotal ?? -1e9) - (a.balanceTotal ?? -1e9) || a.municipio.localeCompare(b.municipio, 'es'));
  return {
    vista: 'campo-riego', dias, datosDe: et.datosDe, desdeCache: et.desdeCache, motivo: et.motivo, lluviaDesdeCache: ll.desdeCache, municipios,
    regiones: resumenPorRegion(municipios)
  };
}

function resumenPorRegion(municipios) {
  const porNombre = new Map(municipios.map(m => [m.municipio, m]));
  const media = a => { const v = a.filter(finito); return v.length ? r1(v.reduce((x, y) => x + Number(y), 0) / v.length) : null; };
  return Object.entries(REGIONES).map(([region, nombres]) => {
    const ms = nombres.map(n => porNombre.get(n)).filter(Boolean);
    const e = ms.map(m => m.et0Total).filter(finito);
    return {
      region, municipios: ms.length,
      et0Min: e.length ? Math.min(...e) : null, et0Max: e.length ? Math.max(...e) : null, et0Prom: media(ms.map(m => m.et0Total)),
      lluviaProm: media(ms.map(m => m.lluviaTotal)), balanceProm: media(ms.map(m => m.balanceTotal)),
      et0Dia: ms.length ? [0, 1, 2, 3, 4].map(k => media(ms.map(m => m.et0[k]))) : []
    };
  });
}

// ---------- Horas frío ----------
export async function vistaHorasFrio() {
  let heal = null;
  try { heal = await asegurarHorasFrio(); } catch (err) { heal = { errores: [err && err.message ? err.message : String(err)], temporadas: [] }; }
  const e = await estadoHorasFrio();
  const filas = e.filas.map(f => ({ ...f, cabecera: f.cabecera || cabeceraDe.get(f.municipio) }));
  const avisos = [];
  if (e.aviso) avisos.push(e.aviso);
  if (heal.errores && heal.errores.length) avisos.push(`Al actualizar los datos hubo avisos: ${heal.errores.join('; ')}`);
  return { vista: 'campo-frio', ...e, filas, avisos };
}

export const VISTAS_CAMPO = { 'campo-frio': vistaHorasFrio, 'campo-heladas': vistaHeladas, 'campo-riego': vistaRiego };
