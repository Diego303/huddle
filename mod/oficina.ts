// La Oficina (§3.3 del plan): una sala por proyecto con un empleado por sesión
// (modo «sesiones») o por lead y subagente (modo «agentes»). Todo son líneas
// del lienzo; las salas se colocan en filas según el ancho.

import type { DatosPanel } from '../lib/lector.ts'
import type { EstadoVisible, SesionVista } from '../lib/panel-datos.ts'
import { COLOR_ROL, vistaSesiones } from '../lib/panel-datos.ts'
import type { ModoOficina } from '../types/index.d.ts'
import type { Linea } from './lienzo.ts'
import { ajustar, ancho, celda, COLOR, extremos, s } from './lienzo.ts'
import { duracion } from './panel.ts'

/** Ancho de un empleado: el sprite de 10 y una etiqueta como `struo·feat-export`. */
export const ANCHO_EMPLEADO = 19
const MAX_POR_SALA_ESTRECHA = 4

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

/**
 * El sprite de un empleado, 3 filas × 10 columnas (persona, mesa y monitor).
 * Trabajando teclea (el brazo alterna) y el monitor parpadea; esperando levanta
 * el brazo con un `!` ámbar que parpadea; en pausa o inactivo, cabeza en la mesa y una z.
 */
export function sprite(e: Empleado, n: number): Linea[] {
  const piel = '#F0C8A0'
  const mesa = '#8A6A4A'
  const pantalla = e.estado === 'trabajando' ? (n % 2 === 0 ? COLOR.verde : COLOR.azul) : COLOR.gris
  const cuerpo = { c: e.camiseta }
  switch (e.estado) {
    case 'trabajando':
      return [
        [s('  o   ', { c: piel }), s('▄▄▄', { c: COLOR.gris }), s(' ')],
        [s(' ▐', cuerpo), s(n % 2 === 0 ? '█▀' : '█▄', cuerpo), s('  '), s('█', { c: COLOR.gris }), s(n % 2 === 0 ? '▀' : '▄', { c: pantalla }), s('█', { c: COLOR.gris }), s(' ')],
        [s('▀▀▀▀▀▀▀▀▀▀', { c: mesa })],
      ]
    case 'te_espera':
      return [
        [s(' \\o', { c: piel }), s(n % 2 === 0 ? '!' : ' ', { c: COLOR.ambar, b: true }), s('  '), s('▄▄▄', { c: COLOR.gris }), s(' ')],
        [s('  █ ', cuerpo), s('  '), s('█▀█', { c: COLOR.gris }), s(' ')],
        [s('▀▀▀▀▀▀▀▀▀▀', { c: mesa })],
      ]
    case 'en_pausa':
    case 'inactiva': {
      const z = n % 2 === 0 ? 'z ' : ' z'
      return [
        [s(`  ${z}  `, { c: COLOR.gris }), s('▄▄▄', { c: COLOR.gris }), s(' ')],
        [s(' ▄', cuerpo), s('o', { c: piel }), s('▄', cuerpo), s('  '), s('█▀█', { c: COLOR.gris }), s(' ')],
        [s('▀▀▀▀▀▀▀▀▀▀', { c: mesa })],
      ]
    }
  }
}

function empleado(e: Empleado, n: number): Linea[] {
  const w = ANCHO_EMPLEADO
  return [
    ...sprite(e, n).map(l => ajustar(l, w)),
    [s('● ', { c: colorDeEstado(e.estado) }), celda(e.etiqueta, w - 2, e.estado === 'inactiva' ? { d: true } : {})],
    [celda(`  ${e.actividad}`, w, { c: e.estado === 'te_espera' ? COLOR.ambar : COLOR.grisClaro })],
  ]
}

/** Una sala con borde: `┌ struo ──── 2 sesiones ┐`. */
export function dibujarSala(sala: Sala, w: number, n: number): Linea[] {
  const interior = w - 4
  const porFila = Math.max(1, Math.floor(interior / ANCHO_EMPLEADO))
  const k = sala.empleados.length
  const contador = `${k} ${k === 1 ? sala.unidad : sala.unidad === 'sesión' ? 'sesiones' : 'agentes'}`
  const gris = { c: COLOR.gris }
  const titulo = ` ${sala.nombre} `
  const relleno = Math.max(1, w - 2 - [...titulo].length - [...contador].length - 2)
  const out: Linea[] = [[s('┌', gris), s(titulo, { c: COLOR.titulo, b: true }), s('─'.repeat(relleno), gris), s(` ${contador} `, gris), s('┐', gris)]]
  for (let i = 0; i < k; i += porFila) {
    const grupo = sala.empleados.slice(i, i + porFila).map(e => empleado(e, n))
    for (let r = 0; r < 5; r++) {
      const fila: Linea = []
      for (const g of grupo) fila.push(...(g[r] ?? []))
      out.push([s('│ ', gris), ...ajustar(fila, interior), s(' │', gris)])
    }
  }
  out.push([s(`└${'─'.repeat(w - 2)}┘`, gris)])
  return out
}

/** Coloca las salas en filas: una sala de más de 4 empleados ocupa todo el ancho. */
export function colocarSalas(lista: readonly Sala[], w: number, n: number): Linea[] {
  const out: Linea[] = []
  let fila: Linea[][] = []
  let usado = 0
  const volcar = () => {
    if (fila.length === 0) return
    const alto = Math.max(...fila.map(b => b.length))
    for (let r = 0; r < alto; r++) {
      const l: Linea = []
      fila.forEach((b, i) => {
        if (i > 0) l.push(s(' '))
        const anchoB = ancho(b[0] ?? [])
        l.push(...ajustar(b[r] ?? [], anchoB))
      })
      out.push(ajustar(l, w))
    }
    fila = []
    usado = 0
  }
  for (const sala of lista) {
    const k = sala.empleados.length
    const titulo = [...sala.nombre].length + 16
    const anchoSala = k > MAX_POR_SALA_ESTRECHA ? w : Math.min(w, Math.max(Math.max(k, 1) * ANCHO_EMPLEADO + 4, titulo))
    const necesita = (fila.length > 0 ? 1 : 0) + anchoSala
    if (usado + necesita > w) volcar()
    fila.push(dibujarSala(sala, anchoSala, n))
    usado += (fila.length > 1 ? 1 : 0) + anchoSala
    if (anchoSala === w) volcar()
  }
  volcar()
  return out
}

export function leyenda(modo: ModoOficina): Linea {
  const l: Linea = [s('Estados ', { c: COLOR.gris })]
  for (const [nombre, e] of [['trabajando', 'trabajando'], ['espera', 'te_espera'], ['pausa', 'en_pausa'], ['inactiva', 'inactiva']] as const) {
    l.push(s('● ', { c: colorDeEstado(e) }), s(`${nombre}  `, { c: COLOR.gris }))
  }
  if (modo === 'agentes') {
    l.push(s('· Roles ', { c: COLOR.gris }))
    for (const r of ['lead', 'explore', 'plan', 'general']) l.push(s('■ ', { c: COLOR_ROL[r]! }), s(`${r}  `, { c: COLOR.gris }))
  }
  return l
}

/** La oficina entera: cabecera, salas, leyenda y pie. */
export function componerOficina(d: DatosPanel | null, modo: ModoOficina, w: number, n: number, ahora: number): Linea[] {
  const ancho = Math.max(30, w)
  if (d === null) return [[s('huddle · oficina', { c: COLOR.titulo, b: true })], [s('Leyendo la carpeta de control…', { c: COLOR.gris })]]
  const vistas = vistaSesiones(d.sesiones, ahora, d.inactiva_min)
  const cuenta = (e: EstadoVisible) => vistas.filter(v => v.estado === e).length
  const resumen = `${vistas.length} ${vistas.length === 1 ? 'sesión' : 'sesiones'} · ${cuenta('trabajando')} trabajando · ${cuenta('te_espera')} espera · ${cuenta('inactiva')} inactiva`
  const modos: Linea = modo === 'sesiones'
    ? [s('[Sesiones]', { b: true }), s('  Agentes', { c: COLOR.gris })]
    : [s('Sesiones  ', { c: COLOR.gris }), s('[Agentes]', { b: true })]
  const out: Linea[] = [
    extremos([s('huddle · oficina  ', { c: COLOR.titulo, b: true }), ...modos], [s(resumen, { c: COLOR.gris })], ancho),
    [],
  ]
  const lista = salas(vistas, modo)
  if (lista.length === 0) out.push([s('La oficina está vacía: no hay ninguna sesión abierta.', { c: COLOR.gris })])
  else out.push(...colocarSalas(lista, ancho, n))
  out.push([], leyenda(modo), [s(`/panel · /oficina ${modo === 'sesiones' ? 'agentes' : 'sesiones'}`, { c: COLOR.gris })])
  return out.map(l => ajustar(l, ancho))
}
