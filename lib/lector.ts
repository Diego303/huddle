// El lector del panel: lo que la sesión torre lee cada 2 s (§3 del plan). Solo
// ficheros de la carpeta de control; nunca git ni nada de los proyectos. Cada
// fichero se relee únicamente si cambió su fecha de modificación, y un JSON a
// medio escribir se ignora conservando la última versión buena.

import type { EngineInterface } from 'claude-code'

import { interpretarActividad } from './actividad.ts'
import type { Config } from './config.ts'
import type { EstadoSesion, Uso } from './estado.ts'
import type { Casillas, Dia, Ficha } from './panel-datos.ts'
import { casillas, interpretarFicha, seccion, siguienteAccion, usoMasReciente } from './panel-datos.ts'
import { interpretarProyectos } from './proyectos.ts'
import { unir } from './rutas.ts'
import { ultimosDias } from './tiempo.ts'

export type FichaLeida = Ficha & { mtime: number }

/** Todo lo que el panel necesita, como datos planos (va a `$.state`). */
export type DatosPanel = {
  generado: number
  desfase: number
  general_dir: string
  raiz: string
  inactiva_min: number
  sesiones: EstadoSesion[]
  fichas: FichaLeida[]
  hoy: Casillas | null
  siguiente: string[]
  dias: Dia[]
  turnosTotales: number
  uso: Uso | null
  sinClasificar: number
  ultimoRefresh: number | null
}

type Entrada<T> = { mtime: number; valor: T }
const cache = new Map<string, Entrada<unknown>>()

async function leerSiCambio<T>(
  $: EngineInterface,
  ruta: string,
  mtime: number,
  interpretar: (texto: string) => T | null,
): Promise<T | null> {
  const previa = cache.get(ruta) as Entrada<T> | undefined
  if (previa && previa.mtime === mtime) return previa.valor
  try {
    const valor = interpretar(await $.fs.read(ruta))
    if (valor === null) return previa?.valor ?? null
    cache.set(ruta, { mtime, valor })
    return valor
  } catch {
    return previa?.valor ?? null
  }
}

async function listar($: EngineInterface, dir: string): Promise<{ name: string; mtimeMs: number }[]> {
  try {
    return (await $.fs.list(dir)).filter(e => e.kind === 'file')
  } catch {
    return []
  }
}

async function mtimeDe($: EngineInterface, ruta: string): Promise<number | null> {
  try {
    return (await $.fs.stat(ruta)).mtimeMs
  } catch {
    return null
  }
}

function json<T>(validar: (v: unknown) => T | null): (texto: string) => T | null {
  return texto => {
    try {
      return validar(JSON.parse(texto))
    } catch {
      return null
    }
  }
}

const estadoValido = (v: unknown): EstadoSesion | null => {
  const s = v as EstadoSesion
  return s && s.version === 1 && typeof s.session_id === 'string' && Array.isArray(s.agentes) ? s : null
}

export async function leerPanel($: EngineInterface, config: Config, desfase: number, usoPropio: Uso | null): Promise<DatosPanel> {
  const agentos = unir(config.general_dir, '.agentos')
  const ahora = Date.now()

  // Sesiones
  const dirEstado = unir(agentos, 'estado')
  const sesiones: EstadoSesion[] = []
  for (const f of await listar($, dirEstado)) {
    if (!f.name.endsWith('.json')) continue
    const s = await leerSiCambio($, unir(dirEstado, f.name), f.mtimeMs, json(estadoValido))
    if (s) sesiones.push(s)
  }

  // PROYECTOS.md
  const rutaProyectos = unir(config.general_dir, 'PROYECTOS.md')
  const mProyectos = await mtimeDe($, rutaProyectos)
  const doc = mProyectos === null ? null : await leerSiCambio($, rutaProyectos, mProyectos, interpretarProyectos)

  // Fichas de los proyectos en seguimiento, en el orden de PROYECTOS.md
  const dirFichas = unir(config.general_dir, 'proyectos')
  const enDisco = new Map((await listar($, dirFichas)).map(f => [f.name.toLowerCase(), f]))
  const fichas: FichaLeida[] = []
  for (const e of doc?.seguimiento ?? []) {
    const f = enDisco.get(`${e.carpeta.toLowerCase()}.md`)
    if (!f) continue
    const ficha = await leerSiCambio($, unir(dirFichas, f.name), f.mtimeMs, t => interpretarFicha(e.carpeta, t))
    if (ficha) fichas.push({ ...ficha, codigo: ficha.codigo || e.codigo, mtime: f.mtimeMs })
  }

  // ESTADO.md
  const rutaEstadoMd = unir(config.general_dir, 'ESTADO.md')
  const mEstado = await mtimeDe($, rutaEstadoMd)
  const estadoMd =
    mEstado === null
      ? null
      : await leerSiCambio($, rutaEstadoMd, mEstado, t => ({ hoy: casillas(seccion(t, 'Hoy')), siguiente: siguienteAccion(t) }))

  // Actividad: turnos por día de todas las sesiones
  const dias = ultimosDias(ahora, desfase, 7)
  const turnos = new Map<string, number>(dias.map(d => [d, 0]))
  let turnosTotales = 0
  const dirActividad = unir(agentos, 'actividad')
  for (const f of await listar($, dirActividad)) {
    if (!f.name.endsWith('.json')) continue
    const a = await leerSiCambio($, unir(dirActividad, f.name), f.mtimeMs, interpretarActividad)
    if (!a) continue
    for (const [d, n] of Object.entries(a.dias)) {
      turnosTotales += n
      if (turnos.has(d)) turnos.set(d, (turnos.get(d) ?? 0) + n)
    }
  }

  return {
    generado: ahora,
    desfase,
    general_dir: config.general_dir,
    raiz: config.raiz_proyectos,
    inactiva_min: config.inactiva_min,
    sesiones,
    fichas,
    hoy: estadoMd?.hoy ?? null,
    siguiente: estadoMd?.siguiente ?? [],
    // Los commits llegan con /refresh (git-cache.json); hasta entonces, n/d.
    dias: dias.map(d => ({ dia: d, turnos: turnos.get(d) ?? 0, commits: null })),
    turnosTotales,
    uso: usoMasReciente([usoPropio, ...sesiones.map(s => s.uso)]),
    sinClasificar: doc?.sinClasificar.length ?? 0,
    ultimoRefresh: null,
  }
}
