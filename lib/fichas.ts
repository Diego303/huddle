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
