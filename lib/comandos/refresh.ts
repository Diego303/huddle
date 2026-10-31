// /refresh: limpia estados caducados, junta la actividad de las sesiones
// cerradas, recoge git de los repos en seguimiento (en paralelo), regenera
// ESTADO.md, apunta una línea en el registro y le pide a Claude que redacte.

import type { EngineInterface } from 'claude-code'

import type { ActividadTotal } from '../actividad.ts'
import { actividadTotalVacia, DIAS_GUARDADOS, HORAS_TOKENS, interpretarActividad, interpretarActividadTotal, juntar } from '../actividad.ts'
import type { Config } from '../config.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import type { EstadoSesion } from '../estado.ts'
import type { Instantanea } from '../estado-md.ts'
import { anadirARegistro, desdeLaUltimaVez, generarEstado, lineaRegistro, tablaProyectos } from '../estado-md.ts'
import { borrar, escribirAtomico, esDirectorio, leerTexto } from '../ficheros.ts'
import type { GitCache } from '../git.ts'
import { estadoCi, recogerTodos } from '../git.ts'
import type { Ficha } from '../panel-datos.ts'
import { accionesPorReglas, interpretarFicha, porcentaje, vistaSesiones } from '../panel-datos.ts'
import { interpretarProyectos } from '../proyectos.ts'
import { encolarPrompt } from '../encolar.ts'
import { unir } from '../rutas.ts'
import { desfaseActual } from '../sesion.ts'
import { horaLocal, isoLocal, ultimosDias } from '../tiempo.ts'

const CADUCA_MS = 24 * 3600_000

function leerJson<T>(texto: string | undefined, validar: (v: unknown) => T | null): T | null {
  if (texto === undefined) return null
  try {
    return validar(JSON.parse(texto))
  } catch {
    return null
  }
}

async function listarJson($: EngineInterface, dir: string): Promise<string[]> {
  try {
    return (await $.fs.list(dir)).filter(e => e.kind === 'file' && e.name.endsWith('.json')).map(e => e.name)
  } catch {
    return []
  }
}

/** Borra los estados sin eventos desde hace más de 24 h. Devuelve los que siguen. */
export async function limpiarEstados($: EngineInterface, dir: string, ahora: number): Promise<{ vivas: EstadoSesion[]; borradas: number }> {
  const vivas: EstadoSesion[] = []
  let borradas = 0
  for (const nombre of await listarJson($, dir)) {
    const ruta = unir(dir, nombre)
    const s = leerJson(await leerTexto($, ruta), v => (v as EstadoSesion)?.version === 1 ? (v as EstadoSesion) : null)
    const ultimo = s ? Date.parse(s.ultimo_evento) : Number.NaN
    if (s === null || !Number.isFinite(ultimo) || ahora - ultimo > CADUCA_MS) {
      await borrar($, ruta)
      borradas += 1
    } else {
      vivas.push(s)
    }
  }
  return { vivas, borradas }
}

/** Junta en actividad.json los turnos de las sesiones que ya no están vivas. */
export async function compactarActividad($: EngineInterface, agentos: string, vivas: readonly string[], desde: string, desdeHora = ''): Promise<ActividadTotal> {
  const rutaTotal = unir(agentos, 'actividad.json')
  let total = interpretarActividadTotal((await leerTexto($, rutaTotal)) ?? '') ?? actividadTotalVacia()
  const dir = unir(agentos, 'actividad')
  const juntadas: string[] = []
  for (const nombre of await listarJson($, dir)) {
    const id = nombre.replace(/\.json$/, '')
    if (vivas.includes(id)) continue
    const a = interpretarActividad((await leerTexto($, unir(dir, nombre))) ?? '')
    if (a) total = juntar(total, a, desde, desdeHora)
    juntadas.push(nombre)
  }
  if (juntadas.length > 0) {
    await escribirAtomico($, rutaTotal, `${JSON.stringify(total)}\n`)
    for (const n of juntadas) await borrar($, unir(dir, n))
  }
  return total
}

export const PROMPT_REDACTAR = (estadoMd: string) =>
  [
    `[Huddle · /refresh] He regenerado ${estadoMd} con datos. Mejora solo dos de sus secciones:`,
    '- «## Desde la última vez»: como mucho 3 viñetas de una línea, lo más importante primero.',
    '- «## Siguiente acción»: como mucho 3 pasos concretos y accionables, numerados.',
    'Usa solo ficheros de la carpeta de control: ESTADO.md, .agentos/git-cache.json, .agentos/estado/*.json y proyectos/*.md.',
    'No leas código de los proyectos, no ejecutes git y no toques «## Hoy» ni la tabla «## Proyectos». Al terminar, responde con una sola línea.',
  ].join('\n')

export type ResultadoRefresh = { texto: string; ms: number; repos: number }

export async function hacerRefresh($: EngineInterface, config: Config, redactar: boolean): Promise<ResultadoRefresh> {
  const t0 = Date.now()
  const desfase = desfaseActual()
  const fecha = isoLocal(t0, desfase)
  const agentos = unir(config.general_dir, '.agentos')

  const { vivas, borradas } = await limpiarEstados($, unir(agentos, 'estado'), t0)
  const desde = ultimosDias(t0, desfase, DIAS_GUARDADOS)[0] ?? ''
  await compactarActividad($, agentos, vivas.map(s => s.session_id), desde, horaLocal(t0 - HORAS_TOKENS * 3600_000, desfase))

  const textoProyectos = await leerTexto($, unir(config.general_dir, 'PROYECTOS.md'))
  if (textoProyectos === undefined) throw new Error('no encuentro PROYECTOS.md: ejecuta /configurar')
  const doc = interpretarProyectos(textoProyectos)
  const seguimiento: string[] = []
  for (const e of doc.seguimiento) if (await esDirectorio($, unir(config.raiz_proyectos, e.carpeta))) seguimiento.push(e.carpeta)

  const rutaGit = unir(agentos, 'git-cache.json')
  const previaGit = leerJson(await leerTexto($, rutaGit), v => (v as GitCache)?.repos ? (v as GitCache) : null)
  const git = await recogerTodos($, config.raiz_proyectos, seguimiento, previaGit, t0, fecha, desfase)
  await estadoCi($, config.raiz_proyectos, git)
  await escribirAtomico($, rutaGit, `${JSON.stringify(git)}\n`)

  const fichas: Ficha[] = []
  for (const c of seguimiento) {
    const t = await leerTexto($, unir(config.general_dir, 'proyectos', `${c}.md`))
    if (t !== undefined) fichas.push(interpretarFicha(c, t))
  }

  const rutaInst = unir(agentos, 'ultimo-refresh.json')
  const previa = leerJson(await leerTexto($, rutaInst), v => (typeof (v as Instantanea)?.ms === 'number' ? (v as Instantanea) : null))
  const resumen = desdeLaUltimaVez(previa, git, vivas.map(s => s.session_id), fichas)

  const vistas = vistaSesiones(vivas, t0, config.inactiva_min)
  const siguiente = [
    ...accionesPorReglas(vistas),
    ...Object.entries(git.repos)
      .filter(([, r]) => r.ahead > 0)
      .map(([c, r]) => `Push en ${c} (${r.ahead} commit${r.ahead === 1 ? '' : 's'} sin subir)`),
  ].slice(0, 3)

  const rutaEstado = unir(config.general_dir, 'ESTADO.md')
  const previo = (await leerTexto($, rutaEstado)) ?? null
  const fechaCorta = fecha.slice(0, 16).replace('T', ' ')
  await escribirAtomico($, rutaEstado, generarEstado({ previo, fecha: fechaCorta, desde: resumen.desde, siguiente, tabla: tablaProyectos(fichas, seguimiento, git, t0) }))

  const nuevos = Object.values(resumen.commitsNuevos).reduce((a, b) => a + b, 0)
  const errores = Object.entries(git.repos).filter(([, r]) => r.error !== null)
  const mes = fecha.slice(0, 7)
  const rutaRegistro = unir(config.general_dir, 'registro', `${mes}.md`)
  const linea = lineaRegistro(fechaCorta, `/refresh · ${seguimiento.length} repos · ${nuevos} commit(s) nuevos · ${vivas.length} sesión(es) abiertas`)
  await escribirAtomico($, rutaRegistro, anadirARegistro((await leerTexto($, rutaRegistro)) ?? null, mes, linea))

  const instantanea: Instantanea = {
    fecha,
    ms: t0,
    oids: Object.fromEntries(Object.entries(git.repos).map(([c, r]) => [c, r.oid])),
    sesiones: vivas.map(s => s.session_id),
    progreso: Object.fromEntries(fichas.map(f => [f.carpeta, porcentaje(f.tareas)])),
  }
  await escribirAtomico($, rutaInst, `${JSON.stringify(instantanea)}\n`)

  const ms = Date.now() - t0
  if (redactar) encolarPrompt($, PROMPT_REDACTAR(rutaEstado))

  const texto = [
    `/refresh en ${(ms / 1000).toFixed(1)} s · ${seguimiento.length} repos · ${vivas.length} sesión(es) abiertas${borradas > 0 ? ` · ${borradas} estado(s) caducado(s) borrados` : ''}`,
    ...resumen.desde.map(d => `· ${d}`),
    ...errores.map(([c, r]) => `· ${c}: git n/d (${r.error})`),
    redactar ? 'Ahora Claude redacta «Desde la última vez» y «Siguiente acción» en ESTADO.md.' : 'ESTADO.md regenerado solo con datos.',
  ].join('\n')
  return { texto, ms, repos: seguimiento.length }
}

export async function refresh($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: abre Claude Code en tu carpeta de control y ejecuta /configurar.'
  const soloDatos = /\b(solo-datos|datos|rapido|rápido)\b/i.test(args)
  return (await hacerRefresh($, config, !soloDatos)).texto
}
