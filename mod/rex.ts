// Rex, la mascota (§3.2 del plan). Un lienzo de 14×10 píxeles (el sprite de
// 10×10 y 4 columnas para el `!`, las `z`, los `✦` o la calabaza) dibujado con
// medios bloques (`▀`: primer plano arriba, fondo abajo): a 1× son 14×5 celdas;
// a 2×, 28×10.

import type { EstadoRex } from '../lib/panel-datos.ts'
import type { Linea } from './lienzo.ts'
import { compactar } from './lienzo.ts'

export const SPRITE = [
  '....####..',
  '....#o####',
  '....######',
  '....####..',
  '#..######.',
  '########..',
  '.######...',
  '..#..#....',
  '..#..#....',
  '..........',
]

/** Sin color: deja ver el fondo de la tarjeta. */
export const NADA = 0x01000000
export const PALETA = {
  cuerpo: 0xd85a30,
  detalle: 0xf0997b,
  ojo: 0x4a1b0c,
  rojo: 0xe24b4a,
  oro: 0xefb427,
  calabaza: 0xe8822a,
  tallo: 0x3b6d11,
  blanco: 0xf1efe8,
} as const

/** El capricho estacional (§3.2): calabaza el 31 de octubre, gorro en diciembre. */
export type Adorno = 'calabaza' | 'gorro' | null

/** Qué adorno toca en una fecha local (mes 1-12). */
export function adornoDe(mes: number, dia: number, estacional: boolean): Adorno {
  if (!estacional) return null
  if (mes === 10 && dia === 31) return 'calabaza'
  if (mes === 12) return 'gorro'
  return null
}

export type Celda = { ch: string; fg: number; bg: number }

const ANCHO_PX = 14
const ALTO_PX = 10

/** Columnas y filas de Rex a una escala. */
export function tamano(escala: 1 | 2): { columnas: number; filas: number } {
  return { columnas: ANCHO_PX * escala, filas: (ALTO_PX * escala) / 2 }
}

function colorDe(pixel: string, fila: number): number {
  if (pixel === 'o') return PALETA.ojo
  if (pixel === '#') return fila >= 7 ? PALETA.detalle : PALETA.cuerpo
  return NADA
}

/**
 * Un fotograma. `n` avanza cada 600 ms. Trabajando se balancea (2 fotogramas);
 * en alerta tiembla y saca un `!` rojo; celebrando salta entre `✦`; durmiendo
 * cierra el ojo y una `z` sube.
 */
export function fotograma(estado: EstadoRex, n: number, adorno: Adorno = null, escala: 1 | 2 = 1): Celda[][] {
  const px: number[][] = Array.from({ length: ALTO_PX }, () => Array<number>(ANCHO_PX).fill(NADA))
  const poner = (x: number, y: number, c: number) => {
    if (y >= 0 && y < ALTO_PX && x >= 0 && x < ANCHO_PX) px[y]![x] = c
  }
  let dx = 0
  let dy = 0
  if (estado === 'trabajando' || estado === 'alerta') dx = n % 2
  if (estado === 'celebrando') dy = n % 2 === 0 ? 0 : -1
  // Con gorro, Rex baja un píxel para que quepa (la última fila del sprite está vacía).
  if (adorno === 'gorro') dy += 1
  SPRITE.forEach((fila, y) => {
    for (let x = 0; x < fila.length; x++) {
      let p = fila[x]!
      if (p === 'o' && estado === 'durmiendo') p = '#'
      const c = colorDe(p, y)
      if (c !== NADA) poner(x + dx, y + dy, c)
    }
  })
  if (adorno === 'gorro') {
    for (let x = 4; x < 8; x++) poner(x + dx, dy - 1, PALETA.rojo)
    poner(8 + dx, dy - 1, PALETA.blanco)
  }
  if (adorno === 'calabaza') {
    poner(12, 7, PALETA.tallo)
    for (const y of [8, 9]) for (const x of [11, 12, 13]) poner(x, y, PALETA.calabaza)
  }

  // Píxeles → celdas: cada píxel ocupa `escala` columnas y `escala` medias filas.
  const { columnas, filas } = tamano(escala)
  const medio = (y: number, x: number) => px[Math.floor(y / escala)]?.[Math.floor(x / escala)] ?? NADA
  const celdas: Celda[][] = []
  for (let r = 0; r < filas; r++) {
    const fila: Celda[] = []
    for (let x = 0; x < columnas; x++) {
      const arriba = medio(r * 2, x)
      const abajo = medio(r * 2 + 1, x)
      if (arriba === NADA && abajo === NADA) fila.push({ ch: ' ', fg: NADA, bg: NADA })
      // Solo la mitad de abajo: `▄` con su color, para no pintar la de arriba con el primer plano por defecto.
      else if (arriba === NADA) fila.push({ ch: '▄', fg: abajo, bg: NADA })
      else fila.push({ ch: '▀', fg: arriba, bg: abajo })
    }
    celdas.push(fila)
  }

  // Lo que va encima, en coordenadas de píxel.
  const marca = (pxX: number, pxY: number, ch: string, fg: number, bg?: number) => {
    const fila = celdas[Math.floor((pxY * escala) / 2)]
    const x = pxX * escala
    for (let k = 0; k < escala; k++) {
      if (fila && x + k < columnas) fila[x + k] = { ch: k === 0 || ch === '━' ? ch : ' ', fg, bg: bg ?? fila[x + k]?.bg ?? NADA }
    }
  }
  switch (estado) {
    case 'durmiendo': {
      marca(5 + dx, 1 + dy, '━', PALETA.ojo, PALETA.cuerpo)
      const paso = n % 3
      marca(11 + (paso % 2), 4 - paso * 2, paso === 2 ? 'Z' : 'z', PALETA.detalle)
      break
    }
    case 'alerta':
      if (n % 2 === 0) marca(12, 0, '!', PALETA.rojo)
      marca(12, 2, '!', PALETA.rojo)
      break
    case 'celebrando':
      marca(11, n % 2 === 0 ? 0 : 2, '✦', PALETA.oro)
      marca(13, n % 2 === 0 ? 4 : 2, '✦', PALETA.oro)
      marca(0, n % 2 === 0 ? 2 : 0, '✦', PALETA.oro)
      break
    case 'trabajando':
      break
  }
  return celdas
}

export function hex(color: number): string | undefined {
  return color === NADA ? undefined : `#${color.toString(16).padStart(6, '0')}`
}

/** Las celdas como líneas del lienzo (lo transparente toma el fondo de la tarjeta). */
export function comoLineas(celdas: readonly (readonly Celda[])[]): Linea[] {
  return celdas.map(fila =>
    compactar(
      fila.map(c => {
        const fg = hex(c.fg)
        const bg = hex(c.bg)
        return { t: c.ch, ...(fg ? { c: fg } : {}), ...(bg ? { f: bg } : {}) }
      }),
    ),
  )
}
