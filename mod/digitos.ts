// Dígitos grandes para los KPIs: una fuente de 3×5 píxeles dibujada en 3×3
// celdas con medios bloques (▀ arriba, ▄ abajo, █ los dos).

import type { Linea } from './lienzo.ts'
import { s } from './lienzo.ts'

const FUENTE: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '-': ['...', '...', '###', '...', '...'],
}

export const ALTO_DIGITO = 3
export const ANCHO_DIGITO = 3

function celda(arriba: boolean, abajo: boolean): string {
  if (arriba && abajo) return '█'
  if (arriba) return '▀'
  if (abajo) return '▄'
  return ' '
}

/** Las 3 filas de un número grande (con 1 columna entre dígitos). Lo que no es dígito se omite. */
export function grande(texto: string, color: string): Linea[] {
  const glifos = [...texto].map(c => FUENTE[c]).filter((g): g is readonly string[] => g !== undefined)
  const filas: string[] = ['', '', '']
  glifos.forEach((g, i) => {
    for (let r = 0; r < ALTO_DIGITO; r++) {
      const a = g[r * 2] ?? '...'
      const b = g[r * 2 + 1] ?? '...'
      let trozo = ''
      for (let x = 0; x < ANCHO_DIGITO; x++) trozo += celda(a[x] === '#', b[x] === '#')
      filas[r] += (i > 0 ? ' ' : '') + trozo
    }
  })
  return filas.map(f => [s(f, { c: color, b: true })])
}

/** El ancho en columnas de `grande(texto)`. */
export function anchoGrande(texto: string): number {
  const n = [...texto].filter(c => FUENTE[c] !== undefined).length
  return n === 0 ? 0 : n * ANCHO_DIGITO + (n - 1)
}
