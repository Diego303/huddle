// Punto de entrada del mod: registra los comandos y los hooks, y delega en lib/ y mod/.

import type { Register } from 'claude-code'

import { configurar } from '../lib/comandos/configurar.ts'
import { directorio } from '../lib/comandos/directorio.ts'
import { proyectos } from '../lib/comandos/proyectos.ts'

/** Un error de un comando se cuenta como su salida, sin romper la sesión. */
function fallo(err: unknown): { text: string } {
  return { text: `Algo falló: ${err instanceof Error ? err.message : String(err)}` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'configurar',
      description: 'Huddle: convierte esta carpeta en la carpeta de control',
      argumentHint: '[raíz de proyectos]',
    })
    await $.command.register({
      name: 'directorio',
      description: 'Huddle: cambia el directorio donde viven tus proyectos',
      argumentHint: '<ruta>',
    })
    await $.command.register({
      name: 'proyectos',
      description: 'Huddle: busca carpetas nuevas en tu directorio de proyectos',
    })
    return r
  })

  on('command.run', { command: 'configurar' }, async ($, e) => {
    try {
      return { text: await configurar($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'directorio' }, async ($, e) => {
    try {
      return { text: await directorio($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'proyectos' }, async $ => {
    try {
      return { text: await proyectos($) }
    } catch (err) {
      return fallo(err)
    }
  })
}
