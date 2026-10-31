// /proyecto <nombre> [tests]: el detalle de un proyecto. Aquí sí se lee, porque
// se pide de forma explícita: su ficha, el git log reciente, el estado y sus
// sesiones vivas. Con «tests», Claude ejecuta los tests sin cambiar nada.

import type { EngineInterface } from 'claude-code'

import { estaConfigurada, leerConfig } from '../config.ts'
import type { EstadoSesion } from '../estado.ts'
import { leerTexto } from '../ficheros.ts'
import { interpretarStatus } from '../git.ts'
import { vistaSesiones } from '../panel-datos.ts'
import { encolarPrompt } from '../encolar.ts'
import { unir } from '../rutas.ts'
import { buscarEntrada, listaProyectos, seguimiento } from './buscar.ts'

export const PROMPT_TESTS = (carpeta: string, ruta: string) =>
  [
    `[Huddle · /proyecto ${carpeta} tests] Ejecuta los tests del proyecto en ${ruta} y resume el resultado en 3 líneas (pasan / fallan y por qué).`,
    'Averigua cómo se ejecutan mirando su package.json, Makefile o similar. No modifiques ningún fichero ni hagas commits.',
  ].join('\n')

async function sesionesDe($: EngineInterface, dir: string, carpeta: string): Promise<EstadoSesion[]> {
  const out: EstadoSesion[] = []
  try {
    for (const f of await $.fs.list(dir)) {
      if (!f.name.endsWith('.json')) continue
      try {
        const s = JSON.parse((await leerTexto($, unir(dir, f.name))) ?? '') as EstadoSesion
        if (s?.version === 1 && s.tipo === 'proyecto' && s.proyecto === carpeta) out.push(s)
      } catch {
        // un fichero a medias se ignora
      }
    }
  } catch {
    // sin directorio de estado
  }
  return out
}

export async function proyecto($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const partes = args.trim().split(/\s+/)
  const conTests = partes.length > 1 && /^tests?$/i.test(partes[partes.length - 1] ?? '')
  const nombre = conTests ? partes.slice(0, -1).join(' ') : args.trim()
  const entradas = await seguimiento($, config)
  const e = buscarEntrada(entradas, nombre)
  if (e === null) return `¿Qué proyecto? Uso: /proyecto <nombre> [tests]. En seguimiento: ${listaProyectos(entradas)}`
  const ruta = unir(config.raiz_proyectos, e.carpeta)

  const ficha = (await leerTexto($, unir(config.general_dir, 'proyectos', `${e.carpeta}.md`))) ?? '(sin ficha: ejecuta /proyectos)'
  const git = async (a: string[]) => {
    try {
      const r = await $.process.run(['git', '--no-optional-locks', '-C', ruta, ...a], { timeoutMs: 20_000 })
      return r.exitCode === 0 ? r.stdout.trimEnd() : null
    } catch {
      return null
    }
  }
  const [status, log] = await Promise.all([git(['status', '--porcelain=v2', '--branch']), git(['log', '-10', '--format=%h  %cr  %s'])])
  const st = status === null ? null : interpretarStatus(status)
  const estadoGit = st
    ? `${st.rama ?? 'HEAD suelto'} · ${st.cambios} cambio(s) sin commitear · ${st.ahead} sin push · ${st.behind} por traer${st.upstream ? ` · ${st.upstream}` : ' · sin upstream'}`
    : 'n/d (no es un repo git o git falló)'
  const vivas = vistaSesiones(await sesionesDe($, unir(config.general_dir, '.agentos', 'estado'), e.carpeta), Date.now(), config.inactiva_min)

  const salida = [
    `# ${e.carpeta} (${e.codigo}) · ${ruta}`,
    '',
    ficha.trimEnd().split('\n').slice(0, 40).join('\n'),
    '',
    `git: ${estadoGit}`,
    ...(log ? ['', 'Últimos commits:', ...log.split('\n').map(l => `  ${l}`)] : []),
    '',
    vivas.length === 0
      ? 'Sesiones: ninguna abierta.'
      : `Sesiones: ${vivas.map(v => `${v.leadId} ${v.s.rama ?? ''} · ${v.estado}${v.agentes.length > 0 ? ` (+${v.agentes.length} sub)` : ''}`).join(' · ')}`,
  ]
  if (conTests) {
    encolarPrompt($, PROMPT_TESTS(e.carpeta, ruta))
    salida.push('', 'Ahora Claude ejecuta los tests (sin cambiar nada).')
  }
  return salida.join('\n')
}
