// Encontrar un proyecto en seguimiento por su carpeta o su código.

import type { EngineInterface } from 'claude-code'

import type { Config } from '../config.ts'
import { leerTexto } from '../ficheros.ts'
import type { Entrada } from '../proyectos.ts'
import { interpretarProyectos } from '../proyectos.ts'
import { unir } from '../rutas.ts'

export function buscarEntrada(seguimiento: readonly Entrada[], nombre: string): Entrada | null {
  const n = nombre.trim().toLowerCase()
  if (n === '') return null
  return (
    seguimiento.find(e => e.carpeta.toLowerCase() === n) ??
    seguimiento.find(e => e.codigo.toLowerCase() === n) ??
    seguimiento.find(e => e.carpeta.toLowerCase().startsWith(n)) ??
    null
  )
}

export async function seguimiento($: EngineInterface, config: Config): Promise<Entrada[]> {
  const t = await leerTexto($, unir(config.general_dir, 'PROYECTOS.md'))
  return t === undefined ? [] : interpretarProyectos(t).seguimiento
}

export function listaProyectos(entradas: readonly Entrada[]): string {
  return entradas.length === 0 ? '(ninguno en «Hacer seguimiento»)' : entradas.map(e => `${e.carpeta} (${e.codigo})`).join(', ')
}
