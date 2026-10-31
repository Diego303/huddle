// Metadatos de git de los repos en seguimiento, para /refresh (§2.9 y §4 del
// plan). Solo `status` y `log` acotado, con --no-optional-locks para no tocar ni
// el índice. Por repo, un `git status --porcelain=v2 --branch` siempre; el
// `git log` solo si cambió el HEAD desde la última vez. Todos en paralelo.

import type { EngineInterface } from 'claude-code'

import { unir } from './rutas.ts'
import { diaLocal } from './tiempo.ts'

export type DatosRepo = {
  oid: string | null
  rama: string | null
  upstream: string | null
  ahead: number
  behind: number
  cambios: number
  /** Desde cuándo (ISO) hay cambios sin commitear, según lo visto por /refresh. */
  sucio_desde: string | null
  ultimo_commit: { ts: number; asunto: string } | null
  /** Commits por día local de los últimos 8 días. */
  commits_dia: Record<string, number>
  /** Momento (ms) de cada commit de los últimos 8 días, para «desde la última vez». */
  commits_ts: number[]
  error: string | null
}

export type GitCache = { generado: string; repos: Record<string, DatosRepo> }

export type Estado = { oid: string | null; rama: string | null; upstream: string | null; ahead: number; behind: number; cambios: number }

export function interpretarStatus(salida: string): Estado {
  const e: Estado = { oid: null, rama: null, upstream: null, ahead: 0, behind: 0, cambios: 0 }
  for (const l of salida.split('\n')) {
    if (l === '') continue
    if (!l.startsWith('# ')) {
      e.cambios += 1
      continue
    }
    const [, clave, ...resto] = l.split(' ')
    const valor = resto.join(' ')
    if (clave === 'branch.oid') e.oid = valor === '(initial)' ? null : valor
    else if (clave === 'branch.head') e.rama = valor === '(detached)' ? null : valor
    else if (clave === 'branch.upstream') e.upstream = valor
    else if (clave === 'branch.ab') {
      const m = /^\+(\d+) -(\d+)$/.exec(valor)
      if (m) {
        e.ahead = Number(m[1])
        e.behind = Number(m[2])
      }
    }
  }
  return e
}

/** `git log --format=%ct%x09%s`: el primero es el último commit. */
export function interpretarLog(salida: string): { ts: number; asunto: string }[] {
  return salida
    .split('\n')
    .map(l => {
      const i = l.indexOf('\t')
      const ts = Number(i < 0 ? l : l.slice(0, i)) * 1000
      return Number.isFinite(ts) && ts > 0 ? { ts, asunto: i < 0 ? '' : l.slice(i + 1).slice(0, 120) } : null
    })
    .filter((x): x is { ts: number; asunto: string } => x !== null)
}

export function porDia(ts: readonly number[], desfase: number): Record<string, number> {
  const r: Record<string, number> = {}
  for (const t of ts) {
    const d = diaLocal(t, desfase)
    r[d] = (r[d] ?? 0) + 1
  }
  return r
}

async function git($: EngineInterface, cwd: string, args: string[]): Promise<{ ok: boolean; salida: string; error: string }> {
  try {
    const r = await $.process.run(['git', '--no-optional-locks', '-C', cwd, ...args], { timeoutMs: 20_000 })
    return { ok: r.exitCode === 0, salida: r.stdout, error: r.stderr.trim().split('\n')[0] ?? '' }
  } catch (err) {
    return { ok: false, salida: '', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Los datos de un repo. `previo` evita el `git log` si el HEAD no cambió. */
export async function recogerRepo(
  $: EngineInterface,
  ruta: string,
  previo: DatosRepo | undefined,
  ahora: number,
  ahoraIso: string,
  desfase: number,
): Promise<DatosRepo> {
  const st = await git($, ruta, ['status', '--porcelain=v2', '--branch'])
  if (!st.ok) {
    return { oid: null, rama: null, upstream: null, ahead: 0, behind: 0, cambios: 0, sucio_desde: null, ultimo_commit: null, commits_dia: {}, commits_ts: [], error: st.error || 'no es un repo git' }
  }
  const e = interpretarStatus(st.salida)
  const sucio_desde = e.cambios > 0 ? (previo?.sucio_desde ?? ahoraIso) : null
  const desde = ahora - 8 * 86_400_000
  if (previo && previo.oid === e.oid && previo.error === null) {
    // Mismo HEAD: el log no cambió; solo se descartan los commits que ya caen fuera de la ventana.
    const commits_ts = previo.commits_ts.filter(t => t >= desde)
    return { ...e, sucio_desde, ultimo_commit: previo.ultimo_commit, commits_ts, commits_dia: porDia(commits_ts, desfase), error: null }
  }
  if (e.oid === null) return { ...e, sucio_desde, ultimo_commit: null, commits_ts: [], commits_dia: {}, error: null }
  const [semana, ultimo] = await Promise.all([
    git($, ruta, ['log', `--since=${Math.floor(desde / 1000)}`, '--format=%ct', 'HEAD']),
    git($, ruta, ['log', '-1', '--format=%ct%x09%s', 'HEAD']),
  ])
  const commits_ts = semana.ok ? interpretarLog(semana.salida).map(c => c.ts) : []
  return {
    ...e,
    sucio_desde,
    ultimo_commit: ultimo.ok ? (interpretarLog(ultimo.salida)[0] ?? null) : null,
    commits_ts,
    commits_dia: porDia(commits_ts, desfase),
    error: null,
  }
}

/** Todos los repos a la vez. */
export async function recogerTodos(
  $: EngineInterface,
  raiz: string,
  carpetas: readonly string[],
  previa: GitCache | null,
  ahora: number,
  ahoraIso: string,
  desfase: number,
): Promise<GitCache> {
  const datos = await Promise.all(carpetas.map(c => recogerRepo($, unir(raiz, c), previa?.repos[c], ahora, ahoraIso, desfase)))
  const repos: Record<string, DatosRepo> = {}
  carpetas.forEach((c, i) => {
    repos[c] = datos[i]!
  })
  return { generado: ahoraIso, repos }
}
