// /preguntar <proyecto> "<pregunta>": consulta en solo lectura. Si la sesión
// del proyecto está en pausa o inactiva, se retoma en una bifurcación; si está
// trabajando o no hay, un `claude -p` nuevo en el repo. Ninguna de las dos
// puede escribir: solo Read y unos pocos comandos de lectura.

import type { EngineInterface } from 'claude-code'

import { estaConfigurada, leerConfig } from '../config.ts'
import type { EstadoSesion } from '../estado.ts'
import { leerTexto } from '../ficheros.ts'
import { vistaSesiones } from '../panel-datos.ts'
import { unir } from '../rutas.ts'
import { buscarEntrada, listaProyectos, seguimiento } from './buscar.ts'
import { apuntar, sinComillas } from './registro.ts'

/** Lo único que puede hacer el Claude que responde. */
export const HERRAMIENTAS_LECTURA = [
  'Read',
  'Bash(git log:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git show:*)',
  'Bash(ls:*)',
  'Bash(grep:*)',
  'Bash(rg:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(wc:*)',
]

export function argvPreguntar(pregunta: string, retomar: string | null): string[] {
  return [
    'claude',
    '-p',
    ...(retomar ? ['--resume', retomar, '--fork-session'] : []),
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--tools',
    'Read,Bash',
    '--allowedTools',
    ...HERRAMIENTAS_LECTURA,
    '--append-system-prompt',
    'Respondes una consulta de Huddle en solo lectura: no modifiques ningún fichero, no hagas commits y responde en español, breve.',
    '--output-format',
    'json',
    '--',
    pregunta,
  ]
}

/** Separa `proyecto "pregunta"` (o `proyecto pregunta sin comillas`). */
export function separar(args: string): { proyecto: string; pregunta: string } {
  const m = /^\s*(\S+)\s+([\s\S]+)$/.exec(args)
  return m ? { proyecto: m[1]!, pregunta: sinComillas(m[2]!) } : { proyecto: args.trim(), pregunta: '' }
}

export type Respuesta = { texto: string; error: boolean; denegadas: number; coste: number | null }

export function interpretarRespuesta(stdout: string): Respuesta {
  try {
    const j = JSON.parse(stdout) as { result?: unknown; is_error?: unknown; permission_denials?: unknown[]; total_cost_usd?: unknown }
    return {
      texto: typeof j.result === 'string' ? j.result.trim() : '(sin respuesta)',
      error: j.is_error === true,
      denegadas: Array.isArray(j.permission_denials) ? j.permission_denials.length : 0,
      coste: typeof j.total_cost_usd === 'number' ? j.total_cost_usd : null,
    }
  } catch {
    return { texto: stdout.trim().slice(0, 2000) || '(sin respuesta)', error: true, denegadas: 0, coste: null }
  }
}

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

export async function preguntar($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const { proyecto, pregunta } = separar(args)
  const entradas = await seguimiento($, config)
  const e = buscarEntrada(entradas, proyecto)
  if (e === null || pregunta === '') return `Uso: /preguntar <proyecto> "<pregunta>". En seguimiento: ${listaProyectos(entradas)}`
  const ruta = unir(config.raiz_proyectos, e.carpeta)

  // La sesión más reciente del proyecto que no esté trabajando ni esperando.
  const vistas = vistaSesiones(await sesionesDe($, unir(config.general_dir, '.agentos', 'estado'), e.carpeta), Date.now(), config.inactiva_min)
  const quieta = vistas
    .filter(v => v.estado === 'en_pausa' || v.estado === 'inactiva')
    .sort((a, b) => Date.parse(b.s.ultimo_evento) - Date.parse(a.s.ultimo_evento))[0]
  const retomar = quieta?.s.session_id ?? null
  const cwd = quieta?.s.cwd ?? ruta

  let r: Respuesta
  try {
    const p = await $.process.run(argvPreguntar(pregunta, retomar), { cwd, timeoutMs: 300_000 })
    r = interpretarRespuesta(p.stdout)
    if (p.exitCode !== 0 && p.stdout.trim() === '') r = { texto: p.stderr.trim().split('\n').slice(-3).join('\n') || `claude terminó con código ${p.exitCode}`, error: true, denegadas: 0, coste: null }
  } catch (err) {
    return `No pude lanzar claude: ${err instanceof Error ? err.message : String(err)}`
  }

  const modo = retomar ? `bifurcación de la sesión ${quieta?.leadId ?? retomar.slice(0, 8)}` : '`claude -p` nuevo en el repo'
  const pie = [`solo lectura · ${modo}`, r.denegadas > 0 ? `${r.denegadas} intento(s) de escribir denegados` : '', r.coste !== null ? `$${r.coste.toFixed(4)}` : '']
    .filter(Boolean)
    .join(' · ')
  if (!r.error) {
    try {
      const guardar = await $.ui.ask('¿Guardo la respuesta en el registro?', { header: 'Registro', options: ['Sí', 'No'] })
      if (guardar === 'Sí') await apuntar($, config, `/preguntar ${e.carpeta}: «${pregunta}» → ${r.texto.slice(0, 400)}`)
    } catch {
      // sin nadie a quien preguntar: no se guarda
    }
  }
  return `${e.carpeta}${r.error ? ' (error)' : ''}:\n${r.texto}\n\n(${pie})`
}
