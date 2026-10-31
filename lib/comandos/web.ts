// /huddle web: instala .agentos/web/dashboard.html, escribe datos.js y abre la
// página en el navegador (de Windows, si estás en WSL). Desde ese momento las
// sesiones mantienen datos.js al día y la página lo relee cada 2 s.

import type { EngineInterface } from 'claude-code'

import { estaConfigurada, leerConfig } from '../config.ts'
import { usoDe } from '../estado.ts'
import type { Plataforma } from '../notificar.ts'
import { ahoraLocal, desfaseActual, plataformaActual } from '../sesion.ts'
import { argvAbrirNavegador, escribirDatosWeb, instalarDashboard } from '../web.ts'

async function salida($: EngineInterface, argv: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(argv, { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

async function vaciar(flujo: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _ of flujo) {
      // el navegador sigue solo
    }
  } catch {
    // sin programa para abrir: se dice la ruta
  }
}

/** Abre `ruta` en el navegador sin esperar. Devuelve cómo (o null si no sabe). */
export async function abrirEnNavegador($: EngineInterface, ruta: string, plataforma: Plataforma): Promise<{ argv: string[] | null; windows: string | null }> {
  const windows = plataforma === 'wsl' ? await salida($, ['wslpath', '-w', ruta]) : null
  const hayWslview = plataforma === 'wsl' && (await salida($, ['which', 'wslview'])) !== null
  const argv = argvAbrirNavegador(plataforma, ruta, windows, hayWslview)
  if (argv !== null) {
    try {
      void vaciar($.process.spawn({ argv }))
    } catch {
      return { argv: null, windows }
    }
  }
  return { argv, windows }
}

export async function huddle($: EngineInterface, args: string): Promise<string> {
  const sub = args.trim().toLowerCase()
  if (sub !== 'web') return 'Uso: /huddle web · abre la vista web en vivo en el navegador.'
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const pagina = await instalarDashboard($, config)
  const motor = await $.session.usage().catch(() => null)
  await escribirDatosWeb($, config, desfaseActual(), motor ? usoDe(motor, ahoraLocal()) : null, ahoraLocal().slice(11, 19))
  // HUDDLE_NO_ABRIR=1: solo la ruta, sin abrir el navegador (pruebas, sesiones remotas).
  const abierta = (await $.env.get('HUDDLE_NO_ABRIR'))
    ? { argv: null, windows: plataformaActual() === 'wsl' ? await salida($, ['wslpath', '-w', pagina]) : null }
    : await abrirEnNavegador($, pagina, plataformaActual())
  return [
    `Vista web: ${pagina}`,
    ...(abierta.windows ? [`En Windows: ${abierta.windows}`] : []),
    abierta.argv ? 'Abierta en el navegador. Se actualiza sola cada 2 s, sin recargar.' : 'No sé abrir el navegador aquí: abre ese fichero a mano. Se actualiza sola cada 2 s.',
  ].join('\n')
}
