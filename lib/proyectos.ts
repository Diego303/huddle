// PROYECTOS.md: qué carpetas de la raíz se siguen y cuáles no (§2.3 del plan).
// Se parsea y se edita como texto, para respetar lo que la persona escribe a mano.

import { mismoNombre } from './rutas.ts'

export type Seccion = 'seguimiento' | 'noSeguimiento' | 'sinClasificar'

export type Entrada = {
  carpeta: string
  codigo: string
  /** El código venía entre paréntesis; si no, se calculó. */
  codigoExplicito: boolean
  seccion: Seccion
  /** Línea (desde 0) del fichero. */
  linea: number
}

export type Proyectos = {
  /** La línea `Raíz:`, informativa: la ruta buena es la de la config. */
  raiz: string | null
  seguimiento: Entrada[]
  noSeguimiento: Entrada[]
  sinClasificar: Entrada[]
  avisos: string[]
}

const TITULOS: Record<string, Seccion> = {
  'hacer seguimiento': 'seguimiento',
  'no hacer seguimiento': 'noSeguimiento',
  'sin clasificar': 'sinClasificar',
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function seccionDe(titulo: string): Seccion | null {
  return TITULOS[sinTildes(titulo).toLowerCase().replace(/\s+/g, ' ').trim()] ?? null
}

/** El código por defecto: las tres primeras letras o cifras de la carpeta, en mayúsculas. */
export function codigoPorDefecto(carpeta: string): string {
  const limpio = sinTildes(carpeta).replace(/[^A-Za-z0-9]/g, '')
  return (limpio.slice(0, 3) || 'PRY').toUpperCase()
}

const LINEA = /^\s*[-*+]\s+(.+?)\s*$/
const CODIGO = /^(.*?)\s*\(\s*([A-Za-z0-9]{1,8})\s*\)$/
const ENCABEZADO = /^##\s+(.+?)\s*#*\s*$/
const RAIZ = /^\s*ra[ií]z\s*:\s*(.*?)\s*$/i

function interpretarLinea(texto: string): { carpeta: string; codigo?: string } | null {
  const m = LINEA.exec(texto)
  if (!m) return null
  let cuerpo = m[1]!
  let codigo: string | undefined
  const c = CODIGO.exec(cuerpo)
  if (c) {
    cuerpo = c[1]!
    codigo = c[2]!.toUpperCase()
  }
  const carpeta = cuerpo.replace(/^`(.*)`$/, '$1').trim()
  if (carpeta === '' || carpeta.startsWith('(')) return null
  return codigo ? { carpeta, codigo } : { carpeta }
}

export function interpretarProyectos(texto: string): Proyectos {
  const doc: Proyectos = { raiz: null, seguimiento: [], noSeguimiento: [], sinClasificar: [], avisos: [] }
  let seccion: Seccion | null = null
  let enComentario = false
  const lineas = texto.split(/\r?\n/)
  lineas.forEach((linea, i) => {
    if (enComentario) {
      if (linea.includes('-->')) enComentario = false
      return
    }
    if (linea.trimStart().startsWith('<!--')) {
      enComentario = !linea.includes('-->')
      return
    }
    const r = RAIZ.exec(linea)
    if (r && doc.raiz === null && seccion === null) {
      doc.raiz = r[1]!.replace(/^`(.*)`$/, '$1') || null
      return
    }
    const h = ENCABEZADO.exec(linea)
    if (h) {
      seccion = seccionDe(h[1]!)
      return
    }
    if (/^#\s/.test(linea)) {
      seccion = null
      return
    }
    if (seccion === null) return
    const e = interpretarLinea(linea)
    if (!e) return
    doc[seccion].push({
      carpeta: e.carpeta,
      codigo: e.codigo ?? codigoPorDefecto(e.carpeta),
      codigoExplicito: e.codigo !== undefined,
      seccion,
      linea: i,
    })
  })
  revisar(doc)
  return doc
}

function revisar(doc: Proyectos): void {
  const vistas = new Map<string, Seccion>()
  for (const e of [...doc.seguimiento, ...doc.noSeguimiento, ...doc.sinClasificar]) {
    const k = e.carpeta.toLowerCase()
    const antes = vistas.get(k)
    if (antes && antes !== e.seccion) doc.avisos.push(`«${e.carpeta}» aparece en dos secciones`)
    else if (antes) doc.avisos.push(`«${e.carpeta}» aparece dos veces`)
    vistas.set(k, e.seccion)
  }
  // Por privacidad gana «No hacer seguimiento»: lo que aparezca ahí no se sigue nunca.
  const prohibidas = new Set(doc.noSeguimiento.map(e => e.carpeta.toLowerCase()))
  doc.seguimiento = doc.seguimiento.filter(e => !prohibidas.has(e.carpeta.toLowerCase()))
  const codigos = new Map<string, string>()
  for (const e of doc.seguimiento) {
    const otra = codigos.get(e.codigo)
    if (otra && otra.toLowerCase() !== e.carpeta.toLowerCase()) {
      doc.avisos.push(`«${otra}» y «${e.carpeta}» comparten el código ${e.codigo}: ponle otro a una de las dos`)
    }
    codigos.set(e.codigo, e.carpeta)
  }
}

/** Todas las carpetas que ya figuran en alguna sección. */
export function carpetasConocidas(doc: Proyectos): string[] {
  return [...doc.seguimiento, ...doc.noSeguimiento, ...doc.sinClasificar].map(e => e.carpeta)
}

/** Las carpetas de la raíz que no figuran en ninguna sección. */
export function carpetasNuevas(doc: Proyectos, enDisco: readonly string[], raiz: string): string[] {
  const conocidas = carpetasConocidas(doc)
  return enDisco.filter(c => !conocidas.some(k => mismoNombre(k, c, raiz)))
}

/** Las carpetas que figuran en seguimiento o sin clasificar y ya no están en la raíz. */
export function carpetasDesaparecidas(doc: Proyectos, enDisco: readonly string[], raiz: string): string[] {
  return [...doc.seguimiento, ...doc.sinClasificar]
    .map(e => e.carpeta)
    .filter(c => !enDisco.some(d => mismoNombre(d, c, raiz)))
}

/**
 * Añade carpetas a «## Sin clasificar», detrás de su último elemento. Si la
 * sección no existe, la crea al final. Nunca mueve ni borra nada.
 */
export function anadirSinClasificar(texto: string, carpetas: readonly string[]): string {
  if (carpetas.length === 0) return texto
  const lineas = texto.split(/\r?\n/)
  const nuevas = carpetas.map(c => `- ${c}`)
  const inicio = lineas.findIndex(l => {
    const h = ENCABEZADO.exec(l)
    return h !== null && seccionDe(h[1]!) === 'sinClasificar'
  })
  if (inicio < 0) {
    while (lineas.length > 0 && lineas[lineas.length - 1]!.trim() === '') lineas.pop()
    return `${[...lineas, '', '## Sin clasificar', ...nuevas].join('\n')}\n`
  }
  let fin = lineas.length
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (/^#{1,2}\s/.test(lineas[i]!)) {
      fin = i
      break
    }
  }
  let ultima = inicio
  for (let i = inicio + 1; i < fin; i++) if (lineas[i]!.trim() !== '') ultima = i
  lineas.splice(ultima + 1, 0, ...nuevas)
  const salida = lineas.join('\n')
  return salida.endsWith('\n') ? salida : `${salida}\n`
}

/** Cambia (o añade) la línea `Raíz:` debajo del título. */
export function cambiarRaiz(texto: string, raiz: string): string {
  const lineas = texto.split(/\r?\n/)
  const i = lineas.findIndex(l => RAIZ.test(l))
  if (i >= 0) {
    lineas[i] = `Raíz: ${raiz}`
  } else {
    const titulo = lineas.findIndex(l => /^#\s/.test(l))
    lineas.splice(titulo + 1, 0, `Raíz: ${raiz}`)
  }
  return lineas.join('\n')
}

/** El PROYECTOS.md inicial: la plantilla con la raíz y todas las carpetas sin clasificar. */
export function generarProyectos(
  plantilla: string,
  raiz: string,
  carpetas: readonly string[],
  noSeguir: readonly string[] = [],
): string {
  let texto = plantilla.replaceAll('{{raiz}}', raiz)
  const lineas = texto.split('\n')
  const i = lineas.findIndex(l => {
    const h = ENCABEZADO.exec(l)
    return h !== null && seccionDe(h[1]!) === 'noSeguimiento'
  })
  if (i >= 0 && noSeguir.length > 0) {
    lineas.splice(i + 1, 0, ...noSeguir.map(c => `- ${c}`))
    texto = lineas.join('\n')
  }
  const pendientes = carpetas.filter(c => !noSeguir.some(n => mismoNombre(n, c, raiz)))
  return anadirSinClasificar(texto, pendientes)
}
