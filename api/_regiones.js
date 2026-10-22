import { MUNICIPIOS } from './_municipios.js';

// Regiones del resumen del pronóstico (la sierra baja del centro-oriente se separó de la sierra el 22 de oct de 2026). Edita las listas y el resto se ajusta solo.
// Un municipio puede estar en más de una región (por ejemplo costa + valle); los nombres son los de _municipios.js.
export const REGIONES = {
  'Valles del centro': [
    'Hermosillo', 'Ures', 'Carbó', 'Mazatán', 'La Colorada', 'San Miguel de Horcasitas', 'Villa Pesqueira', 'Rayón',
    'Opodepe', 'Baviácora', 'Aconchi', 'San Felipe de Jesús', 'Huépac', 'Banámichi'
  ],
  'Valles del sur': [
    'Cajeme', 'Navojoa', 'Etchojoa', 'Huatabampo', 'Bácum', 'Benito Juárez', 'San Ignacio Río Muerto', 'Álamos', 'Quiriego', 'Rosario'
  ],
  'Occidente / planicie del noroeste': [
    'Caborca', 'Pitiquito', 'Altar', 'Puerto Peñasco', 'San Luis Río Colorado', 'General Plutarco Elías Calles',
    'Oquitoa', 'Átil', 'Tubutama', 'Trincheras', 'Sáric'
  ],
  'Costa': [
    'Guaymas', 'Empalme', 'Puerto Peñasco', 'Huatabampo', 'Etchojoa'
  ],
  'Norte / frontera': [
    'Nogales', 'Santa Cruz', 'Cananea', 'Naco', 'Agua Prieta', 'Ímuris', 'Magdalena', 'Santa Ana', 'Cucurpe', 'Benjamín Hill', 'Sáric'
  ],
  'Noreste': [
    'Fronteras', 'Nacozari de García', 'Bacoachi', 'Arizpe', 'Villa Hidalgo', 'Bavispe', 'Bacerac', 'Huachinera', 'Cumpas', 'Moctezuma'
  ],
  // Municipios de la sierra propiamente dicha (mayor elevación).
  'Sierra del oriente': [
    'Yécora', 'Nácori Chico', 'Bacadéhuachi', 'Divisaderos', 'San Javier', 'Tepache', 'Moctezuma'
  ],
  // Municipios de la sierra baja y valles del centro-oriente (menos de ~550 m, con máximas de 36-38 °C).
  'Sierra baja del centro-oriente': [
    'Soyopa', 'Ónavas', 'Suaqui Grande', 'San Pedro de la Cueva', 'Bacanora', 'Sahuaripa', 'Arivechi', 'Huásabas', 'Granados'
  ]
};

// Municipios de cada región (objetos completos de _municipios.js), en el orden de la lista.
export function municipiosPorRegion() {
  const porNombre = new Map(MUNICIPIOS.map((m, i) => [m.municipio, { ...m, indice: i }]));
  return Object.fromEntries(Object.entries(REGIONES).map(([region, nombres]) => [region, nombres.map(n => porNombre.get(n)).filter(Boolean)]));
}

// Problemas de la configuración: nombres que no existen y municipios sin región. Debe devolver [].
export function validarRegiones() {
  const existentes = new Set(MUNICIPIOS.map(m => m.municipio));
  const asignados = new Set();
  const problemas = [];
  for (const [region, nombres] of Object.entries(REGIONES)) {
    nombres.forEach(n => { if (!existentes.has(n)) problemas.push(`"${n}" (en ${region}) no existe en _municipios.js`); else asignados.add(n); });
    const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i);
    repetidos.forEach(n => problemas.push(`"${n}" aparece repetido en ${region}`));
  }
  MUNICIPIOS.forEach(m => { if (!asignados.has(m.municipio)) problemas.push(`"${m.municipio}" no tiene región`); });
  return problemas;
}
