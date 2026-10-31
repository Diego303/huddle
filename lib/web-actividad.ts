// La pestaña Actividad de la web: atascos, cronograma de hoy, uso por proyecto
// y la bitácora (que va aparte, en bitacora.js, para no inflar datos.js). Lee
// los tramos y la bitácora de .agentos y prepara todo lo que se pinta: la
// página no calcula nada.

import type { EngineInterface } from 'claude-code'

import { estaIgnorado, PISTAS } from './atascos.ts'
import type { LineaBitacora, TipoBitacora } from './bitacora.ts'
import { DIAS_BITACORA, interpretarBitacora } from './bitacora.ts'
import type { Config } from './config.ts'
import type { EstadoSesion, VentanaUso } from './estado.ts'
import { huella } from './huella.ts'
import type { DatosPanel } from './lector.ts'
import { unir } from './rutas.ts'
import type { LineaTramo } from './tramos.ts'
import { interpretarTramos, metricasEspera, segmentosPorSesion } from './tramos.ts'
import { diaLocal, diaYHora, horaLocal, horaMinuto, medianoche, ultimoReinicio, ultimosDias } from './tiempo.ts'

// ------------------------------------------------------------------ lectura

export type BitacoraSesion = { session_id: string; dia: string; lineas: LineaBitacora[] }
export type LecturaActividad = { tramos: LineaTramo[]; bitacora: BitacoraSesion[] }

export const LECTURA_VACIA: LecturaActividad = { tramos: [], bitacora: [] }

type Cacheado<T> = { mtime: number; valor: T }
const cacheTramos = new Map<string, Cacheado<LineaTramo[]>>()
const cacheBitacora = new Map<string, Cacheado<LineaBitacora[]>>()

async function listar($: EngineInterface, dir: string) {
  try {
    return await $.fs.list(dir)
  } catch {
    return []
  }
}

async function leerCacheado<T>($: EngineInterface, cache: Map<string, Cacheado<T>>, ruta: string, mtime: number, leer: (t: string) => T): Promise<T | null> {
  const c = cache.get(ruta)
  if (c && c.mtime === mtime) return c.valor
  try {
    const valor = leer(await $.fs.read(ruta))
    cache.set(ruta, { mtime, valor })
    return valor
  } catch {
    return c?.valor ?? null
  }
}

/** Los tramos y la bitácora de los últimos 7 días. Solo se relee lo que cambió. */
export async function leerActividad($: EngineInterface, config: Config, desfase: number): Promise<LecturaActividad> {
  const agentos = unir(config.general_dir, '.agentos')
  const dias = new Set(ultimosDias(Date.now(), desfase, DIAS_BITACORA))
  const tramos: LineaTramo[] = []
  const dirTramos = unir(agentos, 'tramos')
  for (const f of await listar($, dirTramos)) {
    if (f.kind !== 'file' || !dias.has(f.name.replace(/\.jsonl$/, ''))) continue
    const ls = await leerCacheado($, cacheTramos, unir(dirTramos, f.name), f.mtimeMs, interpretarTramos)
    if (ls) tramos.push(...ls)
  }
  const bitacora: BitacoraSesion[] = []
  const dirBitacora = unir(agentos, 'bitacora')
  for (const d of await listar($, dirBitacora)) {
    if (d.kind !== 'dir' || !dias.has(d.name)) continue
    for (const f of await listar($, unir(dirBitacora, d.name))) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl')) continue
      const ls = await leerCacheado($, cacheBitacora, unir(dirBitacora, d.name, f.name), f.mtimeMs, interpretarBitacora)
      if (ls && ls.length > 0) bitacora.push({ session_id: f.name.replace(/\.jsonl$/, ''), dia: d.name, lineas: ls })
    }
  }
  return { tramos, bitacora }
}

// -------------------------------------------------------------------- modelo

export type EstadoCrono = 'w' | 'a' | 'p' | 'x'
export type AtascoWeb = {
  id: string
  sesion: string
  proyecto: string
  motivo: string
  prueba: { comando?: string; error?: string; fichero?: string; tests?: string; texto?: string }
  desde: string
  pista: string
  abrir: string
  ignorar: string
}
export type FilaCrono = { clave: string; nombre: string; tramos: { desde: number; hasta: number; e: EstadoCrono; texto: string }[] }
export type PeriodoWeb = {
  titulo: string
  pct: number | null
  texto: string
  pie: string
  proyectos: { nombre: string; color: string; pct: number | null; texto: string; parte: number; parteTexto: string }[]
  nota: string[]
  aviso: boolean
}
export type ActividadWeb = {
  atascos: { titulo: string; lista: AtascoWeb[] }
  cronograma: { inicio: number; fin: number; ahora: number; horas: { min: number; texto: string }[]; filas: FilaCrono[]; espera: string; esperaMax: string }
  uso: { cinco: PeriodoWeb; semana: PeriodoWeb }
  bitacora: { version: string; eventos: number }
}

/** bitacora.js: los eventos de los últimos 7 días, del más reciente al más antiguo. */
export type ModeloBitacora = {
  version: string
  sesiones: { clave: string; nombre: string; proyecto: string }[]
  /** [hora, tipo, resumen, índice de sesión] */
  eventos: [string, TipoBitacora, string, number][]
}

const PROYECTO = ['#7F77DD', '#1D9E75', '#D85A30', '#378ADD', '#BA7517']
const GRIS = '#888780'
const GRIS_CLARO = '#B4B2A9'

export function claveDeSesion(sessionId: string): string {
  return `s${huella(sessionId)}`
}

/** Un atasco activo: ni ignorado desde la web ni (en la sesión) marcado como tal. */
export function atascoActivo(s: EstadoSesion, ignorados: DatosPanel['ignorados']): boolean {
  const a = s.atasco
  return !!a && !a.ignorado && !estaIgnorado(ignorados, s.session_id, a.clave, s.tarea ?? 0)
}

function nombreSesion(s: EstadoSesion): string {
  if (s.tipo === 'torre') return 'GENERAL · torre'
  if (s.tipo === 'otros') return `otros · ${s.cwd.slice(s.cwd.lastIndexOf('/') + 1)}`
  return `${s.proyecto} · ${s.rama ?? 'n/d'}`
}

function minutos(n: number): string {
  return `${Math.round(n)} min`
}

function hace(ms: number, ahora: number): string {
  const min = (ahora - ms) / 60_000
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `hace ${h} h ${m} min` : `hace ${h} h`
}

function atascosWeb(d: DatosPanel, ahora: number): ActividadWeb['atascos'] {
  const lista: AtascoWeb[] = []
  for (const s of d.sesiones) {
    if (!atascoActivo(s, d.ignorados) || !s.atasco) continue
    const a = s.atasco
    const desde = Date.parse(a.desde)
    const proyecto = s.tipo === 'torre' ? 'GENERAL' : s.tipo === 'otros' ? '' : s.proyecto
    lista.push({
      id: a.id,
      sesion: nombreSesion(s),
      proyecto,
      motivo: a.motivo,
      prueba: {
        ...(a.prueba.comando ? { comando: a.prueba.comando } : {}),
        ...(a.prueba.error ? { error: a.prueba.error } : {}),
        ...(a.prueba.fichero ? { fichero: a.prueba.fichero } : {}),
        ...(a.prueba.tests && a.prueba.tests.length > 0 ? { tests: `tests ${a.prueba.tests.join(' → ')}` } : {}),
        ...(a.prueba.texto ? { texto: a.prueba.texto } : {}),
      },
      desde: Number.isFinite(desde) ? hace(desde, ahora) : '',
      pista: PISTAS[a.regla],
      abrir: proyecto && proyecto !== 'GENERAL' ? `/abrir ${proyecto}` : '',
      ignorar: `/huddle ignorar ${a.id}`,
    })
  }
  const n = lista.length
  return { titulo: n === 0 ? '' : `${n} ${n === 1 ? 'sesión parece' : 'sesiones parecen'} en bucle`, lista }
}

const LETRA: Record<string, EstadoCrono> = { trabajando: 'w', te_espera: 'a', en_pausa: 'p', atascada: 'x' }
const NOMBRE_CRONO: Record<EstadoCrono, string> = { w: 'trabajando', a: 'esperándote', p: 'pausa', x: 'atascada' }

function cronograma(d: DatosPanel, l: LecturaActividad, ahora: number): ActividadWeb['cronograma'] {
  const cero = medianoche(ahora, d.desfase)
  const vivas = new Set(d.sesiones.map(s => s.session_id))
  // Los tramos de hoy y el último de ayer de cada sesión (lo que estaba haciendo a medianoche).
  const ayer = diaLocal(cero - 1, d.desfase)
  const hoy = diaLocal(ahora, d.desfase)
  const deHoy = l.tramos.filter(t => t.ts.slice(0, 10) === hoy)
  const ultimoDeAyer = new Map<string, LineaTramo>()
  for (const t of l.tramos) if (t.ts.slice(0, 10) === ayer) ultimoDeAyer.set(t.session_id, t)
  const lineas = [...deHoy, ...[...ultimoDeAyer.values()].map(t => ({ ...t, ts: new Date(cero).toISOString() }))]
  const filas = segmentosPorSesion(lineas, ahora, vivas, d.inactiva_min)
  const min = (ms: number) => Math.max(0, (ms - cero) / 60_000)
  const ahoraMin = min(ahora)
  const primera = Math.min(...filas.map(f => min(f.segmentos[0]!.desde)), ahoraMin)
  const inicio = Math.min(9 * 60, Math.floor(primera / 60) * 60, Math.floor(ahoraMin / 60) * 60)
  // De la primera actividad (o las 9:00, si fue después) hasta ahora.
  const fin = Math.max(ahoraMin, inicio + 60)
  const paso = fin - inicio > 14 * 60 ? 120 : 60
  const horas: { min: number; texto: string }[] = []
  for (let m = Math.ceil(inicio / 60) * 60; m <= fin; m += paso) horas.push({ min: m, texto: `${m / 60}h` })
  const hm = (ms: number) => horaMinuto(ms, d.desfase)
  const esp = metricasEspera(filas)
  return {
    inicio,
    fin,
    ahora: ahoraMin,
    horas,
    filas: filas.map(f => ({
      clave: claveDeSesion(f.session_id),
      nombre: f.nombre,
      tramos: f.segmentos.map(s => {
        const e = LETRA[s.estado]!
        return { desde: min(s.desde), hasta: min(s.hasta), e, texto: `${f.nombre} · ${NOMBRE_CRONO[e]} · ${hm(s.desde)}–${s.abierto ? 'ahora' : hm(s.hasta)} (${minutos((s.hasta - s.desde) / 60_000)})` }
      }),
    })),
    espera: esp.esperas === 0 ? 'nadie te ha esperado hoy' : `${minutos(esp.minutos)} esperándote hoy · media ${minutos(esp.media ?? 0)}`,
    esperaMax: esp.maxima ? `máx. ${minutos(esp.maxima.minutos)} (${esp.maxima.nombre})` : '',
  }
}

// ------------------------------------------------------------ uso por proyecto

type Cuentas = { ediciones: number; subagentes: number; atascos: number }

/** El proyecto de cada sesión, por los tramos y por las sesiones vivas. */
function proyectosDeSesiones(d: DatosPanel, l: LecturaActividad): Map<string, string> {
  const m = new Map<string, string>()
  for (const t of l.tramos) if (t.proyecto) m.set(t.session_id, t.proyecto)
  for (const s of d.sesiones) m.set(s.session_id, s.tipo === 'torre' ? 'GENERAL' : s.tipo === 'otros' ? 'otros' : s.proyecto)
  return m
}

function grupo(proyecto: string, seguimiento: readonly string[]): string {
  if (proyecto === 'GENERAL') return 'GENERAL'
  return seguimiento.find(p => p.toLowerCase() === proyecto.toLowerCase()) ?? 'otros'
}

function colorDe(nombre: string, seguimiento: readonly string[]): string {
  const i = seguimiento.indexOf(nombre)
  return i >= 0 ? PROYECTO[i % PROYECTO.length]! : nombre === 'GENERAL' ? GRIS : GRIS_CLARO
}

function cuentasDesde(d: DatosPanel, l: LecturaActividad, desde: number): Map<string, Cuentas> {
  const deSesion = proyectosDeSesiones(d, l)
  const out = new Map<string, Cuentas>()
  const de = (sid: string) => {
    const g = grupo(deSesion.get(sid) ?? 'otros', d.seguimiento)
    if (!out.has(g)) out.set(g, { ediciones: 0, subagentes: 0, atascos: 0 })
    return out.get(g)!
  }
  for (const b of l.bitacora) {
    for (const x of b.lineas) {
      if (Date.parse(x.ts) < desde) continue
      if (x.tipo === 'edit') de(b.session_id).ediciones += 1
      if (x.tipo === 'sub') de(b.session_id).subagentes += 1
    }
  }
  for (const t of l.tramos) if (t.estado === 'atascada' && Date.parse(t.ts) >= desde) de(t.session_id).atascos += 1
  return out
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

function motivo(c: Cuentas | undefined, todas: Map<string, Cuentas>): string {
  if (!c) return ''
  if (c.atascos > 0) return c.atascos === 1 ? 'un atasco' : `${c.atascos} atascos`
  const total = [...todas.values()].reduce((a, x) => ({ ed: a.ed + x.ediciones, sub: a.sub + x.subagentes }), { ed: 0, sub: 0 })
  const parteSub = total.sub === 0 ? 0 : c.subagentes / total.sub
  const parteEd = total.ed === 0 ? 0 : c.ediciones / total.ed
  if (c.subagentes > 0 && parteSub >= parteEd) return `más subagentes (${c.subagentes})`
  if (c.ediciones > 0) return `más ediciones (${c.ediciones})`
  return ''
}

function periodo(
  titulo: string,
  d: DatosPanel,
  l: LecturaActividad,
  ahora: number,
  desde: number,
  fin: number | null,
  oficial: VentanaUso | null,
  limite: number | null,
  pieEstimado: string,
  proyeccion: boolean,
): PeriodoWeb {
  const desdeHora = horaLocal(desde, d.desfase)
  const porGrupo = new Map<string, number>()
  for (const [p, horas] of Object.entries(d.tokensProyecto)) {
    let n = 0
    for (const [h, v] of Object.entries(horas)) if (h >= desdeHora) n += v
    if (n > 0) porGrupo.set(grupo(p, d.seguimiento), (porGrupo.get(grupo(p, d.seguimiento)) ?? 0) + n)
  }
  const total = [...porGrupo.values()].reduce((a, b) => a + b, 0)
  const estimado = oficial === null && limite !== null
  const pct = oficial !== null ? oficial.pct : limite !== null ? (total / limite) * 100 : null
  const marca = estimado ? '≈' : ''
  const proyectos = [...porGrupo]
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, n]) => {
      const parte = total === 0 ? 0 : (n / total) * 100
      const p = pct === null ? null : (pct * parte) / 100
      return { nombre, color: colorDe(nombre, d.seguimiento), pct: p, texto: p === null ? 'n/d' : `${marca}${Math.round(p)} %`, parte, parteTexto: `${Math.round(parte)} % de lo usado` }
    })
  const nota: string[] = []
  let aviso = false
  const top = proyectos[0]
  if (top) {
    const cuentas = cuentasDesde(d, l, desde)
    const m = motivo(cuentas.get(top.nombre), cuentas)
    if (cuentas.get(top.nombre)?.atascos) aviso = true
    nota.push(proyectos.length === 1 ? `Todo lo usado es de ${top.nombre}${m ? `: ${m}` : ''}.` : `${top.nombre} se lleva el ${Math.round(top.parte)} % de lo usado${m ? `: ${m}` : ''}.`)
  }
  if (proyeccion && pct !== null && fin !== null && ahora > desde + 30 * 60_000 && fin > ahora) {
    const ritmo = pct / (ahora - desde)
    const previsto = pct + ritmo * (fin - ahora)
    if (previsto <= 100) {
      nota.push(`A este ritmo llegas al reinicio (${diaYHora(fin, d.desfase)}) con un ${marca}${Math.round(100 - previsto)} % de margen.`)
    } else {
      aviso = true
      nota.push(`A este ritmo llegas al 100 % el ${diaYHora(ahora + (100 - pct) / ritmo, d.desfase)}, antes del reinicio (${diaYHora(fin, d.desfase)}).`)
    }
  }
  const pie =
    oficial?.reinicia && Number.isFinite(Date.parse(oficial.reinicia))
      ? (Date.parse(oficial.reinicia) - ahora < 86_400_000
          ? `reinicia en ${duracionCorta((Date.parse(oficial.reinicia) - ahora) / 60_000)}`
          : `reinicia ${diaYHora(Date.parse(oficial.reinicia), d.desfase)}`)
      : pieEstimado
  return {
    titulo,
    pct,
    texto: pct === null ? 'n/d' : `${marca}${Math.round(pct)} %`,
    pie: pct === null ? 'sin dato oficial · configura limites en config.json' : pie,
    proyectos,
    nota,
    aviso,
  }
}

function duracionCorta(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h} h ${m} min` : `${h} h`
}

function uso(d: DatosPanel, l: LecturaActividad, ahora: number): ActividadWeb['uso'] {
  const u = d.uso
  const cinco = u?.cinco_horas ?? null
  const semana = u?.semana ?? null
  const finCinco = cinco?.reinicia ? Date.parse(cinco.reinicia) : NaN
  const finSemana = semana?.reinicia ? Date.parse(semana.reinicia) : NaN
  const reinicioConfig = ultimoReinicio(ahora, d.desfase, d.limites.reinicio_semanal)
  const desdeSemana = Number.isFinite(finSemana) ? finSemana - 7 * 86_400_000 : (reinicioConfig ?? ahora - 7 * 86_400_000)
  const finSem = Number.isFinite(finSemana) ? finSemana : reinicioConfig === null ? null : reinicioConfig + 7 * 86_400_000
  return {
    cinco: periodo(
      'sesión de 5 h',
      d,
      l,
      ahora,
      Number.isFinite(finCinco) ? finCinco - 5 * 3600_000 : ahora - 5 * 3600_000,
      Number.isFinite(finCinco) ? finCinco : null,
      cinco,
      u === null ? d.limites.sesion_5h_tokens : null,
      'ventana móvil de 5 h',
      false,
    ),
    semana: periodo(
      'semana',
      d,
      l,
      ahora,
      desdeSemana,
      finSem,
      semana,
      u === null ? d.limites.semana_tokens : null,
      finSem === null ? 'reinicio n/d' : `reinicia ${diaYHora(finSem, d.desfase)}`,
      true,
    ),
  }
}

// ----------------------------------------------------------------- bitácora

/** Los nombres de las sesiones: los de sus tramos o, si sigue viva, el de su estado. */
function nombres(d: DatosPanel, l: LecturaActividad): Map<string, { nombre: string; proyecto: string }> {
  const m = new Map<string, { nombre: string; proyecto: string }>()
  for (const t of l.tramos) if (t.nombre) m.set(t.session_id, { nombre: t.nombre, proyecto: t.proyecto ?? '' })
  for (const s of d.sesiones) m.set(s.session_id, { nombre: nombreSesion(s), proyecto: s.tipo === 'torre' ? 'GENERAL' : s.proyecto })
  return m
}

export function modeloBitacora(d: DatosPanel, l: LecturaActividad, ahora: number): ModeloBitacora {
  const hoy = diaLocal(ahora, d.desfase)
  const porNombre = nombres(d, l)
  const eventos: { ms: number; sid: string; l: LineaBitacora }[] = []
  for (const b of l.bitacora) for (const x of b.lineas) eventos.push({ ms: Date.parse(x.ts), sid: b.session_id, l: x })
  eventos.sort((a, b) => b.ms - a.ms)
  const orden: string[] = []
  for (const e of eventos) if (!orden.includes(e.sid)) orden.push(e.sid)
  // Dos sesiones con el mismo nombre (dos en struo · main) se distinguen con un número.
  const vistos = new Map<string, number>()
  const sesiones = orden.map(sid => {
    const n = porNombre.get(sid) ?? { nombre: sid.slice(0, 8), proyecto: '' }
    const k = (vistos.get(n.nombre) ?? 0) + 1
    vistos.set(n.nombre, k)
    return { clave: claveDeSesion(sid), nombre: k > 1 ? `${n.nombre} (${k})` : n.nombre, proyecto: n.proyecto }
  })
  const indice = new Map(orden.map((sid, i) => [sid, i]))
  const sinVersion = {
    sesiones,
    eventos: eventos.map(e => {
      const hora = e.l.ts.slice(0, 10) === hoy ? horaMinuto(e.ms, d.desfase) : diaYHora(e.ms, d.desfase)
      return [hora, e.l.tipo, e.l.resumen, indice.get(e.sid) ?? 0] as [string, TipoBitacora, string, number]
    }),
  }
  return { version: huella(JSON.stringify(sinVersion)), ...sinVersion }
}

export function lineaBitacoraJs(m: ModeloBitacora): string {
  return `window.HUDDLE_BITACORA = ${JSON.stringify(m)};\n`
}

export function modeloActividad(d: DatosPanel, l: LecturaActividad, ahora: number, bitacora: ModeloBitacora): ActividadWeb {
  return {
    atascos: atascosWeb(d, ahora),
    cronograma: cronograma(d, l, ahora),
    uso: uso(d, l, ahora),
    bitacora: { version: bitacora.version, eventos: bitacora.eventos.length },
  }
}
