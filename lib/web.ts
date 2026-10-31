// La vista web (`/huddle web`): un dashboard.html autocontenido que relee
// `.agentos/web/datos.js` cada 2 s. Aquí se calcula todo lo que pinta (IDs,
// estados, colores, textos, alturas): la página no calcula nada, solo pinta.

import type { EngineInterface } from 'claude-code'

import type { Config } from './config.ts'
import type { Uso } from './estado.ts'
import { escribirAtomico, existe, leerTexto } from './ficheros.ts'
import type { DatosPanel } from './lector.ts'
import { leerPanel } from './lector.ts'
import type { Plataforma } from './notificar.ts'
import type { EstadoRex, EstadoVisible, SesionVista } from './panel-datos.ts'
import {
  accionesPorReglas,
  alertasBasicas,
  alertasGit,
  bocadillo,
  COLOR_ROL,
  contadores,
  estadoRex,
  nivel,
  porcentaje,
  racha,
  vistaSesiones,
} from './panel-datos.ts'
import { huella } from './huella.ts'
import { unir } from './rutas.ts'
import type { ActividadWeb, LecturaActividad, ModeloBitacora } from './web-actividad.ts'
import { atascoActivo, LECTURA_VACIA, leerActividad, lineaBitacoraJs, modeloActividad, modeloBitacora } from './web-actividad.ts'
import type { Adorno } from '../mod/rex.ts'
import { adornoHoy, duracion, fechaCabecera, fichasPanel, proyectosEnSeguimiento, reinicio, resumenSeguimiento, semana, textoRacha } from '../mod/panel.ts'

// ------------------------------------------------------------- el modelo

/** `x`: atascada (pestaña Actividad); solo en la web, el panel del terminal no lo usa. */
export type EstadoWeb = 'w' | 'a' | 'p' | 'i' | 'x'

export type FilaArbol = { clave: string; nombre: string; tipo: string; detalle: string; estado: EstadoWeb; color: string; sub: boolean }
export type EmpleadoWeb = { etiqueta: string; actividad: string; estado: EstadoWeb; color: string }
export type SalaWeb = { nombre: string; contador: string; empleados: EmpleadoWeb[] }
export type BarraWeb = { nombre: string; detalle: string; pct: number | null; texto: string; color: string }
export type UsoWeb = { titulo: string; pct: number | null; texto: string; pie: string; color: string }
export type DiaWeb = { letra: string; altoC: number; altoT: number; hoy: boolean; vacio: boolean; titulo: string }

/** Una sala de las escenas Isométrica y Torre: un proyecto en seguimiento, GENERAL u «otros». */
export type SalaEscena = { clave: string; nombre: string; tipo: 'proyecto' | 'general' | 'otros'; pct: number | null; texto: string; color: string }
/** Un personaje de las escenas: una sesión o, en modo agentes, también cada subagente. */
export type PersonajeWeb = { clave: string; id: string; sala: string; proyecto: string; rol: string; estado: EstadoWeb; actividad: string; color: string; sub: boolean; lider: string }
/** Lo que enseña el detalle al hacer clic en el árbol o en un personaje. */
export type DetalleWeb = { titulo: string; subtitulo: string; estado: EstadoWeb; estadoTexto: string; filas: [string, string][] }

export type ModeloWeb = {
  version: string
  generado: string
  cabecera: string
  kpis: {
    vivas: string
    total: string
    teEsperan: string
    agentes: string
    sub: string
    tareas: string
    tareasPct: number | null
    tareasPie: string
  }
  arbol: FilaArbol[]
  rex: { estado: EstadoRex; bocadillo: string; racha: string; nivel: string; barra: string; resto: string; adorno: Adorno }
  proyectos: { titulo: string; filas: BarraWeb[]; nota: string }
  contexto: BarraWeb[]
  alertas: { texto: string; grave: boolean }[]
  actividad: { dias: DiaWeb[]; nota: string }
  siguiente: { titulo: string; acciones: string[] }
  uso: UsoWeb[]
  oficina: { sesiones: SalaWeb[]; agentes: SalaWeb[]; resumen: Record<'sesiones' | 'agentes', { total: string; trabajando: string; esperan: string; inactivas: string; atascadas: string }> }
  escenas: { salas: SalaEscena[]; sesiones: PersonajeWeb[]; agentes: PersonajeWeb[] }
  detalles: Record<string, DetalleWeb>
  /** La pestaña Actividad; la bitácora entera va aparte, en bitacora.js. */
  pestanaActividad: ActividadWeb
  pie: string
}

/** Colores de la maqueta. */
export const WEB = {
  trabajando: '#1D9E75',
  espera: '#BA7517',
  pausa: '#B4B2A9',
  inactiva: '#888780',
  rojo: '#E24B4A',
  azul: '#378ADD',
  morado: '#7F77DD',
  coral: '#D85A30',
} as const

const PROYECTO = ['#7F77DD', '#1D9E75', '#D85A30', '#378ADD', '#BA7517']

export function estadoWeb(e: EstadoVisible): EstadoWeb {
  return e === 'trabajando' ? 'w' : e === 'te_espera' ? 'a' : e === 'en_pausa' ? 'p' : 'i'
}

function colorEstado(e: EstadoVisible): string {
  return e === 'trabajando' ? WEB.trabajando : e === 'te_espera' ? WEB.espera : e === 'en_pausa' ? WEB.pausa : WEB.inactiva
}

/** El estado de una sesión en la web: un atasco activo la pone en rojo, salvo si te espera. */
type EstadoDe = (v: SesionVista) => EstadoWeb

function estadoDeVistas(ignorados: DatosPanel['ignorados']): EstadoDe {
  return v => (v.estado !== 'te_espera' && atascoActivo(v.s, ignorados) ? 'x' : estadoWeb(v.estado))
}

/** Azul por debajo del 60 %, ámbar del 60 al 80 % y rojo a partir del 80 %. */
export function colorUmbral(pct: number): string {
  return pct >= 80 ? WEB.rojo : pct >= 60 ? WEB.espera : WEB.azul
}

function nombreSesion(v: SesionVista): string {
  if (v.s.tipo === 'torre') return 'GENERAL/torre'
  if (v.s.tipo === 'otros') return `otros/${v.s.cwd.slice(v.s.cwd.lastIndexOf('/') + 1)}`
  return `${v.s.proyecto}/${v.s.rama ?? 'n/d'}`
}

function detalleSesion(v: SesionVista): string {
  return v.estado === 'inactiva' ? `inactiva ${duracion(v.quietaMin)}` : v.s.detalle
}

// ------------------------------------------------- escenas Isométrica y Torre

/** Claves estables para la página: no cambian aunque cambie la numeración de los IDs. */
function claveSesion(v: SesionVista): string {
  return `s${huella(v.s.session_id)}`
}

function claveAgente(v: SesionVista, a: SesionVista['agentes'][number], i: number): string {
  return `a${huella(`${v.s.session_id}/${a.tool_use_id ?? a.agent_id ?? i}`)}`
}

const SALA_GENERAL = 'general'
const SALA_OTROS = 'otros'

/** La sala de una sesión: su proyecto si está en seguimiento, GENERAL para la torre y si no, «otros». */
function salaDe(v: SesionVista, seguimiento: readonly string[]): string {
  if (v.s.tipo === 'torre') return SALA_GENERAL
  if (v.s.tipo !== 'proyecto') return SALA_OTROS
  const n = seguimiento.find(p => p.toLowerCase() === v.s.proyecto.toLowerCase())
  return n === undefined ? SALA_OTROS : `p:${n}`
}

function proyectoDe(v: SesionVista): string {
  return v.s.tipo === 'torre' ? 'GENERAL' : v.s.tipo === 'otros' ? `otros · ${v.s.cwd.slice(v.s.cwd.lastIndexOf('/') + 1)}` : v.s.proyecto
}

function hace(min: number): string {
  return min < 1 ? 'ahora mismo' : `hace ${duracion(min)}`
}

function ms(iso: string | null): number | null {
  const t = iso === null ? NaN : Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

function textoEstado(v: SesionVista, ew: EstadoDe): string {
  if (ew(v) === 'x' && v.s.atasco) return `atascada · ${v.s.atasco.motivo}`
  switch (v.estado) {
    case 'trabajando':
      return 'trabajando'
    case 'te_espera':
      return v.esperaMin === null ? 'te espera' : `te espera · ${hace(v.esperaMin)}`
    case 'en_pausa':
      return 'en pausa'
    case 'inactiva':
      return `inactiva · ${duracion(v.quietaMin)}`
  }
}

function escenasWeb(vistas: readonly SesionVista[], seguimiento: readonly string[], filas: readonly BarraWeb[], ahora: number, ew: EstadoDe) {
  const usadas = new Set(vistas.map(v => salaDe(v, seguimiento)))
  const salas: SalaEscena[] = seguimiento.map((nombre, i) => {
    const f = filas[i]
    return { clave: `p:${nombre}`, nombre, tipo: 'proyecto', pct: f?.pct ?? null, texto: f?.texto ?? '—', color: PROYECTO[i % PROYECTO.length]! }
  })
  salas.push({ clave: SALA_GENERAL, nombre: 'GENERAL', tipo: 'general', pct: null, texto: 'torre de control', color: WEB.inactiva })
  if (usadas.has(SALA_OTROS)) salas.push({ clave: SALA_OTROS, nombre: 'otros', tipo: 'otros', pct: null, texto: 'fuera de seguimiento', color: WEB.pausa })
  const colorSala = new Map(salas.map(s => [s.clave, s.color]))

  const sesiones: PersonajeWeb[] = []
  const agentes: PersonajeWeb[] = []
  const detalles: Record<string, DetalleWeb> = {}
  for (const v of vistas) {
    const sala = salaDe(v, seguimiento)
    const proyecto = proyectoDe(v)
    const base = { clave: claveSesion(v), sala, proyecto, rol: 'lead', estado: ew(v), actividad: detalleSesion(v), sub: false, lider: '' }
    sesiones.push({ ...base, id: v.etiqueta, color: colorSala.get(sala) ?? WEB.inactiva })
    agentes.push({ ...base, id: v.leadId, color: COLOR_ROL.lead! })
    const inicio = ms(v.s.inicio)
    detalles[base.clave] = {
      titulo: nombreSesion(v),
      subtitulo: `sesión · ${v.leadId}`,
      estado: base.estado,
      estadoTexto: textoEstado(v, ew),
      filas: [
        ['Actividad', detalleSesion(v)],
        ...(base.estado === 'x' && v.s.atasco ? [['Atasco', `${v.s.atasco.motivo} · ver la pestaña Actividad`] as [string, string]] : []),
        ['Proyecto', proyecto],
        ['Rama', v.s.rama ?? 'n/d'],
        ['Contexto', v.s.contexto_pct === null ? 'n/d' : `${v.s.contexto_pct}%`],
        ['Modelo', v.s.modelo ?? 'n/d'],
        ['Abierta', inicio === null ? 'n/d' : hace((ahora - inicio) / 60_000)],
        ['Último evento', hace(v.quietaMin)],
        ['Subagentes', v.agentes.length === 0 ? 'ninguno' : v.agentes.map(a => a.id).join(', ')],
        ['Carpeta', v.s.cwd],
      ],
    }
    v.agentes.forEach((a, i) => {
      const clave = claveAgente(v, a, i)
      const estado: EstadoWeb = v.estado === 'inactiva' ? 'i' : estadoWeb(a.estado)
      agentes.push({
        clave,
        id: a.id,
        sala,
        proyecto,
        rol: a.tipo,
        estado,
        actividad: a.estado === 'trabajando' ? a.detalle || a.descripcion : a.descripcion,
        color: a.color,
        sub: true,
        lider: base.clave,
      })
      const desde = ms(a.inicio)
      detalles[clave] = {
        titulo: a.id,
        subtitulo: `${a.tipo} · subagente de ${v.leadId}`,
        estado,
        estadoTexto: estado === 'i' ? 'inactiva (su sesión está quieta)' : a.estado === 'trabajando' ? 'trabajando' : a.estado === 'te_espera' ? 'te espera' : 'en pausa',
        filas: [
          ['Tarea', a.descripcion],
          ['Actividad', a.detalle],
          ['Sesión', nombreSesion(v)],
          ['Proyecto', proyecto],
          ['En marcha', desde === null ? 'n/d' : hace((ahora - desde) / 60_000)],
        ],
      }
    })
  }
  return { escenas: { salas, sesiones, agentes }, detalles }
}

function salasWeb(vistas: readonly SesionVista[], modo: 'sesiones' | 'agentes', ew: EstadoDe): SalaWeb[] {
  const salas = new Map<string, EmpleadoWeb[]>()
  for (const v of vistas) {
    const sala = v.s.tipo === 'torre' ? 'GENERAL' : v.s.proyecto
    const lista = salas.get(sala) ?? []
    salas.set(sala, lista)
    if (modo === 'sesiones') {
      lista.push({ etiqueta: v.etiqueta, actividad: detalleSesion(v), estado: ew(v), color: COLOR_ROL.lead! })
    } else {
      lista.push({ etiqueta: v.leadId, actividad: detalleSesion(v), estado: ew(v), color: COLOR_ROL.lead! })
      for (const a of v.agentes) {
        lista.push({
          etiqueta: a.id,
          actividad: a.estado === 'trabajando' ? a.detalle || a.descripcion : a.descripcion,
          estado: v.estado === 'inactiva' ? 'i' : estadoWeb(a.estado),
          color: a.color,
        })
      }
    }
  }
  const unidad = (n: number) => (modo === 'sesiones' ? (n === 1 ? 'sesión' : 'sesiones') : n === 1 ? 'agente' : 'agentes')
  return [...salas].map(([nombre, empleados]) => ({ nombre, contador: `${empleados.length} ${unidad(empleados.length)}`, empleados }))
}

function resumenSalas(salas: readonly SalaWeb[], modo: 'sesiones' | 'agentes') {
  const todos = salas.flatMap(s => s.empleados)
  const n = (e: EstadoWeb) => todos.filter(x => x.estado === e).length
  return {
    total: `${todos.length} ${modo === 'sesiones' ? (todos.length === 1 ? 'sesión' : 'sesiones') : todos.length === 1 ? 'agente' : 'agentes'}`,
    trabajando: `${n('w')} trabajando`,
    esperan: `${n('a')} ${n('a') === 1 ? 'espera' : 'esperan'}`,
    inactivas: `${n('i')} ${n('i') === 1 ? 'inactiva' : 'inactivas'}`,
    atascadas: n('x') === 0 ? '' : `${n('x')} ${n('x') === 1 ? 'atascada' : 'atascadas'}`,
  }
}

function usoWeb(titulo: string, color: string, ventana: { pct: number; reinicia: string | null } | null | undefined, estimado: number | null, pieEstimado: string, ahora: number, desfase: number): UsoWeb {
  if (ventana) return { titulo, pct: Math.min(100, ventana.pct), texto: `${Math.round(ventana.pct)}%`, pie: reinicio(ventana.reinicia, ahora, desfase), color: ventana.pct >= 80 ? WEB.rojo : color }
  if (estimado !== null) return { titulo, pct: Math.min(100, estimado), texto: `≈${Math.round(estimado)}%`, pie: pieEstimado, color: estimado >= 80 ? WEB.rojo : color }
  return { titulo, pct: null, texto: 'n/d', pie: 'configúralo en config.json', color }
}

export { huella } from './huella.ts'

export function modeloWeb(d: DatosPanel, ahora: number, generado: string, lectura: LecturaActividad = LECTURA_VACIA, bitacora?: ModeloBitacora): ModeloWeb {
  const vistas = vistaSesiones(d.sesiones, ahora, d.inactiva_min)
  const ew = estadoDeVistas(d.ignorados)
  const fichas = fichasPanel(d, ahora)
  const k = contadores(vistas)
  const pctHoy = d.hoy ? porcentaje(d.hoy) : null

  const arbol: FilaArbol[] = []
  for (const v of vistas) {
    const e = ew(v)
    arbol.push({ clave: claveSesion(v), nombre: nombreSesion(v), tipo: 'sesión', detalle: e === 'x' && v.s.atasco ? `atascada · ${v.s.atasco.motivo}` : detalleSesion(v), estado: e, color: e === 'x' ? WEB.rojo : colorEstado(v.estado), sub: false })
    for (const [i, a] of v.agentes.entries()) {
      arbol.push({
        clave: claveAgente(v, a, i),
        nombre: a.id,
        tipo: a.tipo,
        detalle: a.estado === 'trabajando' ? a.descripcion : `${a.descripcion} · ${a.detalle}`,
        estado: v.estado === 'inactiva' ? 'i' : estadoWeb(a.estado),
        color: a.color,
        sub: true,
      })
    }
  }

  const eRex = estadoRex(vistas, fichas)
  const enNivel = d.turnosTotales % 100
  const llenos = Math.round((enNivel / 100) * 8)

  const enSeguimiento = proyectosEnSeguimiento(d, fichas)
  const proyectos: BarraWeb[] = enSeguimiento.map(({ nombre, ficha }, i) =>
    ficha
      ? {
          nombre,
          detalle: [ficha.fase, ficha.tareas.total > 0 ? `${ficha.tareas.hechas}/${ficha.tareas.total}` : 'sin tareas'].filter(Boolean).join(' · '),
          pct: ficha.pct,
          texto: ficha.pct === null ? '—' : `${ficha.pct}%`,
          color: /pausa/i.test(ficha.fase) ? WEB.inactiva : PROYECTO[i % PROYECTO.length]!,
        }
      : { nombre, detalle: 'sin ficha', pct: null, texto: '—', color: WEB.inactiva },
  )
  const sinFicha = enSeguimiento.filter(p => p.ficha === null).length

  const contexto: BarraWeb[] = vistas
    .filter(v => v.estado !== 'inactiva')
    .map(v => ({
      nombre: nombreSesion(v),
      detalle: '',
      pct: v.s.contexto_pct,
      texto: v.s.contexto_pct === null ? 'n/d' : `${v.s.contexto_pct}%`,
      color: v.s.contexto_pct === null ? WEB.inactiva : colorUmbral(v.s.contexto_pct),
    }))

  const alertas = [...alertasBasicas(vistas, d.sinClasificar), ...alertasGit(d.git ?? {}, ahora)]
    .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'grave' ? -1 : 1))
    .map(a => ({ texto: a.texto, grave: a.nivel === 'grave' }))

  const dias = semana(d, ahora)
  const maxC = Math.max(0, ...dias.map(x => x.commits ?? 0))
  const maxT = Math.max(0, ...dias.map(x => x.turnos ?? 0))
  const tope = Math.max(maxC, maxT)
  const alto = (v: number | null) => (v === null || v <= 0 || tope <= 0 ? 0 : Math.max(4, Math.round((v / tope) * 100)))

  const porReglas = d.siguiente.length === 0
  const acciones = porReglas ? accionesPorReglas(vistas, d.git ?? {}) : d.siguiente

  const u = d.uso
  const e = d.usoEstimado ?? null
  const reinicioEstimado = e && e.reinicioSemana !== null ? reinicio(new Date(e.reinicioSemana).toISOString(), ahora, d.desfase) : 'reinicio n/d'
  const sesiones = salasWeb(vistas, 'sesiones', ew)
  const agentes = salasWeb(vistas, 'agentes', ew)
  const { escenas, detalles } = escenasWeb(vistas, enSeguimiento.map(p => p.nombre), proyectos, ahora, ew)
  const pestanaActividad = modeloActividad(d, lectura, ahora, bitacora ?? modeloBitacora(d, lectura, ahora))

  const sinVersion: Omit<ModeloWeb, 'version'> = {
    generado,
    cabecera: `huddle · ${d.raiz} · ${fechaCabecera(ahora, d.desfase)} · ${d.ultimoRefresh === null ? 'sin /refresh' : `refresh hace ${duracion((ahora - d.ultimoRefresh) / 60_000)}`}`,
    kpis: {
      vivas: String(k.vivas),
      total: `/${k.total}`,
      teEsperan: String(k.teEsperan),
      agentes: String(k.leads),
      sub: `+${k.subagentes} sub`,
      tareas: pctHoy === null ? '—' : `${pctHoy}%`,
      tareasPct: pctHoy,
      tareasPie: d.hoy && d.hoy.total > 0 ? `${d.hoy.hechas} de ${d.hoy.total}` : 'sin tareas en «Hoy»',
    },
    arbol,
    rex: {
      estado: eRex,
      bocadillo: `"${bocadillo(eRex, vistas, fichas)}"`,
      racha: textoRacha(racha(d.dias)),
      nivel: `nivel ${nivel(d.turnosTotales)}`,
      barra: '█'.repeat(llenos),
      resto: '░'.repeat(8 - llenos),
      adorno: adornoHoy(d, ahora),
    },
    proyectos: {
      titulo: resumenSeguimiento(enSeguimiento.length, 0)[0] ?? '',
      filas: proyectos,
      nota: resumenSeguimiento(enSeguimiento.length, sinFicha)[1] ?? '',
    },
    contexto,
    alertas,
    actividad: {
      dias: dias.map(x => ({
        letra: x.letra,
        altoC: alto(x.commits),
        altoT: alto(x.turnos),
        hoy: x.hoy,
        vacio: (x.commits ?? 0) + (x.turnos ?? 0) === 0,
        titulo: `${x.dia}: ${x.commits === null ? 'commits n/d' : `${x.commits} commits`} · ${x.turnos === null ? 'turnos n/d' : `${x.turnos} turnos`}`,
      })),
      nota: d.dias.every(x => x.commits === null) ? 'commits n/d (sin /refresh)' : '',
    },
    siguiente: { titulo: porReglas && acciones.length > 0 ? 'por reglas' : '', acciones },
    uso: [
      usoWeb('Uso de la sesión de 5 h', WEB.azul, u?.cinco_horas, u === null && e ? e.cinco_horas : null, 'ventana móvil de 5 h', ahora, d.desfase),
      usoWeb('Uso semanal', WEB.morado, u?.semana, u === null && e ? e.semana : null, reinicioEstimado, ahora, d.desfase),
    ],
    oficina: { sesiones, agentes, resumen: { sesiones: resumenSalas(sesiones, 'sesiones'), agentes: resumenSalas(agentes, 'agentes') } },
    escenas,
    detalles,
    pestanaActividad,
    pie: d.sinClasificar > 0 ? `${d.sinClasificar} sin clasificar en PROYECTOS.md` : '',
  }
  // La versión no depende de la hora de generación: si nada cambió, la página no repinta.
  const { generado: _g, ...contenido } = sinVersion
  return { version: huella(JSON.stringify(contenido)), ...sinVersion }
}

/** El contenido de datos.js: una sola línea. */
export function lineaDatos(m: ModeloWeb): string {
  return `window.HUDDLE = ${JSON.stringify(m)};\n`
}

// ------------------------------------------------------------- ficheros

export function dirWeb(config: Config): string {
  return unir(config.general_dir, '.agentos', 'web')
}

/** La web está activa si alguna vez se hizo /huddle web (existe .agentos/web/). */
export async function webActiva($: EngineInterface, config: Config): Promise<boolean> {
  return existe($, unir(dirWeb(config), 'dashboard.html'))
}

/** La última bitacora.js que escribió este proceso: solo se reescribe cuando cambia. */
let versionBitacora = ''

/** Escribe datos.js y, si cambió, bitacora.js. Lo usan la torre y las demás sesiones. Devuelve la versión. */
export async function escribirWeb($: EngineInterface, config: Config, datos: DatosPanel, generado: string): Promise<string> {
  const ahora = Date.now()
  const lectura = await leerActividad($, config, datos.desfase)
  const bitacora = modeloBitacora(datos, lectura, ahora)
  const rutaBitacora = unir(dirWeb(config), 'bitacora.js')
  if (bitacora.version !== versionBitacora || !(await existe($, rutaBitacora))) {
    await escribirAtomico($, rutaBitacora, lineaBitacoraJs(bitacora))
    versionBitacora = bitacora.version
  }
  const m = modeloWeb(datos, ahora, generado, lectura, bitacora)
  await escribirAtomico($, unir(dirWeb(config), 'datos.js'), lineaDatos(m))
  return m.version
}

/** Lee la carpeta de control y reescribe datos.js (de forma atómica). Devuelve la versión. */
export async function escribirDatosWeb($: EngineInterface, config: Config, desfase: number, usoPropio: Uso | null, generado: string): Promise<string> {
  return escribirWeb($, config, await leerPanel($, config, desfase, usoPropio), generado)
}

/** Copia la plantilla del mod a .agentos/web/dashboard.html. */
export async function instalarDashboard($: EngineInterface, config: Config): Promise<string> {
  const plantilla = await leerTexto($, unir($.plugin.root, 'web', 'dashboard.html'))
  if (plantilla === undefined) throw new Error('falta web/dashboard.html en el mod')
  const ruta = unir(dirWeb(config), 'dashboard.html')
  await escribirAtomico($, ruta, plantilla)
  return ruta
}

/** El programa que abre un fichero en el navegador, según la plataforma. */
export function argvAbrirNavegador(plataforma: Plataforma, ruta: string, rutaWindows: string | null, hayWslview: boolean): string[] | null {
  switch (plataforma) {
    case 'wsl':
      if (hayWslview) return ['wslview', ruta]
      return rutaWindows ? ['explorer.exe', rutaWindows] : null
    case 'linux':
      return ['xdg-open', ruta]
    case 'mac':
      return ['open', ruta]
    case 'otra':
      return null
  }
}
