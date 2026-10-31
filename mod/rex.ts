// Rex, la mascota (§3.2 del plan): sprite de 10×10 dibujado a 2× con medios
// bloques (`▀`: primer plano arriba, fondo abajo), 20 columnas × 10 filas, más
// 4 columnas a la derecha para el `!`, las `z` o los `✦`.

import type { EstadoRex } from '../lib/panel-datos.ts'

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

/** Color del terminal por defecto (sin color). */
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

export const COLUMNAS = 24
export const FILAS = 10

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
export function fotograma(estado: EstadoRex, n: number, adorno: Adorno = null): Celda[][] {
  // Rejilla de medios píxeles: cada píxel ocupa 2 columnas y 2 medias filas.
  const alto = FILAS * 2
  const medio: number[][] = Array.from({ length: alto }, () => Array<number>(COLUMNAS).fill(NADA))
  let dx = 0
  let dy = 0
  if (estado === 'trabajando') dx = n % 2
  if (estado === 'alerta') dx = n % 2 === 0 ? 0 : 1
  if (estado === 'celebrando') dy = n % 2 === 0 ? 0 : -1
  // Con gorro, Rex baja media celda para que quepa (la última fila del sprite está vacía).
  if (adorno === 'gorro') dy += 2
  for (let f = 0; f < SPRITE.length; f++) {
    const fila = SPRITE[f]!
    for (let c = 0; c < fila.length; c++) {
      let pixel = fila[c]!
      if (pixel === 'o' && estado === 'durmiendo') pixel = '#'
      const color = colorDe(pixel, f)
      if (color === NADA) continue
      for (const sy of [0, 1]) {
        for (const sx of [0, 1]) {
          const y = f * 2 + sy + dy
          const x = c * 2 + sx + dx
          if (y >= 0 && y < alto && x >= 0 && x < COLUMNAS) medio[y]![x] = color
        }
      }
    }
  }
  const celdas: Celda[][] = []
  for (let r = 0; r < FILAS; r++) {
    const fila: Celda[] = []
    for (let x = 0; x < COLUMNAS; x++) {
      const arriba = medio[r * 2]![x]!
      const abajo = medio[r * 2 + 1]![x]!
      fila.push(arriba === NADA && abajo === NADA ? { ch: ' ', fg: NADA, bg: NADA } : { ch: '▀', fg: arriba, bg: abajo })
    }
    celdas.push(fila)
  }
  const poner = (r: number, x: number, ch: string, fg: number) => {
    const fila = celdas[r]
    if (fila && x >= 0 && x < COLUMNAS) fila[x] = { ch, fg, bg: fila[x]?.bg ?? NADA }
  }
  switch (estado) {
    case 'durmiendo': {
      // El ojo, una línea; y una z que sube por la derecha de la cabeza.
      const fila = celdas[1]
      if (fila) for (const x of [10, 11]) fila[x] = { ch: '━', fg: PALETA.ojo, bg: PALETA.cuerpo }
      const paso = n % 4
      poner(3 - paso, 21 + (paso % 2), paso < 2 ? 'z' : 'Z', PALETA.detalle)
      break
    }
    case 'alerta':
      if (n % 2 === 0) poner(0, 22, '!', PALETA.rojo)
      poner(1, 22, '!', PALETA.rojo)
      break
    case 'celebrando':
      poner(n % 2 === 0 ? 0 : 2, 21, '✦', PALETA.oro)
      poner(n % 2 === 0 ? 3 : 1, 23, '✦', PALETA.oro)
      poner(n % 2 === 0 ? 6 : 5, 0, '✦', PALETA.oro)
      break
    case 'trabajando':
      break
  }
  if (adorno === 'calabaza') {
    poner(8, 21, '▄', PALETA.tallo)
    const fila = celdas[9]
    if (fila) {
      fila[20] = { ch: '▐', fg: PALETA.calabaza, bg: NADA }
      fila[21] = { ch: '█', fg: PALETA.calabaza, bg: NADA }
      fila[22] = { ch: '█', fg: PALETA.calabaza, bg: NADA }
      fila[23] = { ch: '▌', fg: PALETA.calabaza, bg: NADA }
    }
  }
  if (adorno === 'gorro') {
    // Un gorro rojo sobre la cabeza con su borla blanca.
    const x0 = 8 + dx
    const fila = celdas[0]
    if (fila) {
      for (let x = x0; x < x0 + 8 && x < COLUMNAS; x++) fila[x] = { ch: '▄', fg: PALETA.rojo, bg: NADA }
      if (x0 + 8 < COLUMNAS) fila[x0 + 8] = { ch: '▗', fg: PALETA.blanco, bg: NADA }
    }
  }
  return celdas
}

/** Las celdas empaquetadas para un `Raster`: base64 de u32 [carácter, primer plano, fondo]. */
export function empaquetar(celdas: readonly (readonly Celda[])[]): string {
  const filas = celdas.length
  const cols = celdas[0]?.length ?? 0
  const palabras = new Uint32Array(filas * cols * 3)
  let i = 0
  for (const fila of celdas) {
    for (const c of fila) {
      palabras[i++] = c.ch.codePointAt(0) ?? 32
      palabras[i++] = c.fg
      palabras[i++] = c.bg
    }
  }
  const bytes = new Uint8Array(palabras.buffer)
  let binario = ''
  for (let j = 0; j < bytes.length; j++) binario += String.fromCharCode(bytes[j]!)
  return btoa(binario)
}

export function hex(color: number): string | undefined {
  return color === NADA ? undefined : `#${color.toString(16).padStart(6, '0')}`
}
