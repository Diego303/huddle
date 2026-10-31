// /directorio <ruta>: cambia la raíz de proyectos, actualiza la línea «Raíz:»
// de PROYECTOS.md y vuelve a escanear.

import type { EngineInterface } from 'claude-code'

import { estaConfigurada, guardarConfig, leerConfig } from '../config.ts'
import { escribirAtomico, esDirectorio, leerTexto } from '../ficheros.ts'
import { cambiarRaiz } from '../proyectos.ts'
import { rutaDeUsuario, unir } from '../rutas.ts'
import { describirEscaneo, reescanear } from './proyectos.ts'

export async function directorio($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: abre Claude Code en tu carpeta de control y ejecuta /configurar.'
  if (!args.trim()) return `Raíz actual: ${config.raiz_proyectos}\nPara cambiarla: /directorio <ruta>`

  const home = (await $.env.get('HOME')) ?? '/'
  const raiz = rutaDeUsuario(args, home, await $.session.cwd())
  if (!(await esDirectorio($, raiz))) return `No encuentro la carpeta ${raiz}.`

  const nueva = { ...config, raiz_proyectos: raiz }
  await guardarConfig($, nueva)
  const rutaProyectos = unir(config.general_dir, 'PROYECTOS.md')
  const texto = await leerTexto($, rutaProyectos)
  if (texto === undefined) return `Raíz cambiada a ${raiz}, pero no encuentro ${rutaProyectos}: ejecuta /configurar.`
  await escribirAtomico($, rutaProyectos, cambiarRaiz(texto, raiz))
  return [`Raíz cambiada: ${config.raiz_proyectos} → ${raiz}`, ...describirEscaneo(await reescanear($, nueva))].join('\n')
}
