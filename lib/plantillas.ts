// Plantillas de la carpeta de control, en templates/GENERAL/ del mod.

import type { EngineInterface } from 'claude-code'

import { leerTexto } from './ficheros.ts'
import { unir } from './rutas.ts'

export type Plantilla = 'ESTADO.md' | 'PROYECTOS.md' | 'proyectos/_plantilla.md'

export async function leerPlantilla($: EngineInterface, plantilla: Plantilla): Promise<string> {
  const ruta = unir($.plugin.root, 'templates', 'GENERAL', plantilla)
  const texto = await leerTexto($, ruta)
  if (texto === undefined) throw new Error(`falta la plantilla ${ruta}`)
  return texto
}

/** La plantilla de ficha: la de la carpeta de control si la persona la tiene, o la del mod. */
export async function leerPlantillaFicha($: EngineInterface, generalDir: string): Promise<string> {
  return (await leerTexto($, unir(generalDir, 'proyectos', '_plantilla.md'))) ?? leerPlantilla($, 'proyectos/_plantilla.md')
}
