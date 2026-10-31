// Lo que hace cada sesión de Claude Code con Huddle instalado: llevar su estado
// en memoria y volcarlo a GENERAL/.agentos/estado/<session_id>.json.
//
// Reglas (§0 del plan): los hooks solo tocan memoria y devuelven enseguida; la
// escritura va después, agrupada, en un temporizador. Cualquier error se traga:
// Huddle nunca rompe una sesión. No se guarda texto de prompts ni respuestas.

import type { EngineInterface } from 'claude-code'

import type { ActividadSesion } from './actividad.ts'
import { actividadVacia, DIAS_GUARDADOS, HORAS_TOKENS, interpretarActividad, podar, sumarHoras, sumarTokens, sumarTurno } from './actividad.ts'
import type { Detector, Ignorado, Senal } from './atascos.ts'
import { detectorVacio, estaIgnorado, evaluar, interpretarIgnorados } from './atascos.ts'
import type { LineaBitacora } from './bitacora.ts'
import {
  contarCambios,
  DIAS_BITACORA,
  diasViejos,
  enmascarar,
  esCommit,
  esSoloLectura,
  esTest,
  hashError,
  lineaAviso,
  lineaBash,
  lineaEdicion,
  lineaSesion,
  lineaSubagente,
  primeraLineaError,
  resumenTests,
  serializarLinea,
  truncar,
} from './bitacora.ts'
import type { Config } from './config.ts'
import { estaConfigurada, leerConfig } from './config.ts'
import { esHerramientaDeAgente, rutaCorta } from './detalle.ts'
import type { EstadoSesion, Evento } from './estado.ts'
import { aplicar, estadoInicial, usoDe } from './estado.ts'
import { anadir, borrar, borrarCarpeta, escribirAtomico, esDirectorio, leerTexto } from './ficheros.ts'
import { huella } from './huella.ts'
import type { EstadoTramo } from './tramos.ts'
import { serializarTramo } from './tramos.ts'
import { bytesUtf8, dirSubagentes, HISTORIA_MAX_BYTES, sumarTrozo } from './transcripts.ts'
import type { Plataforma } from './notificar.ts'
import { avisar, plataformaDe } from './notificar.ts'
import { interpretarProyectos } from './proyectos.ts'
import { normalizar, padre, unir } from './rutas.ts'
import { clasificar, gitdirDeFichero, ramaDeHead } from './sesion-proyecto.ts'
import { desfaseDeTexto, diaLocal, horaLocal, isoLocal, ultimosDias } from './tiempo.ts'
import { escribirDatosWeb, webActiva } from './web.ts'

/** Como mucho una escritura de datos.js cada tanto por sesión (la web relee cada 2 s). */
const INTERVALO_WEB_MS = 700
/** Cada cuánto vuelve a mirar una sesión si se activó la web (/huddle web). */
const REVISAR_WEB_MS = 30_000

/** Cuánto se espera para agrupar escrituras. */
const ESPERA_VOLCADO_MS = 100
/** Lo que se lee de un transcript de una vez. */
const TROZO_TRANSCRIPT = 4_000_000

type Herramienta = { tool: string; entrada: Record<string, unknown>; ms: number; agentId?: string }

type Origen = { sessionId?: string; cwd?: string; transcript?: string; modelo?: string }

/** `ignorada`: no interactiva (claude -p, SDK) o HUDDLE_IGNORAR; `sin_config`: falta /configurar. */
export type Situacion = 'arrancando' | 'ignorada' | 'sin_config' | 'activa'

type Contexto = {
  situacion: Situacion
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
  web: boolean | null
  webRevisada: number
  webUltima: number
  webTemporizador: { cancel: () => void } | null
  /** Pestaña Actividad: líneas por escribir (bitácora y tramos), por fichero. */
  pendientes: Map<string, string>
  ultimoTramo: EstadoTramo | null
  inactividad: { cancel: () => void } | null
  detector: Detector
  herramientas: Map<string, Herramienta>
  permiso: { tool: string; detalle: string | null } | null
  necesitaTokens: boolean
  ignorados: Ignorado[]
  ignoradosLeidos: number
}

const ctx: Contexto = {
  situacion: 'arrancando',
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
  web: null,
  webRevisada: 0,
  webUltima: 0,
  webTemporizador: null,
  pendientes: new Map(),
  ultimoTramo: null,
  inactividad: null,
  detector: detectorVacio(),
  herramientas: new Map(),
  permiso: null,
  necesitaTokens: false,
  ignorados: [],
  ignoradosLeidos: 0,
}

function ahora(): string {
  return isoLocal(Date.now(), ctx.desfase)
}

/** Para los tests: vuelve al estado de un módulo recién cargado. */
export function reiniciarContexto(): void {
  ctx.temporizador?.cancel()
  ctx.inactividad?.cancel()
  Object.assign(ctx, {
    situacion: 'arrancando',
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
    web: null,
    webRevisada: 0,
    webUltima: 0,
    webTemporizador: null,
    pendientes: new Map(),
    ultimoTramo: null,
    inactividad: null,
    detector: detectorVacio(),
    herramientas: new Map(),
    permiso: null,
    necesitaTokens: false,
    ignorados: [],
    ignoradosLeidos: 0,
  })
}

export function situacion(): Situacion {
  return ctx.situacion
}

export function estadoActual(): EstadoSesion | null {
  return ctx.estado
}

export function configActual(): Config | null {
  return ctx.activo ? ctx.config : null
}

export function desfaseActual(): number {
  return ctx.desfase
}

export function ahoraLocal(): string {
  return ahora()
}

export function plataformaActual(): Plataforma {
  return ctx.plataforma
}

/** Reescribe datos.js de la web ahora mismo (si está activa). */
export async function escribirWeb($: EngineInterface): Promise<void> {
  if (ctx.config === null) return
  ctx.webUltima = Date.now()
  try {
    // El uso, en vivo (como la torre): si cada escritor usara uno distinto, datos.js bailaría entre versiones.
    const motor = await $.session.usage().catch(() => null)
    const uso = (motor ? usoDe(motor, ahora()) : null) ?? ctx.estado?.uso ?? null
    await escribirDatosWeb($, ctx.config, ctx.desfase, uso, ahora().slice(11, 19))
  } catch {
    // la web se queda con los datos anteriores
  }
}

/**
 * Tras volcar el estado: si la web está activa, reescribe datos.js, como mucho
 * una vez cada INTERVALO_WEB_MS (con una escritura final si llegan más eventos).
 */
async function quizaWeb($: EngineInterface): Promise<void> {
  if (ctx.config === null) return
  const t = Date.now()
  if (ctx.web !== true && t - ctx.webRevisada > REVISAR_WEB_MS) {
    ctx.webRevisada = t
    ctx.web = await webActiva($, ctx.config)
  }
  if (!ctx.web) return
  const espera = INTERVALO_WEB_MS - (t - ctx.webUltima)
  if (espera <= 0) {
    await escribirWeb($)
    return
  }
  if (ctx.webTemporizador !== null) return
  try {
    ctx.webTemporizador = $.clock.after(espera, () => {
      ctx.webTemporizador = null
      void escribirWeb($)
    })
  } catch {
    ctx.webTemporizador = null
  }
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
      ctx.situacion = 'ignorada'
      return
    }
    const { config } = await leerConfig($)
    if (!estaConfigurada(config) || !(await esDirectorio($, config.general_dir))) {
      ctx.activo = false
      ctx.situacion = 'sin_config'
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
    ctx.situacion = 'activa'
    ctx.necesitaUso = true
    ctx.necesitaTokens = true
    ctx.sucio = true
    ctx.detector = detectorVacio()
    ctx.ultimoTramo = null
    if (previo === null) anotarBitacora(lineaSesion(momento, 'start', nombreDe(ctx.estado)))
    anotarTramo(estadoTramo(ctx.estado), momento)
    vigilarInactividad($)
    void podarDias($, config)

    const cola = ctx.cola
    ctx.cola = []
    for (const e of cola) ctx.estado = aplicar(ctx.estado, e, momento)
    programar($)
  } catch {
    ctx.activo = false
    ctx.situacion = 'sin_config'
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
    const momento = ahora()
    ctx.estado = aplicar(ctx.estado, e, momento)
    if (antes !== 'te_espera' && ctx.estado.estado === 'te_espera') quizaAvisar($, ctx.estado)
    revisarAtasco($, { tipo: 'estado', ms: Date.now(), estado: ctx.estado.estado })
    vigilarInactividad($)
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
    // Una tarea nueva: lo que ignoraste de un atasco deja de valer.
    if (ctx.estado) {
      const a = ctx.estado.atasco
      ctx.estado = { ...ctx.estado, tarea: (ctx.estado.tarea ?? 0) + 1, atasco: a ? { ...a, ignorado: false } : (a ?? null) }
      ctx.sucio = true
    }
    programar($)
  } catch {
    // nunca rompe la sesión
  }
}

/**
 * Los tokens de un turno (también de subagentes), por hora: solo sirven para
 * estimar el uso con `≈` cuando Claude Code no da el dato oficial.
 */
export function contarTokens($: EngineInterface, usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number } | undefined): void {
  try {
    if (!ctx.activo || ctx.actividad === null || ctx.cerrada) return
    // Con transcript, los tokens salen de él (se leen en el volcado); sin él, del turno.
    if (ctx.estado?.transcript_path) {
      ctx.necesitaTokens = true
      programar($)
      return
    }
    if (usage === undefined) return
    const n = usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens
    const ms = Date.now()
    ctx.actividad = sumarTokens(ctx.actividad, horaLocal(ms, ctx.desfase), n, horaLocal(ms - HORAS_TOKENS * 3600_000, ctx.desfase))
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
    if (ctx.necesitaTokens) await leerTranscripts($)
    if (ctx.estado?.atasco && !ctx.estado.atasco.ignorado) await revisarIgnorados($)
    if (ctx.cerrada || ctx.estado === null) return
    ctx.sucio = false
    const id = ctx.estado.session_id
    await escribirPendientes($)
    const salida = ctx.diagnostico ? { ...ctx.estado, diag: { hook_max_ms: ctx.maxMs, eventos: ctx.eventos } } : ctx.estado
    await escribirAtomico($, rutaEstado(id), `${JSON.stringify(salida, null, 2)}\n`)
    // Si la sesión se cerró (o cambió de id con /clear) mientras se escribía, no se deja el fichero.
    if (ctx.cerrada || ctx.estado?.session_id !== id) await borrar($, rutaEstado(id))
    else await quizaWeb($)
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
  ctx.inactividad?.cancel()
  ctx.inactividad = null
  const estado = ctx.estado
  if (ctx.activo && estado !== null) {
    const momento = ahora()
    anotarBitacora(lineaSesion(momento, 'end', nombreDe(estado), motivo === 'clear' ? '/clear' : ''))
    anotarTramo('cerrada', momento)
    await leerTranscripts($).catch(() => undefined)
    await escribirPendientes($)
  }
  const actividad = ctx.actividad
  ctx.estado = null
  ctx.ultimoTramo = null
  ctx.detector = detectorVacio()
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
  // Que la web deje de mostrarla (sin esperar: la salida tiene un tope de tiempo corto).
  if (ctx.web) void escribirWeb($)
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

// ============================================================ pestaña Actividad
// Bitácora, tramos, atascos y tokens. Los hooks solo anotan en memoria; las
// escrituras van en el volcado, como el estado.

/** `struo · feat-auth`, `GENERAL · torre`, `otros · notas`: el nombre de la sesión en la web. */
export function nombreDe(s: EstadoSesion): string {
  if (s.tipo === 'torre') return 'GENERAL · torre'
  if (s.tipo === 'otros') return `otros · ${s.cwd.slice(s.cwd.lastIndexOf('/') + 1)}`
  return `${s.proyecto} · ${s.rama ?? 'n/d'}`
}

function proyectoTramo(s: EstadoSesion): string {
  return s.tipo === 'torre' ? 'GENERAL' : s.tipo === 'otros' ? 'otros' : s.proyecto
}

function agentos(): string {
  return ctx.config === null ? '' : unir(ctx.config.general_dir, '.agentos')
}

function anotarLinea(ruta: string, texto: string): void {
  if (ctx.pendientes.size > 50 || (ctx.pendientes.get(ruta)?.length ?? 0) > 200_000) return
  ctx.pendientes.set(ruta, (ctx.pendientes.get(ruta) ?? '') + texto)
}

function anotarBitacora(l: LineaBitacora): void {
  if (!ctx.activo || ctx.estado === null || ctx.config === null) return
  anotarLinea(unir(agentos(), 'bitacora', l.ts.slice(0, 10), `${ctx.estado.session_id}.jsonl`), serializarLinea(l))
}

/** El estado que se ve en el cronograma: un atasco (no ignorado) tiñe de rojo, salvo si te espera. */
function estadoTramo(s: EstadoSesion): EstadoTramo {
  return s.atasco && !s.atasco.ignorado && s.estado !== 'te_espera' ? 'atascada' : s.estado
}

function anotarTramo(estado: EstadoTramo, ts: string): void {
  const s = ctx.estado
  if (!ctx.activo || s === null || ctx.config === null || estado === ctx.ultimoTramo) return
  ctx.ultimoTramo = estado
  anotarLinea(unir(agentos(), 'tramos', `${ts.slice(0, 10)}.jsonl`), serializarTramo({ ts, session_id: s.session_id, estado, nombre: nombreDe(s), proyecto: proyectoTramo(s) }))
}

async function escribirPendientes($: EngineInterface): Promise<void> {
  const lista = [...ctx.pendientes]
  ctx.pendientes.clear()
  for (const [ruta, texto] of lista) {
    // Si el disco falla, vuelve a la cola para el siguiente volcado.
    if (!(await anadir($, ruta, texto))) anotarLinea(ruta, texto)
  }
}

/** Sin eventos durante `inactiva_min`, el cronograma deja un hueco (salvo si te espera). */
function vigilarInactividad($: EngineInterface): void {
  ctx.inactividad?.cancel()
  ctx.inactividad = null
  const c = ctx.config
  if (c === null || !ctx.activo) return
  try {
    ctx.inactividad = $.clock.after(c.inactiva_min * 60_000, () => {
      ctx.inactividad = null
      if (!ctx.activo || ctx.cerrada || ctx.estado === null || ctx.estado.estado === 'te_espera') return
      anotarTramo('inactiva', ahora())
      programar($)
    })
  } catch {
    ctx.inactividad = null
  }
}

/** Borra la bitácora y los tramos de hace más de 7 días. */
async function podarDias($: EngineInterface, config: Config): Promise<void> {
  try {
    const desde = ultimosDias(Date.now(), ctx.desfase, DIAS_BITACORA)[0] ?? ''
    const dirBitacora = unir(config.general_dir, '.agentos', 'bitacora')
    const dirTramos = unir(config.general_dir, '.agentos', 'tramos')
    const enBitacora = await $.fs.list(dirBitacora).catch(() => [])
    for (const d of diasViejos(enBitacora.filter(e => e.kind === 'dir').map(e => e.name), desde)) await borrarCarpeta($, unir(dirBitacora, d))
    const enTramos = await $.fs.list(dirTramos).catch(() => [])
    for (const f of diasViejos(enTramos.filter(e => e.kind === 'file').map(e => e.name), desde)) await borrar($, unir(dirTramos, f))
  } catch {
    // se intentará en la siguiente sesión
  }
}

/** Aplica una señal al detector y deja el atasco (o su ausencia) en el estado. */
function revisarAtasco($: EngineInterface, senal: Senal): void {
  const c = ctx.config
  if (c === null || ctx.estado === null) return
  const momento = ahora()
  ctx.detector = evaluar(ctx.detector, senal, c.atascos, ms => isoLocal(ms, ctx.desfase))
  const a = ctx.detector.atasco
  const s = ctx.estado
  if (a === null) {
    if (s.atasco) ctx.estado = { ...s, atasco: null }
  } else {
    const previo = s.atasco && s.atasco.clave === a.clave ? s.atasco : null
    const { desdeMs: _d, ...atasco } = a
    ctx.estado = {
      ...s,
      atasco: {
        ...atasco,
        id: huella(`${s.session_id}|${a.clave}`),
        avisado: previo?.avisado ?? false,
        ignorado: previo?.ignorado ?? estaIgnorado(ctx.ignorados, s.session_id, a.clave, s.tarea ?? 0),
      },
    }
    if (!ctx.estado.atasco!.avisado && !ctx.estado.atasco!.ignorado) avisarAtasco($, ctx.estado)
  }
  anotarTramo(estadoTramo(ctx.estado), momento)
}

/** Una sola notificación por atasco, por la misma vía que «te espera». */
function avisarAtasco($: EngineInterface, s: EstadoSesion): void {
  const a = s.atasco
  if (!a) return
  ctx.estado = { ...s, atasco: { ...a, avisado: true } }
  const c = ctx.config
  if (c === null || !c.notificaciones.windows) return
  const donde = s.rama && s.tipo === 'proyecto' ? `${s.proyecto} · ${s.rama}` : s.proyecto
  avisar($, ctx.plataforma, `Huddle · ${donde}`, `Parece atascada: ${a.motivo}`)
}

/** ¿Lo ignoraste desde la web (/huddle ignorar)? Vale hasta la siguiente tarea. Se relee solo si cambió. */
async function revisarIgnorados($: EngineInterface): Promise<void> {
  if (ctx.config === null) return
  const ruta = unir(agentos(), 'atascos-ignorados.json')
  let mtime: number
  try {
    mtime = (await $.fs.stat(ruta)).mtimeMs
  } catch {
    return
  }
  if (mtime === ctx.ignoradosLeidos) return
  ctx.ignoradosLeidos = mtime
  ctx.ignorados = interpretarIgnorados((await leerTexto($, ruta)) ?? '')
  const s = ctx.estado
  if (!s?.atasco || s.atasco.ignorado) return
  if (estaIgnorado(ctx.ignorados, s.session_id, s.atasco.clave, s.tarea ?? 0)) {
    ctx.estado = { ...s, atasco: { ...s.atasco, ignorado: true } }
    anotarTramo(estadoTramo(ctx.estado), ahora())
  }
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Quién hizo algo: vacío para la sesión, `explore · ` para un subagente. */
function quien(agentId: string | undefined): string {
  if (agentId === undefined || ctx.estado === null) return ''
  const a = ctx.estado.agentes.find(x => x.agent_id === agentId)
  return `${a?.tipo ?? 'subagente'} · `
}

/** El principio de una herramienta: se guarda su entrada para cuando termine. */
export function anotarInicio($: EngineInterface, tool: string, entrada: Record<string, unknown>, toolUseId: string, agentId?: string): void {
  try {
    if (!ctx.activo || ctx.estado === null || ctx.cerrada) return
    if (ctx.herramientas.size > 200) ctx.herramientas.clear()
    ctx.herramientas.set(toolUseId, { tool, entrada, ms: Date.now(), ...(agentId === undefined ? {} : { agentId }) })
    if (tool === 'AskUserQuestion' && agentId === undefined) {
      anotarBitacora(lineaAviso(ahora(), 'pregunta', 'Claude te hace una pregunta', null))
      programar($)
    }
  } catch {
    // nunca rompe la sesión
  }
}

type Resultado = { deny?: unknown; isError?: unknown; text?: unknown; result?: unknown }

const EDICIONES = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

/** El final de una herramienta: su línea de bitácora y la señal para el detector. */
export function anotarFin($: EngineInterface, tool: string, toolUseId: string, r: unknown): void {
  try {
    if (!ctx.activo || ctx.estado === null || ctx.cerrada) return
    const h = ctx.herramientas.get(toolUseId)
    ctx.herramientas.delete(toolUseId)
    if (h === undefined || esHerramientaDeAgente(tool)) return
    const o = (r ?? {}) as Resultado
    const res = (o.result && typeof o.result === 'object' ? o.result : {}) as Record<string, unknown>
    const textoModelo = texto(o.text)
    const ms = Date.now()
    const momento = ahora()
    const fallo = o.deny !== undefined || o.isError === true
    const rechazado = o.deny !== undefined || /doesn't want to proceed|was rejected|denied by the user|user rejected/i.test(textoModelo)

    if (EDICIONES.has(tool)) {
      const ruta = texto(h.entrada.file_path) || texto(h.entrada.notebook_path)
      if (ruta === '') return
      const nuevo = res.type === 'create'
      let cambios = contarCambios(res.structuredPatch)
      if ((cambios === null || cambios.mas + cambios.menos === 0) && nuevo) cambios = { mas: texto(h.entrada.content).split('\n').length, menos: 0 }
      anotarBitacora(lineaEdicion(momento, ruta, ctx.estado.cwd, cambios, !fallo, nuevo, quien(h.agentId)))
      if (!fallo) revisarAtasco($, { tipo: 'edit', ms, fichero: rutaCorta(ruta, ctx.estado.cwd), nuevo })
    } else if (tool === 'Bash') {
      const comando = texto(h.entrada.command)
      if (comando === '') return
      if (res.backgroundTaskId !== undefined) {
        anotarBitacora({ ts: momento, tipo: 'bash', resumen: truncar(`${quien(h.agentId)}${enmascarar(comando)} · en segundo plano`) })
      } else if (rechazado || res.interrupted === true) {
        anotarBitacora({ ts: momento, tipo: 'bash', resumen: truncar(`${quien(h.agentId)}${enmascarar(comando)} · ✗ ${rechazado ? 'rechazado' : 'interrumpido'}`), ok: false })
      } else {
        // Dentro del hook: solo un trozo de la salida (el resumen de tests va al final; el error, al principio).
        const salida = [texto(res.stdout), texto(res.stderr), textoModelo].join('\n').slice(-20_000)
        const error = fallo ? primeraLineaError((texto(res.stderr) || textoModelo || texto(res.stdout)).slice(0, 20_000)) : null
        const test = esTest(comando)
        const tests = test ? resumenTests(salida) : null
        const git = res.gitOperation as { commit?: unknown } | undefined
        const commit = !fallo && (git?.commit !== undefined || esCommit(comando))
        anotarBitacora(lineaBash(momento, comando, !fallo, error, tests, quien(h.agentId)))
        const cmd = enmascarar(comando.replace(/\s+/g, ' ').trim())
        revisarAtasco($, {
          tipo: 'bash',
          ms,
          comando: cmd,
          ok: !fallo,
          hash: error === null ? null : hashError(error),
          error,
          test,
          tests: tests ? `${tests.pasan}/${tests.total}` : null,
          commit,
          soloLectura: esSoloLectura(comando),
        })
      }
    } else {
      return
    }
    ctx.sucio = true
    programar($)
  } catch {
    // nunca rompe la sesión
  }
}

/** `classic.PermissionRequest`: qué pide, para la línea de la notificación. */
export function anotarPermiso(tool: string, entrada: unknown): void {
  const e = (entrada ?? {}) as Record<string, unknown>
  const ruta = texto(e.file_path) || texto(e.notebook_path)
  const detalle = tool === 'Bash' ? truncar(enmascarar(texto(e.command)), 80) : ruta !== '' && ctx.estado ? rutaCorta(ruta, ctx.estado.cwd) : tool
  ctx.permiso = { tool, detalle: detalle || null }
}

/** `classic.Notification`: un permiso o una pregunta, con su mensaje. */
export function anotarNotificacion($: EngineInterface, tipo: string, mensaje: string): void {
  try {
    if (!ctx.activo || ctx.estado === null || ctx.cerrada) return
    const p = ctx.permiso
    ctx.permiso = null
    if (tipo === 'permission_prompt') {
      // La pregunta de AskUserQuestion ya tiene su línea.
      if (p?.tool === 'AskUserQuestion') return
      anotarBitacora(lineaAviso(ahora(), 'perm', mensaje || 'pide permiso', p?.detalle ?? null))
    } else if (tipo === 'elicitation_dialog') {
      anotarBitacora(lineaAviso(ahora(), 'pregunta', mensaje || 'te hace una pregunta', null))
    } else {
      return
    }
    programar($)
  } catch {
    // nunca rompe la sesión
  }
}

/** `classic.SubagentStop`: el subagente, con su tipo, su descripción y cuánto duró. */
export function anotarSubagenteFin($: EngineInterface, agentId: string, tipo: string): void {
  try {
    if (!ctx.activo || ctx.estado === null || ctx.cerrada) return
    const a = ctx.estado.agentes.find(x => x.agent_id === agentId)
    const inicio = a ? Date.parse(a.inicio) : NaN
    const min = Number.isFinite(inicio) ? (Date.now() - inicio) / 60_000 : null
    anotarBitacora(lineaSubagente(ahora(), a?.tipo ?? tipo, a?.descripcion ?? tipo, min))
    ctx.necesitaTokens = true
    programar($)
  } catch {
    // nunca rompe la sesión
  }
}

/** Lee lo nuevo del transcript de la sesión (y de sus subagentes) y suma sus tokens por hora. */
async function leerTranscripts($: EngineInterface): Promise<void> {
  ctx.necesitaTokens = false
  const s = ctx.estado
  const inicial = ctx.actividad
  if (s === null || inicial === null || !s.transcript_path) return
  const principal = s.transcript_path
  const ficheros = [principal]
  try {
    const dir = dirSubagentes(principal)
    for (const f of await $.fs.list(dir)) if (f.kind === 'file' && f.name.endsWith('.jsonl')) ficheros.push(unir(dir, f.name))
  } catch {
    // sin subagentes
  }
  const ms = Date.now()
  const desdeHora = horaLocal(ms - HORAS_TOKENS * 3600_000, ctx.desfase)
  const posiciones = { ...(inicial.transcripts ?? {}) }
  let act = inicial
  for (const f of ficheros) {
    let tam: number
    try {
      tam = (await $.fs.stat(f)).size
    } catch {
      continue
    }
    // Un transcript largo que se ve por primera vez (Huddle recién instalado) se lee desde el final.
    let pos = posiciones[f] ?? { offset: tam > HISTORIA_MAX_BYTES ? tam : 0, ultimo: null }
    if (tam < pos.offset) pos = { offset: 0, ultimo: null }
    for (let i = 0; i < 4 && tam > pos.offset; i++) {
      let trozo: string
      try {
        const r = await $.process.run(['sh', '-c', 'tail -c +"$2" "$1" | head -c "$3"', 'huddle', f, String(pos.offset + 1), String(TROZO_TRANSCRIPT)], { timeoutMs: 15_000 })
        if (r.exitCode !== 0 || r.stdout === '') break
        trozo = r.stdout
      } catch {
        break
      }
      const l = sumarTrozo(trozo, pos.ultimo, ctx.desfase)
      // Una sola línea más larga que el trozo (una salida enorme): se salta, no tiene tokens.
      const usados = l.usados === 0 && trozo.length >= TROZO_TRANSCRIPT / 2 ? trozo : trozo.slice(0, l.usados)
      if (usados === '') break
      pos = { offset: pos.offset + bytesUtf8(usados), ultimo: l.ultimo }
      act = sumarHoras(act, l.porHora, desdeHora)
    }
    posiciones[f] = pos
  }
  if (ctx.actividad === null || ctx.actividad.session_id !== inicial.session_id) return
  // Solo si algo cambió: un volcado sin novedades no reescribe la actividad.
  if (act === inicial && JSON.stringify(posiciones) === JSON.stringify(inicial.transcripts ?? {})) return
  ctx.actividad = Object.keys(posiciones).length > 0 ? { ...act, transcripts: posiciones } : act
  ctx.actividadSucia = true
}
