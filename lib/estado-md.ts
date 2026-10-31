// ESTADO.md (§2.5 del plan), regenerado por /refresh. La sección «Hoy» es de
// la persona y se conserva tal cual; el resto lo escribe Huddle con datos y
// después Claude puede reescribir «Desde la última vez» y «Siguiente acción».

import type { GitCache } from './git.ts'
import type { Ficha } from './panel-datos.ts'
import { porcentaje, seccion } from './panel-datos.ts'

/** Lo que se recuerda de un /refresh para el siguiente (`.agentos/ultimo-refresh.json`). */
export type Instantanea = {
  fecha: string
  ms: number
  oids: Record<string, string | null>
  sesiones: string[]
  progreso: Record<string, number | null>
}

export type Resumen = {
  desde: string[]
  /** Commits nuevos desde el último /refresh, por proyecto. */
  commitsNuevos: Record<string, number>
}

const MAX_LINEAS = 60

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

/** «Desde la última vez»: commits nuevos, sesiones cerradas y avances de progreso. */
export function desdeLaUltimaVez(previa: Instantanea | null, git: GitCache, sesionesVivas: readonly string[], fichas: readonly Ficha[]): Resumen {
  const commitsNuevos: Record<string, number> = {}
  if (previa === null) return { desde: ['Primer /refresh: a partir de aquí se cuenta lo que cambie.'], commitsNuevos }
  const desde: string[] = []
  for (const [carpeta, r] of Object.entries(git.repos)) {
    if (r.error !== null || r.oid === (previa.oids[carpeta] ?? null)) continue
    const n = r.commits_ts.filter(t => t > previa.ms).length
    if (n > 0) {
      commitsNuevos[carpeta] = n
      desde.push(`${carpeta}: ${plural(n, 'commit nuevo', 'commits nuevos')}`)
    } else {
      desde.push(`${carpeta}: el HEAD cambió (${r.rama ?? 'sin rama'})`)
    }
  }
  const cerradas = previa.sesiones.filter(id => !sesionesVivas.includes(id)).length
  if (cerradas > 0) desde.push(`${plural(cerradas, 'sesión cerrada', 'sesiones cerradas')}`)
  for (const f of fichas) {
    const antes = previa.progreso[f.carpeta]
    const ahora = porcentaje(f.tareas)
    if (antes !== undefined && antes !== ahora && ahora !== null) desde.push(`${f.carpeta}: ${antes ?? '—'}% → ${ahora}%`)
  }
  if (desde.length === 0) desde.push('Sin cambios desde el último /refresh.')
  return { desde: desde.slice(0, 8), commitsNuevos }
}

function haceTexto(ms: number, ahora: number): string {
  const min = Math.max(0, (ahora - ms) / 60_000)
  if (min < 60) return `hace ${Math.round(min)} min`
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 1440)} d`
}

function celda(t: string): string {
  return t.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

export function tablaProyectos(fichas: readonly Ficha[], seguimiento: readonly string[], git: GitCache, ahora: number): string[] {
  const filas = ['| Proyecto | Progreso | Estado | Último commit |', '|---|---|---|---|']
  for (const carpeta of seguimiento) {
    const f = fichas.find(x => x.carpeta === carpeta)
    const pct = f ? porcentaje(f.tareas) : null
    const progreso = f && pct !== null ? `${pct}% (${f.tareas.hechas}/${f.tareas.total})` : '—'
    const r = git.repos[carpeta]
    let estado = 'n/d'
    let ultimo = 'n/d'
    if (r && r.error === null) {
      const partes = [r.rama ?? 'HEAD suelto']
      if (r.cambios > 0) partes.push(plural(r.cambios, 'cambio', 'cambios'))
      if (r.ahead > 0) partes.push(`${r.ahead} sin push`)
      if (r.behind > 0) partes.push(`${r.behind} por traer`)
      if (r.upstream === null && r.oid !== null) partes.push('sin upstream')
      estado = partes.join(' · ')
      ultimo = r.ultimo_commit ? `${haceTexto(r.ultimo_commit.ts, ahora)} · ${r.ultimo_commit.asunto}` : 'sin commits'
    } else if (r) {
      estado = `n/d (${r.error})`
    }
    filas.push(`| ${celda(carpeta)} | ${progreso} | ${celda(estado)} | ${celda(ultimo)} |`)
  }
  return filas
}

/** El ESTADO.md nuevo. `previo` es el texto actual, del que se conserva «Hoy». */
export function generarEstado(opciones: {
  previo: string | null
  fecha: string
  desde: readonly string[]
  siguiente: readonly string[]
  tabla: readonly string[]
}): string {
  const hoy = opciones.previo === null ? [] : seccion(opciones.previo, 'Hoy').filter(l => l.trim() !== '')
  const lineas = [
    `# Estado general · ${opciones.fecha}`,
    '',
    '## Desde la última vez',
    ...opciones.desde.map(d => `- ${d}`),
    '',
    '## Hoy',
    ...hoy,
    '',
    '## Siguiente acción',
    ...(opciones.siguiente.length > 0 ? opciones.siguiente.map((s, i) => `${i + 1}. ${s}`) : ['1. (nada pendiente)']),
    '',
    '## Proyectos',
    ...opciones.tabla,
  ]
  // ≤ 60 líneas: si sobra, se recorta la tabla (lo que más crece) con un aviso.
  if (lineas.length > MAX_LINEAS) {
    const sobra = lineas.length - MAX_LINEAS + 1
    lineas.splice(lineas.length - sobra, sobra, `| … | ${sobra} proyecto(s) más en git-cache.json | | |`)
  }
  return `${lineas.join('\n')}\n`
}

/** La línea de registro: `- AAAA-MM-DD HH:MM · texto`. */
export function lineaRegistro(fechaHora: string, texto: string): string {
  return `- ${fechaHora} · ${texto.replace(/\s*\n\s*/g, ' ').trim()}`
}

/** Añade una línea al diario del mes (lo crea con su título si no existe). */
export function anadirARegistro(actual: string | null, mes: string, linea: string): string {
  const base = actual === null || actual.trim() === '' ? `# Registro · ${mes}\n\n` : actual.endsWith('\n') ? actual : `${actual}\n`
  return `${base}${linea}\n`
}
