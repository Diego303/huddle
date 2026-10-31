// /cierre: el resumen del día. Huddle apunta los números en el registro y
// desmarca «Hoy» para mañana; Claude escribe el resumen y actualiza los
// próximos pasos de los proyectos tocados hoy.

import type { EngineInterface } from 'claude-code'

import { interpretarActividad, interpretarActividadTotal } from '../actividad.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import type { GitCache } from '../git.ts'
import { escribirAtomico, leerTexto } from '../ficheros.ts'
import { casillas, seccion } from '../panel-datos.ts'
import { encolarPrompt } from '../encolar.ts'
import { unir } from '../rutas.ts'
import { desfaseActual } from '../sesion.ts'
import { diaLocal } from '../tiempo.ts'
import { apuntar } from './registro.ts'

/** Desmarca las casillas de «## Hoy» y deja el resto igual. */
export function desmarcarHoy(texto: string): string {
  const lineas = texto.split('\n')
  const i = lineas.findIndex(l => /^##\s+hoy\s*$/i.test(l))
  if (i < 0) return texto
  for (let j = i + 1; j < lineas.length && !/^#{1,2}\s/.test(lineas[j]!); j++) {
    lineas[j] = lineas[j]!.replace(/^(\s*[-*+]\s+)\[[xX]\]/, '$1[ ]')
  }
  return lineas.join('\n')
}

export const PROMPT_CIERRE = (o: { registro: string; fichas: string[]; hoy: string[]; dia: string }) =>
  [
    `[Huddle · /cierre] Cierra el día ${o.dia}.`,
    `1. Añade al final de ${o.registro} un resumen del día de 2 a 4 líneas, cada una como «- ${o.dia} · …».`,
    o.fichas.length > 0
      ? `2. Actualiza la sección «## Próximos pasos» (como mucho 3) de estas fichas: ${o.fichas.join(', ')}.`
      : '2. Hoy no se tocó ningún proyecto en seguimiento: no cambies ninguna ficha.',
    o.hoy.length > 0 ? `Tareas de «Hoy» (ya desmarcadas para mañana):\n${o.hoy.join('\n')}` : 'No había tareas en «Hoy».',
    'Usa solo ficheros de la carpeta de control (registro/, ESTADO.md, proyectos/*.md y .agentos/). No leas código de los proyectos ni ejecutes git. Al terminar, responde con una sola línea.',
  ].join('\n')

export async function cierre($: EngineInterface): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const dia = diaLocal(Date.now(), desfaseActual())
  const agentos = unir(config.general_dir, '.agentos')

  // Turnos de hoy por proyecto: los de las sesiones abiertas y los ya juntados.
  const turnos = new Map<string, number>()
  try {
    for (const f of await $.fs.list(unir(agentos, 'actividad'))) {
      const a = interpretarActividad((await leerTexto($, unir(agentos, 'actividad', f.name))) ?? '')
      if (a && a.dias[dia]) turnos.set(a.proyecto, (turnos.get(a.proyecto) ?? 0) + a.dias[dia]!)
    }
  } catch {
    // sin actividad
  }
  const total = interpretarActividadTotal((await leerTexto($, unir(agentos, 'actividad.json'))) ?? '')
  for (const [p, n] of Object.entries(total?.dias[dia] ?? {})) turnos.set(p, (turnos.get(p) ?? 0) + n)
  let git: GitCache | null = null
  try {
    git = JSON.parse((await leerTexto($, unir(agentos, 'git-cache.json'))) ?? 'null') as GitCache | null
  } catch {
    git = null
  }
  const commits = new Map<string, number>()
  for (const [c, r] of Object.entries(git?.repos ?? {})) if (r.commits_dia[dia]) commits.set(c, r.commits_dia[dia]!)

  const tocados = [...new Set([...turnos.keys(), ...commits.keys()])].filter(p => p !== 'GENERAL' && p !== 'otros')
  const fichas: string[] = []
  for (const p of tocados) {
    const ruta = unir(config.general_dir, 'proyectos', `${p}.md`)
    if ((await leerTexto($, ruta)) !== undefined) fichas.push(ruta)
  }

  const rutaEstado = unir(config.general_dir, 'ESTADO.md')
  const estado = (await leerTexto($, rutaEstado)) ?? ''
  const hoyLineas = seccion(estado, 'Hoy').filter(l => /^\s*[-*+]\s+\[[ xX]\]/.test(l)).map(l => l.trim())
  const hoy = casillas(hoyLineas)

  const nTurnos = [...turnos.values()].reduce((a, b) => a + b, 0)
  const nCommits = [...commits.values()].reduce((a, b) => a + b, 0)
  const rutaRegistro = await apuntar(
    $,
    config,
    `/cierre · ${nTurnos} turno(s) · ${git ? `${nCommits} commit(s)` : 'commits n/d (sin /refresh)'} · Hoy ${hoy.hechas}/${hoy.total}${tocados.length > 0 ? ` · ${tocados.join(', ')}` : ''}`,
  )
  if (hoy.total > 0) await escribirAtomico($, rutaEstado, desmarcarHoy(estado))
  encolarPrompt($, PROMPT_CIERRE({ registro: rutaRegistro, fichas, hoy: hoyLineas, dia }))

  return [
    `Cierre del ${dia}: ${nTurnos} turno(s), ${git ? `${nCommits} commit(s)` : 'commits n/d'}, Hoy ${hoy.hechas}/${hoy.total}.`,
    tocados.length > 0 ? `Proyectos tocados: ${tocados.join(', ')}` : 'Hoy no se tocó ningún proyecto en seguimiento.',
    hoy.total > 0 ? '«Hoy» queda desmarcado para mañana.' : '',
    'Ahora Claude escribe el resumen y los próximos pasos.',
  ]
    .filter(Boolean)
    .join('\n')
}
