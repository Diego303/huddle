// /registro "<texto>": una línea en el diario del mes.

import type { EngineInterface } from 'claude-code'

import type { Config } from '../config.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import { anadirARegistro, lineaRegistro } from '../estado-md.ts'
import { escribirAtomico, leerTexto } from '../ficheros.ts'
import { unir } from '../rutas.ts'
import { desfaseActual } from '../sesion.ts'
import { isoLocal } from '../tiempo.ts'

export function sinComillas(texto: string): string {
  return texto.trim().replace(/^(["'«“])([\s\S]*)(["'»”])$/, '$2').trim()
}

/** Añade `- AAAA-MM-DD HH:MM · texto` a registro/AAAA-MM.md. Devuelve la ruta. */
export async function apuntar($: EngineInterface, config: Config, texto: string): Promise<string> {
  const fecha = isoLocal(Date.now(), desfaseActual())
  const mes = fecha.slice(0, 7)
  const ruta = unir(config.general_dir, 'registro', `${mes}.md`)
  const linea = lineaRegistro(fecha.slice(0, 16).replace('T', ' '), texto)
  await escribirAtomico($, ruta, anadirARegistro((await leerTexto($, ruta)) ?? null, mes, linea))
  return ruta
}

export async function registro($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const texto = sinComillas(args)
  if (texto === '') return 'Uso: /registro "lo que quieras apuntar"'
  const ruta = await apuntar($, config, texto)
  return `Apuntado en ${ruta}`
}
