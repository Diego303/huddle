// /abrir <proyecto>: una pestaña nueva de Windows Terminal con Claude Code en
// el repo (en WSL); fuera de WSL, el comando para copiarlo.

import type { EngineInterface } from 'claude-code'

import { estaConfigurada, leerConfig } from '../config.ts'
import { unir } from '../rutas.ts'
import { buscarEntrada, listaProyectos, seguimiento } from './buscar.ts'

export function argvAbrir(distro: string, titulo: string, ruta: string): string[] {
  return ['wt.exe', '-w', '0', 'nt', '--title', titulo, 'wsl.exe', '-d', distro, '--cd', ruta, '--', 'claude']
}

function citar(a: string): string {
  return /^[\w./:=@-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`
}

async function vaciar(flujo: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _ of flujo) {
      // wt.exe vuelve enseguida
    }
  } catch {
    // si no hay Windows Terminal, no pasa nada más
  }
}

export async function abrir($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const entradas = await seguimiento($, config)
  const e = buscarEntrada(entradas, args)
  if (e === null) return `¿Qué proyecto? Uso: /abrir <proyecto>. En seguimiento: ${listaProyectos(entradas)}`
  const ruta = unir(config.raiz_proyectos, e.carpeta)
  const distro = await $.env.get('WSL_DISTRO_NAME')
  if (!distro) return `Fuera de WSL no abro pestañas. Para abrirlo tú:\n  cd ${citar(ruta)} && claude`
  const argv = argvAbrir(distro, e.carpeta, ruta)
  try {
    void vaciar($.process.spawn({ argv }))
  } catch (err) {
    return `No pude lanzar Windows Terminal (${err instanceof Error ? err.message : String(err)}). El comando es:\n  ${argv.map(citar).join(' ')}`
  }
  return `Abriendo ${e.carpeta} en una pestaña nueva de Windows Terminal.`
}
