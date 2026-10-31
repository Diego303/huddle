// La Oficina (§3.3 del plan): una sala por proyecto con un empleado por sesión
// (modo «sesiones») o por lead y subagente (modo «agentes»). Cada empleado es
// un sprite de 14×10 píxeles (persona, mesa y monitor) dibujado con medios
// bloques en 14×5 celdas; la pantalla lleva el color de su estado. Las salas
// son tarjetas en rejilla que llenan el ancho.

import type { DatosPanel } from '../lib/lector.ts'
import type { EstadoVisible, SesionVista } from '../lib/panel-datos.ts'
import { COLOR_ROL, vistaSesiones } from '../lib/panel-datos.ts'
import type { ModoOficina } from '../types/index.d.ts'
import type { Linea } from './lienzo.ts'
import { ajustar, celda, COLOR, compactar, extremos, fila, interior, repartir, s, tarjeta } from './lienzo.ts'
import { duracion } from './panel.ts'

/** Ancho mínimo de un puesto: el sprite de 14 y una etiqueta como `struo·feat-export`. */
export const ANCHO_EMPLEADO = 19
export const ANCHO_SPRITE = 14
export const ALTO_SPRITE = 5
/** Una sala con más de 4 empleados ocupa todo el ancho. */
const MAX_POR_SALA_ESTRECHA = 4
const gris = { c: COLOR.gris }

export type Empleado = {
  etiqueta: string
  actividad: string
  estado: EstadoVisible
  camiseta: string
}

export type Sala = { nombre: string; empleados: Empleado[]; unidad: string }

export function colorDeEstado(e: EstadoVisible): string {
  switch (e) {
    case 'trabajando':
      return COLOR.verde
    case 'te_espera':
      return COLOR.ambar
    case 'en_pausa':
      return COLOR.grisClaro
    case 'inactiva':
      return COLOR.gris
  }
}

/** Los dos colores de la pantalla del monitor según el estado (y el parpadeo). */
export function colorPantalla(e: EstadoVisible, n: number): [string, string] {
  switch (e) {
    case 'trabajando':
      return n % 2 === 0 ? ['#5DCAA5', '#1D9E75'] : ['#1D9E75', '#5DCAA5']
    case 'te_espera':
      return n % 2 === 0 ? ['#EF9F27', '#FAC775'] : ['#FAC775', '#EF9F27']
    case 'en_pausa':
      return ['#5f5e5a', '#5f5e5a']
    case 'inactiva':
      return ['#2c2c2a', '#2c2c2a']
  }
}

function actividadDe(v: SesionVista): string {
  return v.estado === 'inactiva' ? `inactiva ${duracion(v.quietaMin)}` : v.s.detalle
}

/** Las salas, en el orden de la lista de sesiones (primero lo que te espera). */
export function salas(vistas: readonly SesionVista[], modo: ModoOficina): Sala[] {
  const porNombre = new Map<string, Sala>()
  for (const v of vistas) {
    const nombre = v.s.tipo === 'torre' ? 'GENERAL' : v.s.proyecto
    let sala = porNombre.get(nombre)
    if (!sala) {
      sala = { nombre, empleados: [], unidad: modo === 'sesiones' ? 'sesión' : 'agente' }
      porNombre.set(nombre, sala)
    }
    if (modo === 'sesiones') {
      sala.empleados.push({
        etiqueta: v.s.tipo === 'torre' ? 'torre' : v.etiqueta.replace(' · ', '·'),
        actividad: actividadDe(v),
        estado: v.estado,
        camiseta: COLOR_ROL.lead!,
      })
    } else {
      sala.empleados.push({ etiqueta: v.leadId, actividad: actividadDe(v), estado: v.estado, camiseta: COLOR_ROL.lead! })
      for (const a of v.agentes) {
        sala.empleados.push({
          etiqueta: a.id,
          actividad: a.estado === 'trabajando' ? a.detalle || a.descripcion : a.descripcion,
          estado: v.estado === 'inactiva' ? 'inactiva' : a.estado,
          camiseta: a.color,
        })
      }
    }
  }
  return [...porNombre.values()]
}

const PIEL = '#F0C8A0'
const PELO = '#4A1B0C'
const PANTALON = '#444441'
const MESA = '#8A6A4A'
const MARCO = '#888780'
const TECLADO = '#B4B2A9'

export type Marca = { x: number; fila: number; ch: string; c: string }

/**
 * El sprite de un empleado en píxeles (14×10) y lo que va encima (`!`, `z`).
 * Trabajando teclea (el brazo alterna) con la pantalla parpadeando; esperando
 * levanta el brazo; en pausa o inactivo apoya la cabeza en la mesa.
 */
export function pixeles(e: Empleado, n: number): { px: (string | null)[][]; marca: Marca | null } {
  const px: (string | null)[][] = Array.from({ length: 10 }, () => Array<string | null>(ANCHO_SPRITE).fill(null))
  const p = (x: number, y: number, c: string) => {
    if (y >= 0 && y < 10 && x >= 0 && x < ANCHO_SPRITE) px[y]![x] = c
  }
  // Mesa con sus patas, monitor con su pie, y teclado.
  for (let x = 0; x < ANCHO_SPRITE; x++) p(x, 6, MESA)
  for (const y of [7, 8]) {
    p(1, y, MESA)
    p(12, y, MESA)
  }
  for (let x = 8; x <= 12; x++) {
    p(x, 1, MARCO)
    p(x, 4, MARCO)
  }
  for (const y of [2, 3]) {
    p(8, y, MARCO)
    p(12, y, MARCO)
  }
  const [linea1, linea2] = colorPantalla(e.estado, n)
  for (let x = 9; x <= 11; x++) {
    p(x, 2, linea1)
    p(x, 3, linea2)
  }
  p(10, 5, MARCO)
  p(6, 5, TECLADO)
  p(7, 5, TECLADO)

  let marca: Marca | null = null
  if (e.estado === 'trabajando' || e.estado === 'te_espera') {
    p(2, 0, PELO)
    p(3, 0, PELO)
    p(2, 1, PIEL)
    p(3, 1, PIEL)
    for (let y = 2; y <= 4; y++) for (let x = 1; x <= 4; x++) p(x, y, e.camiseta)
    p(1, 5, PANTALON)
    p(2, 5, PANTALON)
    if (e.estado === 'trabajando') {
      // Teclea: el brazo baja al teclado y vuelve.
      if (n % 2 === 0) {
        p(5, 4, PIEL)
        p(6, 4, PIEL)
      } else {
        p(5, 3, PIEL)
        p(6, 4, PIEL)
      }
    } else {
      // Brazo en alto y un `!` que parpadea.
      p(5, 2, e.camiseta)
      p(5, 1, PIEL)
      p(5, 0, PIEL)
      if (n % 2 === 0) marca = { x: 6, fila: 0, ch: '!', c: COLOR.ambar }
    }
  } else {
    // Cabeza apoyada en la mesa y una z.
    for (let y = 3; y <= 5; y++) for (let x = 1; x <= 3; x++) p(x, y, e.camiseta)
    p(4, 4, PELO)
    p(5, 4, PELO)
    p(4, 5, PIEL)
    p(5, 5, PIEL)
    marca = { x: n % 2 === 0 ? 5 : 6, fila: n % 2 === 0 ? 1 : 0, ch: 'z', c: COLOR.gris }
  }
  return { px, marca }
}

/** El sprite como 5 líneas de lienzo (lo transparente toma el fondo de la sala). */
export function sprite(e: Empleado, n: number): Linea[] {
  const { px, marca } = pixeles(e, n)
  const out: Linea[] = []
  for (let r = 0; r < ALTO_SPRITE; r++) {
    const l: Linea = []
    for (let x = 0; x < ANCHO_SPRITE; x++) {
      if (marca && marca.fila === r && marca.x === x) {
        l.push(s(marca.ch, { c: marca.c, b: true }))
        continue
      }
      const arriba = px[r * 2]![x]
      const abajo = px[r * 2 + 1]![x]
      if (!arriba && !abajo) l.push(s(' '))
      else if (arriba && abajo) l.push(s('▀', { c: arriba, f: abajo }))
      else if (arriba) l.push(s('▀', { c: arriba }))
      else l.push(s('▄', { c: abajo! }))
    }
    out.push(compactar(l))
  }
  return out
}

/** Un puesto de `w` columnas: el sprite centrado, la etiqueta y la actividad. */
function puesto(e: Empleado, n: number, w: number): Linea[] {
  const izq = Math.max(0, Math.floor((w - ANCHO_SPRITE) / 2) - 1)
  return [
    ...sprite(e, n).map(l => ajustar([s(' '.repeat(izq)), ...l], w)),
    ajustar([s('● ', { c: colorDeEstado(e.estado) }), celda(e.etiqueta, w - 2, e.estado === 'inactiva' ? { d: true } : {})], w),
    [celda(`  ${e.actividad}`, w, { c: e.estado === 'te_espera' ? COLOR.ambar : COLOR.grisClaro })],
  ]
}

function contador(sala: Sala): string {
  const k = sala.empleados.length
  return `${k} ${k === 1 ? sala.unidad : sala.unidad === 'sesión' ? 'sesiones' : 'agentes'}`
}

/** Una sala de `w` columnas: tarjeta con varias mesas por fila, repartidas a lo ancho. */
export function dibujarSala(sala: Sala, w: number, n: number, aire = 1, alto?: number): Linea[] {
  const dentro = interior(w, aire)
  const porFila = Math.max(1, Math.floor(dentro / ANCHO_EMPLEADO))
  const lineas: Linea[] = []
  for (let i = 0; i < sala.empleados.length; i += porFila) {
    const grupo = sala.empleados.slice(i, i + porFila)
    const hueco = Math.max(ANCHO_EMPLEADO, Math.min(26, Math.floor(dentro / grupo.length)))
    const puestos = grupo.map(e => puesto(e, n, hueco))
    // Las mesas, centradas en la sala.
    const margen = Math.max(0, Math.floor((dentro - hueco * grupo.length) / 2))
    if (i > 0) lineas.push([])
    lineas.push(...fila(puestos, puestos.map(() => hueco), 0).map(l => [s(' '.repeat(margen)), ...l]))
  }
  return tarjeta(lineas, { titulo: sala.nombre, derecha: [s(contador(sala), gris)], ancho: w, aire, ...(alto ? { alto } : {}) })
}

/** Ancho natural de una sala: sus mesas en una fila (o todo, si son más de 4). */
function anchoNatural(sala: Sala, w: number, aire: number): number {
  const k = sala.empleados.length
  if (k > MAX_POR_SALA_ESTRECHA) return w
  return Math.min(w, Math.max(Math.max(k, 1) * ANCHO_EMPLEADO + 2 + 2 * aire, [...sala.nombre].length + contador(sala).length + 12))
}

/** Coloca las salas en filas que llenan el ancho, igualadas en alto. */
export function colocarSalas(lista: readonly Sala[], w: number, n: number, aire = 1, hueco = 1): Linea[] {
  const filas: Sala[][] = []
  let actual: Sala[] = []
  let usado = 0
  for (const sala of lista) {
    const a = anchoNatural(sala, w, aire)
    const necesita = (actual.length > 0 ? hueco : 0) + a
    if (actual.length > 0 && usado + necesita > w) {
      filas.push(actual)
      actual = []
      usado = 0
    }
    actual.push(sala)
    usado += (actual.length > 1 ? hueco : 0) + a
  }
  if (actual.length > 0) filas.push(actual)

  const out: Linea[] = []
  for (const f of filas) {
    const anchos = repartir(w, f.map(x => anchoNatural(x, w, aire)), hueco)
    const alto = Math.max(...f.map((x, i) => dibujarSala(x, anchos[i]!, n, aire).length))
    out.push(...fila(f.map((x, i) => dibujarSala(x, anchos[i]!, n, aire, alto)), anchos, hueco))
  }
  return out
}

export function leyenda(modo: ModoOficina): Linea {
  const l: Linea = [s(' Estados ', gris)]
  for (const [nombre, e] of [['trabajando', 'trabajando'], ['espera', 'te_espera'], ['pausa', 'en_pausa'], ['inactiva', 'inactiva']] as const) {
    l.push(s('● ', { c: colorDeEstado(e) }), s(`${nombre}  `, gris))
  }
  if (modo === 'agentes') {
    l.push(s('· Roles ', gris))
    for (const r of ['lead', 'explore', 'plan', 'general']) l.push(s('■ ', { c: COLOR_ROL[r]! }), s(`${r}  `, gris))
  }
  return l
}

/** La cabecera de la oficina (junto a las pestañas): el recuento de sesiones. */
export function resumenOficina(d: DatosPanel | null, ahora: number, w: number): Linea {
  if (d === null) return ajustar([s(' huddle · oficina', { c: COLOR.titulo, b: true })], w)
  const vistas = vistaSesiones(d.sesiones, ahora, d.inactiva_min)
  const cuenta = (e: EstadoVisible) => vistas.filter(v => v.estado === e).length
  const resumen = `${vistas.length} ${vistas.length === 1 ? 'sesión' : 'sesiones'} · ${cuenta('trabajando')} trabajando · ${cuenta('te_espera')} espera · ${cuenta('inactiva')} inactiva `
  return ajustar(extremos([s(' oficina', { c: COLOR.titulo, b: true })], [s(resumen, gris)], w), w)
}

/** La oficina entera: salas, leyenda y pie (la cabecera va junto a las pestañas). */
export function componerOficina(d: DatosPanel | null, modo: ModoOficina, w: number, n: number, ahora: number): Linea[] {
  const total = Math.max(30, w)
  if (d === null) return [ajustar([s(' Leyendo la carpeta de control…', gris)], total)]
  const vistas = vistaSesiones(d.sesiones, ahora, d.inactiva_min)
  const ancha = total > 90
  const out: Linea[] = []
  const lista = salas(vistas, modo)
  if (lista.length === 0) out.push([s(' La oficina está vacía: no hay ninguna sesión abierta.', gris)])
  else out.push(...colocarSalas(lista, total, n, ancha ? 2 : 1, ancha ? 2 : 1))
  out.push(leyenda(modo), [s(` /panel · /oficina ${modo === 'sesiones' ? 'agentes' : 'sesiones'}`, gris)])
  return out.map(l => ajustar(l, total))
}
