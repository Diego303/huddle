// El lector del panel: lo que la sesión torre lee cada 2 s (§3 del plan). Solo
// ficheros de la carpeta de control; nunca git ni nada de los proyectos. Cada
// fichero se relee únicamente si cambió su fecha de modificación, y un JSON a
// medio escribir se ignora conservando la última versión buena.

import type { EngineInterface } from 'claude-code'

import { interpretarActividad, interpretarActividadTotal, turnosDelDia } from './actividad.ts'
import type { Ignorado } from './atascos.ts'
import { interpretarIgnorados } from './atascos.ts'
import type { Config } from './config.ts'
import type { EstadoSesion, Uso } from './estado.ts'
import type { Instantanea } from './estado-md.ts'
import type { GitCache } from './git.ts'
import type { Casillas, Dia, Ficha } from './panel-datos.ts'
import { casillas, interpretarFicha, seccion, siguienteAccion, usoMasReciente } from './panel-datos.ts'
import { interpretarProyectos } from './proyectos.ts'
import { unir } from './rutas.ts'
import { horaLocal, ultimosDias, ultimoReinicio } from './tiempo.ts'

export type FichaLeida = Ficha & { mtime: number }

/** Lo que el panel usa de git-cache.json, por proyecto. */
export type GitPanel = {
  rama: string | null
  ahead: number
  cambios: number
  sucio_desde: string | null
  error: string | null
  ci: 'ok' | 'fallo' | 'en_curso' | null
}

/** Uso estimado (`≈`) con los tokens locales y `limites`, solo si no hay dato oficial. */
export type UsoEstimado = { cinco_horas: number | null; semana: number | null; reinicioSemana: number | null }

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
  /** De /refresh; vacío si aún no se ha hecho ninguno. */
  git: Record<string, GitPanel>
  usoEstimado: UsoEstimado | null
  rex_estacional: boolean
  /** Los proyectos de «Hacer seguimiento», en el orden de PROYECTOS.md (tengan ficha o no). */
  seguimiento: string[]
  enSeguimiento: number
  /** Tokens de los transcripts por proyecto y hora (de todas las sesiones, vivas y cerradas). */
  tokensProyecto: Record<string, Record<string, number>>
  /** Atascos que ignoraste desde la web (con /huddle ignorar). */
  ignorados: Ignorado[]
  /** Los límites de config.json, para el uso por proyecto sin dato oficial (≈). */
  limites: Config['limites']
}

/** Suma los tokens de las horas desde `desde` (en ms) hasta ahora. */
export function tokensDesde(horas: ReadonlyMap<string, number>, desdeHora: string): number {
  let n = 0
  for (const [h, v] of horas) if (h >= desdeHora) n += v
  return n
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
  const rutaTotal = unir(agentos, 'actividad.json')
  const mTotal = await mtimeDe($, rutaTotal)
  const total = mTotal === null ? null : await leerSiCambio($, rutaTotal, mTotal, interpretarActividadTotal)
  const tokens = new Map<string, number>()
  const tokensProyecto: Record<string, Record<string, number>> = {}
  const sumarHoras = (h: Record<string, number> | undefined, proyecto?: string) => {
    for (const [k, v] of Object.entries(h ?? {})) {
      tokens.set(k, (tokens.get(k) ?? 0) + v)
      if (proyecto === undefined) continue
      const p = (tokensProyecto[proyecto] ??= {})
      p[k] = (p[k] ?? 0) + v
    }
  }
  if (total) {
    sumarHoras(total.tokens)
    for (const [p, hs] of Object.entries(total.tokensProyecto ?? {})) {
      const destino = (tokensProyecto[p] ??= {})
      for (const [h, n] of Object.entries(hs)) destino[h] = (destino[h] ?? 0) + n
    }
    turnosTotales += total.total
    for (const d of dias) turnos.set(d, (turnos.get(d) ?? 0) + turnosDelDia(total, d))
  }
  const dirActividad = unir(agentos, 'actividad')
  for (const f of await listar($, dirActividad)) {
    if (!f.name.endsWith('.json')) continue
    const a = await leerSiCambio($, unir(dirActividad, f.name), f.mtimeMs, interpretarActividad)
    if (!a) continue
    sumarHoras(a.tokens, a.proyecto)
    for (const [d, n] of Object.entries(a.dias)) {
      turnosTotales += n
      if (turnos.has(d)) turnos.set(d, (turnos.get(d) ?? 0) + n)
    }
  }

  // git-cache.json y ultimo-refresh.json, de /refresh
  const rutaGit = unir(agentos, 'git-cache.json')
  const mGit = await mtimeDe($, rutaGit)
  const git = mGit === null ? null : await leerSiCambio($, rutaGit, mGit, json(v => ((v as GitCache)?.repos ? (v as GitCache) : null)))
  const commits = new Map<string, number>()
  for (const r of Object.values(git?.repos ?? {})) for (const [d, n] of Object.entries(r.commits_dia)) commits.set(d, (commits.get(d) ?? 0) + n)
  const rutaInst = unir(agentos, 'ultimo-refresh.json')
  const mInst = await mtimeDe($, rutaInst)
  const inst = mInst === null ? null : await leerSiCambio($, rutaInst, mInst, json(v => (typeof (v as Instantanea)?.ms === 'number' ? (v as Instantanea) : null)))

  const rutaIgnorados = unir(agentos, 'atascos-ignorados.json')
  const mIgn = await mtimeDe($, rutaIgnorados)
  const ignorados = mIgn === null ? [] : ((await leerSiCambio($, rutaIgnorados, mIgn, t => interpretarIgnorados(t))) ?? [])

  const usoOficial = usoMasReciente([usoPropio, ...sesiones.map(s => s.uso)])
  let usoEstimado: UsoEstimado | null = null
  const { sesion_5h_tokens: lim5, semana_tokens: limSemana, reinicio_semanal } = config.limites
  if (usoOficial === null && (lim5 !== null || limSemana !== null)) {
    const reinicio = ultimoReinicio(ahora, desfase, reinicio_semanal)
    usoEstimado = {
      cinco_horas: lim5 === null ? null : Math.round((tokensDesde(tokens, horaLocal(ahora - 5 * 3600_000, desfase)) / lim5) * 100),
      semana: limSemana === null || reinicio === null ? null : Math.round((tokensDesde(tokens, horaLocal(reinicio, desfase)) / limSemana) * 100),
      reinicioSemana: reinicio === null ? null : reinicio + 7 * 86_400_000,
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
    // Sin /refresh todavía no hay commits: n/d.
    dias: dias.map(d => ({ dia: d, turnos: turnos.get(d) ?? 0, commits: git ? (commits.get(d) ?? 0) : null })),
    turnosTotales,
    uso: usoOficial,
    sinClasificar: doc?.sinClasificar.length ?? 0,
    ultimoRefresh: inst?.ms ?? null,
    usoEstimado,
    rex_estacional: config.rex.estacional,
    seguimiento: (doc?.seguimiento ?? []).map(e => e.carpeta),
    enSeguimiento: doc?.seguimiento.length ?? 0,
    tokensProyecto,
    ignorados,
    limites: config.limites,
    git: Object.fromEntries(
      Object.entries(git?.repos ?? {}).map(([c, r]) => [c, { rama: r.rama, ahead: r.ahead, cambios: r.cambios, sucio_desde: r.sucio_desde, error: r.error, ci: r.ci ?? null }]),
    ),
  }
}
