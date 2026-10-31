// /huddle web: instala .agentos/web/dashboard.html, escribe datos.js y abre la
// página en el navegador (de Windows, si estás en WSL). Desde ese momento las
// sesiones mantienen datos.js al día y la página lo relee cada 2 s.

import type { EngineInterface } from 'claude-code'

import type { Ignorado } from '../atascos.ts'
import { interpretarIgnorados, serializarIgnorados } from '../atascos.ts'
import type { Config } from '../config.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import type { EstadoSesion } from '../estado.ts'
import { usoDe } from '../estado.ts'
import { escribirAtomico, leerTexto } from '../ficheros.ts'
import { unir } from '../rutas.ts'
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

async function sesiones($: EngineInterface, config: Config): Promise<EstadoSesion[]> {
  const dir = unir(config.general_dir, '.agentos', 'estado')
  const out: EstadoSesion[] = []
  try {
    for (const f of await $.fs.list(dir)) {
      if (!f.name.endsWith('.json')) continue
      try {
        const s = JSON.parse((await leerTexto($, unir(dir, f.name))) ?? '') as EstadoSesion
        if (s?.version === 1 && typeof s.session_id === 'string') out.push(s)
      } catch {
        // un fichero a medias se ignora
      }
    }
  } catch {
    // sin sesiones
  }
  return out
}

/**
 * /huddle ignorar <id>: lo que copia el botón «ignorar» de la web. Guarda el
 * atasco en .agentos/atascos-ignorados.json hasta que esa sesión cambie de
 * tarea (le escribas otra cosa); de paso quita lo que ya no vale.
 */
export async function ignorar($: EngineInterface, config: Config, id: string): Promise<string> {
  const vivas = await sesiones($, config)
  const s = vivas.find(x => x.atasco?.id === id)
  if (!s?.atasco) return `No encuentro el atasco «${id}»: quizá ya se resolvió o la sesión se cerró.`
  const ruta = unir(config.general_dir, '.agentos', 'atascos-ignorados.json')
  const tareas = new Map(vivas.map(x => [x.session_id, x.tarea ?? 0]))
  const siguen = interpretarIgnorados((await leerTexto($, ruta)) ?? '').filter(i => tareas.get(i.session_id) === i.tarea)
  const nuevo: Ignorado = { session_id: s.session_id, clave: s.atasco.clave, tarea: s.tarea ?? 0, ts: new Date().toISOString() }
  await escribirAtomico($, ruta, serializarIgnorados([...siguen.filter(i => !(i.session_id === nuevo.session_id && i.clave === nuevo.clave)), nuevo]))
  const donde = s.tipo === 'proyecto' ? `${s.proyecto} · ${s.rama ?? 'n/d'}` : s.proyecto
  return `Ignorado en ${donde}: ${s.atasco.motivo}. Vuelve a salir si le das otra tarea a esa sesión y sigue igual.`
}

export async function huddle($: EngineInterface, args: string): Promise<string> {
  const [sub = '', id = ''] = args.trim().split(/\s+/)
  const uso = 'Uso: /huddle web · abre la vista web en vivo en el navegador; /huddle ignorar <id> · deja de mostrar un atasco (lo copia la web).'
  if (sub.toLowerCase() !== 'web' && sub.toLowerCase() !== 'ignorar') return uso
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  if (sub.toLowerCase() === 'ignorar') return id === '' ? uso : ignorar($, config, id)
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
