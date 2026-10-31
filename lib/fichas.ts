// Fichas de proyecto (GENERAL/proyectos/<carpeta>.md), §2.4 del plan.

/** Cuántas líneas del README se leen, una sola vez, para proponer el objetivo. */
export const LINEAS_README = 40

const MAX_OBJETIVO = 140

function limpiarMarkdown(linea: string): string {
  return linea
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Propone un objetivo a partir del principio de un README: la primera frase de
 * texto corrido, sin títulos, insignias, HTML, listas ni bloques de código.
 */
export function objetivoDeReadme(texto: string): string | null {
  const lineas = texto.split(/\r?\n/).slice(0, LINEAS_README)
  let enCodigo = false
  let enFrontMatter = lineas[0]?.trim() === '---'
  for (const [i, bruta] of lineas.entries()) {
    const linea = bruta.trim()
    if (enFrontMatter) {
      if (i > 0 && linea === '---') enFrontMatter = false
      continue
    }
    if (linea.startsWith('```') || linea.startsWith('~~~')) {
      enCodigo = !enCodigo
      continue
    }
    if (enCodigo || linea === '') continue
    if (/^(#|>|[-*+]\s|\d+\.\s|\||<|!\[|\[!\[|={3,}|-{3,})/.test(linea)) continue
    const limpia = limpiarMarkdown(linea)
    if (limpia.length < 12) continue
    const frase = /^(.+?[.!?])(\s|$)/.exec(limpia)?.[1] ?? limpia
    return frase.length > MAX_OBJETIVO ? `${frase.slice(0, MAX_OBJETIVO - 1).trimEnd()}…` : frase
  }
  return null
}

/** Sustituye `{{clave}}` por su valor. */
export function rellenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla.replace(/\{\{(\w+)\}\}/g, (todo, clave: string) => valores[clave] ?? todo)
}

/** El fichero de la ficha de una carpeta. */
export function ficheroFicha(carpeta: string): string {
  return `${carpeta.replace(/[\\/:*?"<>|]/g, '_')}.md`
}

// ------------------------------------------- rellenar con lo que propone Claude

/** Lo que `/fichas` le pide a Claude, ya validado. */
export type Propuesta = {
  fase: string
  objetivo: string
  estado: string
  tareas: { texto: string; hecha: boolean }[]
  bloqueos: string[]
  proximos: string[]
}

const MAX_TAREAS = 15
/** Una tarea cabe en una línea; el estado y los próximos pasos pueden ser más largos. */
const MAX_TAREA = 140
const MAX_FRASE = 320

/** Una línea limpia: sin saltos, sin viñetas ni casillas delante, y no muy larga. */
function linea(valor: unknown, max = MAX_TAREA): string {
  if (typeof valor !== 'string') return ''
  const s = valor
    .replace(/\s+/g, ' ')
    .replace(/^([-*+]\s+)?(\[[ xX]\]\s*)?(\d+[.)]\s+)?/, '')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

function lista(valor: unknown, cuantos: number, max = MAX_TAREA): string[] {
  return Array.isArray(valor) ? valor.map(v => linea(v, max)).filter(Boolean).slice(0, cuantos) : []
}

/**
 * Saca la propuesta del texto de Claude: el objeto JSON que haya dentro, aunque
 * venga entre ``` o con una frase delante. Sin JSON válido, o sin nada útil, null.
 */
export function interpretarPropuesta(texto: string): Propuesta | null {
  const i = texto.indexOf('{')
  const j = texto.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  let j0: Record<string, unknown>
  try {
    j0 = JSON.parse(texto.slice(i, j + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  if (j0 === null || typeof j0 !== 'object') return null
  const tareas = (Array.isArray(j0.tareas) ? j0.tareas : [])
    .map(t => (t && typeof t === 'object' ? { texto: linea((t as Record<string, unknown>).texto), hecha: (t as Record<string, unknown>).hecha === true } : { texto: linea(t), hecha: false }))
    .filter(t => t.texto !== '')
    .slice(0, MAX_TAREAS)
  const estado = typeof j0.estado === 'string' ? j0.estado.split(/\r?\n/).map(l => linea(l, MAX_FRASE)).filter(Boolean).slice(0, 3).join('\n') : ''
  const p: Propuesta = {
    fase: linea(j0.fase).slice(0, 30),
    objetivo: linea(j0.objetivo, MAX_FRASE),
    estado,
    tareas,
    bloqueos: lista(j0.bloqueos, 5, MAX_FRASE),
    proximos: lista(j0.proximos, 3, MAX_FRASE),
  }
  return p.tareas.length === 0 && p.estado === '' && p.proximos.length === 0 ? null : p
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** El texto de relleno de la plantilla: una sección con solo esto está vacía. */
const RELLENO = new Set(['dos o tres lineas, como mucho.', '- (ninguno)', '(ninguno)', '1. …', '1. ...', '…', '...', '-', '- [ ]'])

const esComentario = (l: string) => /^\s*<!--.*-->\s*$/.test(l)

type Tramo = { inicio: number; fin: number }

function tramo(lineas: readonly string[], titulo: string): Tramo | null {
  const i = lineas.findIndex(l => /^##\s/.test(l) && norm(l.replace(/^##\s+/, '')) === norm(titulo))
  if (i < 0) return null
  const fin = lineas.findIndex((l, k) => k > i && /^#{1,2}\s/.test(l))
  return { inicio: i, fin: fin < 0 ? lineas.length : fin }
}

function vacia(lineas: readonly string[], t: Tramo | null): boolean {
  if (t === null) return true
  return lineas
    .slice(t.inicio + 1, t.fin)
    .filter(l => !esComentario(l) && l.trim() !== '')
    .every(l => RELLENO.has(norm(l)))
}

const SECCIONES = ['Estado', 'Tareas', 'Bloqueos', 'Próximos pasos'] as const
type Seccion = (typeof SECCIONES)[number]

/** Qué le falta a una ficha: fase, objetivo y las secciones que siguen como en la plantilla. */
export function huecos(texto: string): string[] {
  const lineas = texto.split(/\r?\n/)
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? ''
  const out: string[] = []
  if ((/^fase:\s*(.*?)\s*$/m.exec(fm)?.[1] ?? '') === '') out.push('fase')
  const obj = /^Objetivo:\s*(.*?)\s*$/m.exec(texto)
  if (obj && (obj[1] === '' || obj[1] === '(por definir)')) out.push('objetivo')
  for (const s of SECCIONES) if (vacia(lineas, tramo(lineas, s))) out.push(s)
  return out
}

/**
 * Rellena con la propuesta solo lo que está vacío: lo que ya hayas escrito no
 * se toca. Las casillas y el estado llevan una marca de que los propuso Claude.
 */
export function rellenarFicha(texto: string, p: Propuesta, dia: string): { texto: string; rellenado: string[] } {
  const faltan = new Set(huecos(texto))
  const rellenado: string[] = []
  let lineas = texto.split(/\r?\n/)

  if (faltan.has('fase') && p.fase !== '') {
    const cierre = lineas[0] === '---' ? lineas.findIndex((l, k) => k > 0 && l === '---') : -1
    if (cierre > 0) {
      const k = lineas.findIndex((l, n) => n > 0 && n < cierre && /^fase:/.test(l))
      if (k > 0) lineas[k] = `fase: ${p.fase}`
      else lineas.splice(cierre, 0, `fase: ${p.fase}`)
      rellenado.push('fase')
    }
  }
  if (faltan.has('objetivo') && p.objetivo !== '') {
    const k = lineas.findIndex(l => /^Objetivo:/.test(l))
    lineas[k] = `Objetivo: ${p.objetivo} (propuesto por Claude)`
    rellenado.push('objetivo')
  }

  const contenido: Record<Seccion, string[]> = {
    Estado: p.estado === '' ? [] : [...p.estado.split('\n'), `_(propuesto por Claude el ${dia})_`],
    Tareas: p.tareas.length === 0 ? [] : [...p.tareas.map(t => `- [${t.hecha ? 'x' : ' '}] ${t.texto}`), '', `_Propuestas por Claude el ${dia}: revísalas y marca las que acabes._`],
    Bloqueos: p.bloqueos.map(b => `- ${b}`),
    'Próximos pasos': p.proximos.map((x, n) => `${n + 1}. ${x}`),
  }
  for (const s of SECCIONES) {
    if (!faltan.has(s) || contenido[s].length === 0) continue
    const t = tramo(lineas, s)
    if (t === null) {
      while (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop()
      lineas = [...lineas, '', `## ${s}`, ...contenido[s], '']
    } else {
      const comentarios = lineas.slice(t.inicio + 1, t.fin).filter(esComentario)
      const sigue = t.fin < lineas.length
      lineas = [...lineas.slice(0, t.inicio + 1), ...comentarios, ...contenido[s], ...(sigue ? [''] : []), ...lineas.slice(t.fin)]
    }
    rellenado.push(s)
  }
  let final = lineas.join('\n')
  if (!final.endsWith('\n')) final += '\n'
  return { texto: final, rellenado }
}
