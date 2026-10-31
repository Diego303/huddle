// Lo que hace cada sesión de Claude Code con Huddle instalado: llevar su estado
// en memoria y volcarlo a GENERAL/.agentos/estado/<session_id>.json.
//
// Reglas (§0 del plan): los hooks solo tocan memoria y devuelven enseguida; la
// escritura va después, agrupada, en un temporizador. Cualquier error se traga:
// Huddle nunca rompe una sesión. No se guarda texto de prompts ni respuestas.

import type { EngineInterface } from 'claude-code'

import type { ActividadSesion } from './actividad.ts'
import { actividadVacia, DIAS_GUARDADOS, interpretarActividad, podar, sumarTurno } from './actividad.ts'
import type { Config } from './config.ts'
import { estaConfigurada, leerConfig } from './config.ts'
import type { EstadoSesion, Evento } from './estado.ts'
import { aplicar, estadoInicial } from './estado.ts'
import { borrar, escribirAtomico, esDirectorio, leerTexto } from './ficheros.ts'
import type { Plataforma } from './notificar.ts'
import { avisar, plataformaDe } from './notificar.ts'
import { interpretarProyectos } from './proyectos.ts'
import { normalizar, padre, unir } from './rutas.ts'
import { clasificar, gitdirDeFichero, ramaDeHead } from './sesion-proyecto.ts'
import { desfaseDeTexto, diaLocal, isoLocal, ultimosDias } from './tiempo.ts'

/** Cuánto se espera para agrupar escrituras. */
const ESPERA_VOLCADO_MS = 100

type Origen = { sessionId?: string; cwd?: string; transcript?: string; modelo?: string }

type Contexto = {
  /** Sesión interactiva, con Huddle configurado y la carpeta de control en su sitio. */
  activo: boolean
  /** session.start ya dijo si es interactiva. */
  interactiva: boolean | null
  cerrada: boolean
  config: Config | null
  dirEstado: string
  dirActividad: string
  estado: EstadoSesion | null
  actividad: ActividadSesion | null
  origen: Origen
  desfase: number
  plataforma: Plataforma
  sucio: boolean
  actividadSucia: boolean
  necesitaUso: boolean
  necesitaAgentes: boolean
  temporizador: { cancel: () => void } | null
  volcando: boolean
  ultimoAviso: number
  /** Eventos que llegan antes de tener el estado (arranque o tras /clear). */
  cola: Evento[]
  diagnostico: boolean
  maxMs: number
  eventos: number
}

const ctx: Contexto = {
  activo: false,
  interactiva: null,
  cerrada: false,
  config: null,
  dirEstado: '',
  dirActividad: '',
  estado: null,
  actividad: null,
  origen: {},
  desfase: 0,
  plataforma: 'otra',
  sucio: false,
  actividadSucia: false,
  necesitaUso: false,
  necesitaAgentes: false,
  temporizador: null,
  volcando: false,
  ultimoAviso: 0,
  cola: [],
  diagnostico: false,
  maxMs: 0,
  eventos: 0,
}

function ahora(): string {
  return isoLocal(Date.now(), ctx.desfase)
}

/** Para los tests: vuelve al estado de un módulo recién cargado. */
export function reiniciarContexto(): void {
  ctx.temporizador?.cancel()
  Object.assign(ctx, {
    activo: false,
    interactiva: null,
    cerrada: false,
    config: null,
    estado: null,
    actividad: null,
    origen: {},
    sucio: false,
    actividadSucia: false,
    necesitaUso: false,
    necesitaAgentes: false,
    temporizador: null,
    volcando: false,
    ultimoAviso: 0,
    cola: [],
    maxMs: 0,
    eventos: 0,
  })
}

export function estadoActual(): EstadoSesion | null {
  return ctx.estado
}

export function rutaEstado(id: string): string {
  return unir(ctx.dirEstado, `${id}.json`)
}

/** La rama de un repo leyendo `.git/HEAD` (o el `gitdir` de un worktree), subiendo desde `cwd`. */
export async function leerRama($: EngineInterface, cwd: string): Promise<string | null> {
  let dir = normalizar(cwd)
  for (let i = 0; i < 25; i++) {
    const punto = unir(dir, '.git')
    try {
      const st = await $.fs.stat(punto)
      let gitdir: string | null = punto
      if (st.kind === 'file') gitdir = gitdirDeFichero((await leerTexto($, punto)) ?? '', dir)
      if (gitdir === null) return null
      const head = await leerTexto($, unir(gitdir, 'HEAD'))
      return head === undefined ? null : ramaDeHead(head)
    } catch {
      // no hay .git aquí: se sube un nivel
    }
    const arriba = padre(dir)
    if (arriba === dir) return null
    dir = arriba
  }
  return null
}

async function desfaseDelSistema($: EngineInterface): Promise<number> {
  try {
    const r = await $.process.run(['date', '+%z'], { timeoutMs: 2000 })
    return r.exitCode === 0 ? desfaseDeTexto(r.stdout) : 0
  } catch {
    return 0
  }
}

async function plataformaDelSistema($: EngineInterface): Promise<Plataforma> {
  const wsl = await $.env.get('WSL_DISTRO_NAME')
  if (wsl) return 'wsl'
  try {
    return plataformaDe(undefined, (await $.process.run(['uname', '-s'], { timeoutMs: 2000 })).stdout)
  } catch {
    return 'otra'
  }
}

function interpretarEstado(json: string | undefined): EstadoSesion | null {
  if (json === undefined) return null
  try {
    const v = JSON.parse(json) as EstadoSesion
    return v && v.version === 1 && typeof v.session_id === 'string' ? v : null
  } catch {
    return null
  }
}

/** Lo que llega en `classic.SessionStart`, que el motor manda antes que `session.start`. */
export function anotarOrigen($: EngineInterface, e: { session_id: string; cwd: string; transcript_path: string; model?: string; source: string }): void {
  ctx.origen = { sessionId: e.session_id, cwd: e.cwd, transcript: e.transcript_path, ...(e.model ? { modelo: e.model } : {}) }
  // Tras /clear no hay session.start: la sesión sigue con otro id.
  if (e.source === 'clear' && ctx.interactiva === true) void arrancarSesion($, true)
}

/**
 * Prepara el estado de la sesión: config, proyecto, rama y lo que hubiera en
 * disco de esta misma sesión (una recarga del mod no pierde nada).
 */
export async function arrancarSesion($: EngineInterface, interactiva: boolean): Promise<void> {
  try {
    ctx.interactiva = interactiva
    ctx.cerrada = false
    if (!interactiva || (await $.env.get('HUDDLE_IGNORAR'))) {
      ctx.activo = false
      return
    }
    const { config } = await leerConfig($)
    if (!estaConfigurada(config) || !(await esDirectorio($, config.general_dir))) {
      ctx.activo = false
      return
    }
    ctx.config = config
    ctx.dirEstado = unir(config.general_dir, '.agentos', 'estado')
    ctx.dirActividad = unir(config.general_dir, '.agentos', 'actividad')
    ctx.diagnostico = Boolean(await $.env.get('HUDDLE_DIAG'))
    ctx.desfase = await desfaseDelSistema($)
    ctx.plataforma = await plataformaDelSistema($)

    const id = ctx.origen.sessionId ?? (await $.session.id())
    const cwd = normalizar(ctx.origen.cwd ?? (await $.session.cwd()))
    const textoProyectos = await leerTexto($, unir(config.general_dir, 'PROYECTOS.md'))
    const doc = textoProyectos === undefined ? null : interpretarProyectos(textoProyectos)
    const repo = await $.session.repo().catch(() => null)
    const c = clasificar(cwd, repo?.root ?? null, config, doc)
    const rama = c.tipo === 'proyecto' ? await leerRama($, cwd) : c.tipo === 'torre' ? 'torre' : null

    const momento = ahora()
    const previo = interpretarEstado(await leerTexto($, rutaEstado(id)))
    const base = estadoInicial({
      session_id: id,
      ...c,
      cwd,
      rama,
      ahora: momento,
      modelo: ctx.origen.modelo ?? null,
      transcript_path: ctx.origen.transcript ?? null,
    })
    ctx.estado = previo
      ? { ...base, inicio: previo.inicio, agentes: previo.agentes, uso: previo.uso, estado: previo.estado, detalle: previo.detalle,
          contexto_pct: previo.contexto_pct, contexto_tokens: previo.contexto_tokens, ventana: previo.ventana,
          modelo: base.modelo ?? previo.modelo, transcript_path: base.transcript_path ?? previo.transcript_path }
      : base
    const act = interpretarActividad((await leerTexto($, unir(ctx.dirActividad, `${id}.json`))) ?? '')
    ctx.actividad = act && act.session_id === id ? act : actividadVacia(id, c.proyecto)
    ctx.activo = true
    ctx.necesitaUso = true
    ctx.sucio = true

    const cola = ctx.cola
    ctx.cola = []
    for (const e of cola) ctx.estado = aplicar(ctx.estado, e, momento)
    programar($)
  } catch {
    ctx.activo = false
  }
}

/** Aplica un evento al estado en memoria. Síncrono y barato: es lo que hacen los hooks. */
export function registrar($: EngineInterface, e: Evento): void {
  const t0 = Date.now()
  try {
    if (ctx.cerrada) return
    if (ctx.estado === null) {
      // Aún arrancando (o tras /clear): se aplica en cuanto haya estado.
      if (ctx.interactiva !== false && ctx.cola.length < 200) ctx.cola.push(e)
      return
    }
    if (!ctx.activo) return
    const antes = ctx.estado.estado
    ctx.estado = aplicar(ctx.estado, e, ahora())
    if (antes !== 'te_espera' && ctx.estado.estado === 'te_espera') quizaAvisar($, ctx.estado)
    ctx.sucio = true
    programar($)
  } catch {
    // nunca rompe la sesión
  } finally {
    ctx.eventos += 1
    ctx.maxMs = Math.max(ctx.maxMs, Date.now() - t0)
  }
}

/** Pide releer el uso y los agentes en el próximo volcado (tras cada turno). */
export function pedirUso($: EngineInterface, agentes: boolean): void {
  ctx.necesitaUso = true
  if (agentes) ctx.necesitaAgentes = true
  if (ctx.activo) programar($)
}

/** Un turno que tecleó la persona (§2.9). */
export function contarTurno($: EngineInterface): void {
  try {
    if (!ctx.activo || ctx.actividad === null || ctx.cerrada) return
    const ms = Date.now()
    const desde = ultimosDias(ms, ctx.desfase, DIAS_GUARDADOS)[0] ?? ''
    ctx.actividad = podar(sumarTurno(ctx.actividad, diaLocal(ms, ctx.desfase)), desde)
    ctx.actividadSucia = true
    programar($)
  } catch {
    // nunca rompe la sesión
  }
}

function quizaAvisar($: EngineInterface, s: EstadoSesion): void {
  const c = ctx.config
  if (c === null || !c.notificaciones.windows || s.tipo === 'torre') return
  const ms = Date.now()
  if (ms - ctx.ultimoAviso < c.notificaciones.repetir_min * 60_000) return
  ctx.ultimoAviso = ms
  const donde = s.rama && s.tipo === 'proyecto' ? `${s.proyecto} · ${s.rama}` : s.proyecto
  avisar($, ctx.plataforma, `Huddle · ${donde}`, `Te espera: ${s.detalle}`)
}

function programar($: EngineInterface): void {
  if (ctx.temporizador !== null) return
  try {
    ctx.temporizador = $.clock.after(ESPERA_VOLCADO_MS, () => {
      ctx.temporizador = null
      void volcar($)
    })
  } catch {
    ctx.temporizador = null
  }
}

/** Escribe el estado (y la actividad) a disco. Lo llama el temporizador, nunca un hook. */
export async function volcar($: EngineInterface): Promise<void> {
  if (ctx.volcando) {
    programar($)
    return
  }
  ctx.volcando = true
  try {
    if (!ctx.activo || ctx.cerrada || ctx.estado === null) return
    if (ctx.necesitaUso) {
      ctx.necesitaUso = false
      const uso = await $.session.usage().catch(() => null)
      if (uso && ctx.estado) ctx.estado = aplicar(ctx.estado, { tipo: 'uso', uso }, ahora())
    }
    if (ctx.necesitaAgentes) {
      ctx.necesitaAgentes = false
      const lista = await $.agent.list().catch(() => null)
      if (lista && ctx.estado) ctx.estado = aplicar(ctx.estado, { tipo: 'agentes', lista }, ahora())
    }
    if (ctx.cerrada || ctx.estado === null) return
    ctx.sucio = false
    const id = ctx.estado.session_id
    const salida = ctx.diagnostico ? { ...ctx.estado, diag: { hook_max_ms: ctx.maxMs, eventos: ctx.eventos } } : ctx.estado
    await escribirAtomico($, rutaEstado(id), `${JSON.stringify(salida, null, 2)}\n`)
    // Si la sesión se cerró (o cambió de id con /clear) mientras se escribía, no se deja el fichero.
    if (ctx.cerrada || ctx.estado?.session_id !== id) await borrar($, rutaEstado(id))
    if (ctx.actividadSucia && ctx.actividad) {
      ctx.actividadSucia = false
      await escribirAtomico($, unir(ctx.dirActividad, `${ctx.actividad.session_id}.json`), `${JSON.stringify(ctx.actividad)}\n`)
    }
  } catch {
    // si el disco falla, se reintenta en el siguiente evento
  } finally {
    ctx.volcando = false
  }
}

/** `session.end`: borra el fichero de estado. Tras /clear, la sesión sigue con otro id. */
export async function cerrarSesion($: EngineInterface, motivo: string): Promise<void> {
  ctx.temporizador?.cancel()
  ctx.temporizador = null
  const estado = ctx.estado
  const actividad = ctx.actividad
  ctx.estado = null
  if (motivo === 'clear') {
    ctx.origen = {}
  } else {
    ctx.cerrada = true
  }
  if (!ctx.activo || estado === null) return
  try {
    if (ctx.actividadSucia && actividad) {
      ctx.actividadSucia = false
      await escribirAtomico($, unir(ctx.dirActividad, `${actividad.session_id}.json`), `${JSON.stringify(actividad)}\n`)
    }
  } catch {
    // se pierde, como mucho, el último turno
  }
  await borrar($, rutaEstado(estado.session_id))
}

/** `classic.CwdChanged`: la sesión puede haber cambiado de proyecto. */
export async function cambiarDirectorio($: EngineInterface, cwd: string): Promise<void> {
  try {
    if (!ctx.activo || ctx.estado === null || ctx.config === null) return
    const textoProyectos = await leerTexto($, unir(ctx.config.general_dir, 'PROYECTOS.md'))
    const doc = textoProyectos === undefined ? null : interpretarProyectos(textoProyectos)
    const repo = await $.session.repo().catch(() => null)
    const c = clasificar(normalizar(cwd), repo?.root ?? null, ctx.config, doc)
    const rama = c.tipo === 'proyecto' ? await leerRama($, cwd) : c.tipo === 'torre' ? 'torre' : null
    if (ctx.estado === null) return
    ctx.estado = { ...ctx.estado, ...c, cwd: normalizar(cwd), rama }
    ctx.sucio = true
    programar($)
  } catch {
    // se queda con el proyecto anterior
  }
}
