// La pantalla Panel (§3.1 del plan) como una rejilla de tarjetas.
//
//   compacto (70–90 col, el panel acoplado):   ancho (> 90 col): la misma
//   ╭KPI╮╭KPI╮╭KPI╮╭KPI╮                         rejilla con más aire, y Rex a
//   ╭Rex╮╭Ejecutándose ahora────╮                2× si sobra alto.
//   ╭Progreso──╮╭Contexto───────╮                estrecho (< 70): KPIs 2×2 y
//   │          │╰Alertas────────╯                una tarjeta por fila.
//   ╭Actividad─╮╭Siguiente acción╮
//   ╭Sesión 5 h╮╭Semana─────────╮
//   pie
//
// Todo son líneas del lienzo, cada una exactamente del ancho pedido.

import type { DatosPanel } from '../lib/lector.ts'
import type { FichaPanel, SesionVista } from '../lib/panel-datos.ts'
import {
  accionesPorReglas,
  alertasBasicas,
  alertasGit,
  bocadillo,
  contadores,
  estadoRex,
  nivel,
  porcentaje,
  racha,
  vistaSesiones,
} from '../lib/panel-datos.ts'
import { anchoGrande, grande } from './digitos.ts'
import type { Linea } from './lienzo.ts'
import { ajustar, ancho, barraSuave, col, COLOR, columnaVertical, CORAL_CLARO, extremos, fila, interior, partir, queQuepa, repartir, s, tarjeta } from './lienzo.ts'
import type { Adorno } from './rex.ts'
import { adornoDe, comoLineas, fotograma, tamano } from './rex.ts'

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const SPIN = ['◐', '◓', '◑', '◒']
const APAGADO = '#3a3936'
const dos = (n: number) => String(n).padStart(2, '0')
const gris = { c: COLOR.gris }

function local(ms: number, desfase: number): Date {
  return new Date(ms + desfase * 60_000)
}

export function fechaCabecera(ms: number, desfase: number): string {
  const d = local(ms, desfase)
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]} · ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`
}

export function duracion(min: number): string {
  if (min < 1) return 'ahora'
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** `reinicia en 2h 10m` si es hoy o pronto; `reinicia jue 09:00` si queda más de un día. */
export function reinicio(iso: string | null, ahora: number, desfase: number): string {
  if (iso === null) return 'reinicio n/d'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'reinicio n/d'
  const min = (t - ahora) / 60_000
  if (min <= 0) return 'reiniciado'
  if (min < 24 * 60) return `reinicia en ${duracion(min)}`
  const d = local(t, desfase)
  return `reinicia ${DIAS[d.getUTCDay()]} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}`
}

export function textoRacha(n: number): string {
  return n === 1 ? 'racha 1 día' : `racha ${n} días`
}

function colorEstado(v: SesionVista['estado']): string {
  switch (v) {
    case 'trabajando':
      return COLOR.verde
    case 'te_espera':
      return COLOR.ambar
    case 'en_pausa':
      return COLOR.grisClaro
    case 'inactiva':
      return COLOR.gris
  }
}

function icono(estado: string, n: number): string {
  if (estado === 'trabajando') return SPIN[n % 4]!
  if (estado === 'te_espera') return '⏸'
  if (estado === 'inactiva') return 'z'
  return '·'
}

/** Azul por debajo del 60 %, ámbar del 60 al 80 % y rojo a partir del 80 %. */
export function colorPorcentaje(pct: number): string {
  return pct >= 80 ? COLOR.rojo : pct >= 60 ? COLOR.ambar : COLOR.azul
}

function centrar(l: Linea, w: number): Linea {
  const hueco = Math.max(0, Math.floor((w - ancho(l)) / 2))
  return hueco > 0 ? [s(' '.repeat(hueco)), ...l] : l
}

export function fichasPanel(d: DatosPanel, ahora: number): FichaPanel[] {
  return d.fichas.map(f => {
    const pct = porcentaje(f.tareas)
    return { ...f, pct, completadaHace: pct === 100 ? (ahora - f.mtime) / 60_000 : null }
  })
}

export function adornoHoy(d: DatosPanel, ahora: number): Adorno {
  const l = local(ahora, d.desfase)
  return adornoDe(l.getUTCMonth() + 1, l.getUTCDate(), d.rex_estacional ?? true)
}

// ------------------------------------------------------------- contexto común

export type Ctx = {
  d: DatosPanel
  vistas: SesionVista[]
  fichas: FichaPanel[]
  n: number
  ahora: number
  aire: number
}

function listaAlertas(c: Ctx) {
  const todas = [...alertasBasicas(c.vistas, c.d.sinClasificar), ...alertasGit(c.d.git ?? {}, c.ahora)]
  // Las graves primero; «sin clasificar» al final.
  const peso = (a: { nivel: string; texto: string }) => (a.texto.includes('sin clasificar') ? 2 : a.nivel === 'grave' ? 0 : 1)
  return todas.sort((a, b) => peso(a) - peso(b))
}

// ------------------------------------------------------------- tarjetas

/**
 * Un KPI: número grande (3×3), sufijo pequeño a su lado y una línea de detalle.
 * Si sobra ancho, el detalle va en tres líneas a la derecha de los dígitos.
 */
function kpi(o: {
  titulo: string
  valor: string
  color: string
  sufijo: Linea
  /** Variantes del detalle de una línea, de la más larga a la más corta. */
  corto: readonly string[]
  /** Hasta 3 líneas para el lado de los dígitos. */
  largo: readonly Linea[]
  /** Una línea extra al pie (la barra de «Tareas hoy»). */
  pieKpi?: Linea
  w: number
  aire: number
}): Linea[] {
  const dentro = interior(o.w, o.aire)
  const filas = grande(o.valor, o.color)
  const izquierda = anchoGrande(o.valor) + (o.sufijo.length > 0 ? 1 + ancho(o.sufijo) : 0)
  const alLado = dentro - izquierda - 3 >= Math.max(16, ...o.largo.map(l => ancho(l)))
  const lineas: Linea[] = filas.map((f, i) => {
    const base = i === filas.length - 1 && o.sufijo.length > 0 ? [...f, s(' '), ...o.sufijo] : f
    if (!alLado) return base
    const relleno = Math.max(0, izquierda - ancho(base)) + 3
    return [...base, s(' '.repeat(relleno)), ...(o.largo[i] ?? [])]
  })
  if (o.pieKpi) lineas.push(o.pieKpi)
  else lineas.push(alLado ? [] : [s(queQuepa(o.corto, dentro), gris)])
  return tarjeta(lineas, { titulo: o.titulo, ancho: o.w, aire: o.aire })
}

function kpis(c: Ctx, anchos: readonly number[]): Linea[][] {
  const k = contadores(c.vistas)
  const trabajando = c.vistas.filter(v => v.estado === 'trabajando').length
  const pausa = c.vistas.filter(v => v.estado === 'en_pausa').length
  const inactivas = k.total - k.vivas
  const espera = c.vistas.filter(v => v.estado === 'te_espera')
  const tipos = new Map<string, number>()
  for (const v of c.vistas) {
    if (v.estado === 'inactiva') continue
    for (const a of v.agentes) if (a.estado !== 'en_pausa') tipos.set(a.tipo, (tipos.get(a.tipo) ?? 0) + 1)
  }
  const hoy = c.d.hoy
  const pct = hoy ? porcentaje(hoy) : null
  const w = (i: number) => anchos[i] ?? 20
  const nombre = (v: SesionVista) => (v.s.tipo === 'proyecto' ? (v.s.rama ?? v.s.proyecto) : v.s.proyecto)
  const listaTipos = [...tipos].map(([t, n]) => (n > 1 ? `${t} ×${n}` : t))
  const dentroTareas = interior(w(3), c.aire)
  return [
    kpi({
      titulo: 'Sesiones',
      valor: String(k.vivas),
      color: COLOR.verde,
      sufijo: [s(`/${k.total}`, gris)],
      corto: [
        `${trabajando} trabajando · ${pausa} en pausa${inactivas > 0 ? ` · ${inactivas} inactiva${inactivas === 1 ? '' : 's'}` : ''}`,
        `${trabajando} trabajando · ${pausa} en pausa`,
        `${trabajando} trab · ${pausa} pausa`,
        `${trabajando} trabajando`,
      ],
      largo: [
        [s('● ', { c: COLOR.verde }), s(`${trabajando} trabajando`)],
        [s('● ', { c: COLOR.grisClaro }), s(`${pausa} en pausa`)],
        [s('● ', gris), s(`${inactivas} inactiva${inactivas === 1 ? '' : 's'}`, gris)],
      ],
      w: w(0),
      aire: c.aire,
    }),
    kpi({
      titulo: 'Te esperan',
      valor: String(k.teEsperan),
      color: k.teEsperan > 0 ? COLOR.ambar : COLOR.grisClaro,
      sufijo: [],
      corto: espera[0] ? [`${nombre(espera[0])} · ${duracion(espera[0].esperaMin ?? 0)}`, nombre(espera[0])] : ['nadie espera'],
      largo: espera.length > 0 ? espera.slice(0, 3).map(v => [s(nombre(v), { c: COLOR.ambar }), s(` · ${duracion(v.esperaMin ?? 0)} · ${v.s.detalle}`, gris)]) : [[s('nadie espera', gris)]],
      w: w(1),
      aire: c.aire,
    }),
    kpi({
      titulo: 'Agentes',
      valor: String(k.leads),
      color: COLOR.titulo,
      sufijo: [s(`+${k.subagentes} sub`, gris)],
      corto: listaTipos.length > 0 ? [listaTipos.join(' · '), `${listaTipos.length} tipos`] : ['ningún subagente en marcha', 'sin subagentes'],
      largo: [
        [s(`${k.leads} lead${k.leads === 1 ? '' : 's'} trabajando`)],
        listaTipos.length > 0 ? [s(listaTipos.join(' · '), gris)] : [s('sin subagentes', gris)],
      ],
      w: w(2),
      aire: c.aire,
    }),
    kpi({
      titulo: 'Tareas hoy',
      valor: pct === null ? '-' : String(pct),
      color: COLOR.verdeOscuro,
      sufijo: pct === null ? [] : [s('%', { c: COLOR.verdeOscuro, b: true })],
      corto: ['sin tareas en «Hoy»', 'sin tareas'],
      largo: hoy && hoy.total > 0 ? [[s(`${hoy.hechas} de ${hoy.total} hechas`)], [s(`${hoy.total - hoy.hechas} pendientes`, gris)]] : [[s('sin tareas en «Hoy»', gris)]],
      ...(hoy && hoy.total > 0 ? { pieKpi: [...barraSuave(pct, Math.max(4, dentroTareas - 6), COLOR.verdeOscuro), s(` ${hoy.hechas}/${hoy.total}`, gris)] } : {}),
      w: w(3),
      aire: c.aire,
    }),
  ]
}

function tarjetaRex(c: Ctx, w: number, escala: 1 | 2, alto?: number): Linea[] {
  const estado = estadoRex(c.vistas, c.fichas)
  const dentro = interior(w, c.aire)
  const sprite = comoLineas(fotograma(estado, c.n, adornoHoy(c.d, c.ahora), escala)).map(l => centrar(l, dentro))
  const globo = partir(`“${bocadillo(estado, c.vistas, c.fichas)}”`, dentro, 2).map(t =>
    centrar([s(t, estado === 'alerta' ? { c: COLOR.ambar, b: true } : { b: true })], dentro),
  )
  const pieRex = centrar([s(`${textoRacha(racha(c.d.dias))} · nivel ${nivel(c.d.turnosTotales)}`, gris)], dentro)
  return tarjeta([...sprite, ...globo, pieRex], { titulo: 'Rex', derecha: [s(estado, gris)], ancho: w, aire: c.aire, ...(alto ? { alto } : {}) })
}

function filasEjecucion(c: Ctx): number {
  return c.vistas.length + c.vistas.reduce((a, v) => a + v.agentes.length, 0)
}

function tarjetaEjecucion(c: Ctx, w: number, alto: number): Linea[] {
  const dentro = interior(w, c.aire)
  const max = Math.max(1, alto - 2)
  const filas: Linea[] = []
  if (c.vistas.length === 0) filas.push([s('ninguna sesión abierta', gris)])
  const wNombre = Math.min(28, Math.max(16, Math.floor(dentro * 0.4)))
  const wRol = 9
  const wDetalle = Math.max(6, dentro - wNombre - wRol - 4)
  for (const v of c.vistas) {
    const color = colorEstado(v.estado)
    const detalle = v.estado === 'inactiva' ? `inactiva ${duracion(v.quietaMin)}` : v.s.detalle
    filas.push([
      s('● ', { c: color }),
      ...col(v.etiqueta, wNombre, v.estado === 'inactiva' ? { d: true } : {}),
      ...col('sesión', wRol, gris),
      ...col(detalle, wDetalle, v.estado === 'te_espera' ? { c: COLOR.ambar } : { c: COLOR.grisClaro }),
      s(` ${icono(v.estado, c.n)}`, { c: color }),
    ])
    for (const a of v.agentes) {
      filas.push([
        s('└ ', gris),
        ...col(a.id, wNombre, { c: a.color }),
        ...col(a.tipo, wRol, { c: a.color }),
        ...col(a.estado === 'trabajando' ? a.descripcion : `${a.descripcion} · ${a.detalle}`, wDetalle, { c: COLOR.grisClaro }),
        s(` ${icono(a.estado, c.n + 1)}`, { c: colorEstado(a.estado) }),
      ])
    }
  }
  const visibles = filas.length > max ? [...filas.slice(0, max - 1), [s(`… y ${filas.length - (max - 1)} más`, gris)]] : filas
  return tarjeta(visibles, {
    titulo: 'Ejecutándose ahora',
    derecha: [s(`${c.vistas.length} ${c.vistas.length === 1 ? 'sesión' : 'sesiones'}`, gris)],
    ancho: w,
    alto,
    aire: c.aire,
  })
}

/** Los proyectos en seguimiento, en el orden de PROYECTOS.md, con su ficha si la tienen. */
export function proyectosEnSeguimiento(d: DatosPanel, fichas: readonly FichaPanel[]): { nombre: string; ficha: FichaPanel | null }[] {
  const nombres = d.seguimiento ?? fichas.map(f => f.carpeta)
  return nombres.map(n => ({ nombre: n, ficha: fichas.find(f => f.carpeta.toLowerCase() === n.toLowerCase()) ?? null }))
}

/** «8 proyectos en seguimiento» y, si faltan fichas, «3 sin ficha · /proyectos» (sin contar el resto de carpetas). */
export function resumenSeguimiento(n: number, sinFicha: number): string[] {
  if (n === 0) return ['ningún proyecto en seguimiento', 'edita PROYECTOS.md y luego /proyectos']
  const base = `${n} ${n === 1 ? 'proyecto' : 'proyectos'} en seguimiento`
  return sinFicha > 0 ? [base, `${sinFicha} sin ficha · /proyectos las crea`] : [base]
}

function tarjetaProgreso(c: Ctx, w: number, alto?: number): Linea[] {
  const dentro = interior(w, c.aire)
  const lista = proyectosEnSeguimiento(c.d, c.fichas)
  const lineas: Linea[] = []
  const wNombre = Math.min(20, Math.max(6, ...lista.map(p => p.nombre.length)))
  const wFase = Math.max(0, Math.min(16, dentro - wNombre - 1 - 13))
  const wBarra = Math.max(4, dentro - wNombre - 1 - (wFase > 0 ? wFase + 1 : 0) - 5)
  for (const { nombre, ficha } of lista) {
    const nombreCol = col(nombre, wNombre + 1, ficha ? {} : gris)
    if (ficha === null) {
      // Sin ficha no hay progreso que enseñar: ni barra ni porcentaje inventado.
      lineas.push([...nombreCol, ...col('sin ficha', dentro - wNombre - 1 - 5, gris), s('    —', gris)])
      continue
    }
    const fase = [ficha.fase, ficha.tareas.total > 0 ? `${ficha.tareas.hechas}/${ficha.tareas.total}` : 'sin tareas'].filter(Boolean).join(' · ')
    lineas.push([
      ...nombreCol,
      ...(wFase > 0 ? col(fase, wFase + 1, gris) : []),
      ...barraSuave(ficha.pct, wBarra, ficha.pct === 100 ? COLOR.verde : COLOR.verdeOscuro),
      s(ficha.pct === null ? '    —' : `${String(ficha.pct).padStart(4)}%`, ficha.pct === null ? gris : {}),
    ])
  }
  const sinFicha = lista.filter(p => p.ficha === null).length
  const [base, aviso] = resumenSeguimiento(lista.length, sinFicha)
  lineas.push([s(base ?? '', gris)])
  if (aviso) lineas.push([s(aviso, { c: COLOR.ambar })])
  return tarjeta(lineas, { titulo: 'Progreso por proyecto', ancho: w, aire: c.aire, ...(alto ? { alto } : {}) })
}

function tarjetaContexto(c: Ctx, w: number): Linea[] {
  const dentro = interior(w, c.aire)
  const vivas = c.vistas.filter(v => v.estado !== 'inactiva')
  const wNombre = Math.max(10, Math.min(24, dentro - 16))
  const wBarra = Math.max(4, dentro - wNombre - 1 - 5)
  const lineas: Linea[] = vivas.map(v => {
    const pct = v.s.contexto_pct
    return [
      ...col(v.etiqueta.replace(' · ', '·'), wNombre + 1),
      ...barraSuave(pct, wBarra, pct === null ? COLOR.gris : colorPorcentaje(pct)),
      s(pct === null ? '  n/d' : `${String(pct).padStart(4)}%`, pct === null ? gris : {}),
    ]
  })
  if (lineas.length === 0) lineas.push([s('sin sesiones vivas', gris)])
  return tarjeta(lineas, { titulo: 'Contexto por sesión', ancho: w, aire: c.aire })
}

function tarjetaAlertas(c: Ctx, w: number, alto?: number): Linea[] {
  const lista = listaAlertas(c)
  const max = alto === undefined ? 5 : Math.max(1, alto - 2)
  let lineas: Linea[] = lista.map(a => [s('▲ ', { c: a.nivel === 'grave' ? COLOR.rojo : COLOR.ambar }), s(a.texto)])
  if (lineas.length > max) lineas = [...lineas.slice(0, max - 1), [s(`… y ${lista.length - (max - 1)} más`, gris)]]
  if (lineas.length === 0) lineas.push([s('ninguna', gris)])
  return tarjeta(lineas, {
    titulo: 'Alertas',
    derecha: lista.length > 0 ? [s(String(lista.length), { c: COLOR.ambar })] : [],
    ancho: w,
    aire: c.aire,
    ...(alto ? { alto } : {}),
  })
}

export type DiaSemana = { dia: string; letra: string; turnos: number | null; commits: number | null; hoy: boolean }

/** De lunes a domingo de la semana en curso, con los datos de los últimos 7 días; lo futuro, sin dato. */
export function semana(d: DatosPanel, ahora: number): DiaSemana[] {
  const desdeLunes = (local(ahora, d.desfase).getUTCDay() + 6) % 7
  const porDia = new Map(d.dias.map(x => [x.dia, x]))
  const out: DiaSemana[] = []
  for (let i = 0; i < 7; i++) {
    const dia = local(ahora + (i - desdeLunes) * 86_400_000, d.desfase).toISOString().slice(0, 10)
    const futuro = i > desdeLunes
    const dato = porDia.get(dia)
    out.push({
      dia,
      letra: LETRA[(i + 1) % 7]!,
      turnos: futuro ? null : (dato?.turnos ?? 0),
      commits: futuro ? null : (dato?.commits ?? null),
      hoy: i === desdeLunes,
    })
  }
  return out
}

/** Alto de las barras de actividad, en filas. */
const ALTO_ACTIVIDAD = 4

function tarjetaActividad(c: Ctx, w: number, alto?: number): Linea[] {
  const dentro = interior(w, c.aire)
  const dias = semana(c.d, c.ahora)
  const maxT = Math.max(0, ...dias.map(x => x.turnos ?? 0))
  const maxC = Math.max(0, ...dias.map(x => x.commits ?? 0))
  const hueco = Math.max(3, Math.floor(dentro / 7))
  // Con sitio, cada barra ocupa 2 columnas (4 por día); si no, 1.
  const grosor = hueco >= 8 ? 2 : 1
  const par = grosor * 2
  const margen = Math.max(0, Math.floor((dentro - hueco * 7) / 2))
  const izq = Math.floor((hueco - par) / 2)
  const cols = dias.map(x => ({ c: columnaVertical(x.commits, maxC, ALTO_ACTIVIDAD), t: columnaVertical(x.turnos, maxT, ALTO_ACTIVIDAD) }))
  const lineas: Linea[] = []
  for (let r = 0; r < ALTO_ACTIVIDAD; r++) {
    const l: Linea = [s(' '.repeat(margen))]
    for (const x of cols) {
      const a = x.c[r]!
      const b = x.t[r]!
      l.push(
        s(' '.repeat(izq)),
        s(a.ch.repeat(grosor), { c: a.apagada ? APAGADO : COLOR.morado }),
        s(b.ch.repeat(grosor), { c: b.apagada ? APAGADO : COLOR.verde }),
        s(' '.repeat(hueco - par - izq)),
      )
    }
    lineas.push(l)
  }
  const letras: Linea = [s(' '.repeat(margen))]
  for (const x of dias) {
    const li = Math.floor((hueco - 1) / 2)
    letras.push(s(' '.repeat(li)), s(x.letra, x.hoy ? { c: CORAL_CLARO, b: true } : gris), s(' '.repeat(hueco - 1 - li)))
  }
  lineas.push(letras)
  const sinCommits = c.d.dias.every(x => x.commits === null)
  return tarjeta(lineas, {
    titulo: 'Actividad',
    derecha: [s('■', { c: COLOR.morado }), s(sinCommits ? ' commits n/d ' : ' commits ', gris), s('■', { c: COLOR.verde }), s(' turnos', gris)],
    ancho: w,
    aire: c.aire,
    ...(alto ? { alto } : {}),
  })
}

function tarjetaSiguiente(c: Ctx, w: number, alto?: number): Linea[] {
  const dentro = interior(w, c.aire)
  const porReglas = c.d.siguiente.length === 0
  const acciones = porReglas ? accionesPorReglas(c.vistas, c.d.git ?? {}) : c.d.siguiente
  const max = alto === undefined ? 6 : Math.max(1, alto - 2)
  const lineas: Linea[] = []
  acciones.forEach((a, i) => {
    const trozos = partir(a, dentro - 3, Math.max(1, Math.floor(max / Math.max(1, acciones.length))))
    trozos.forEach((t, j) => lineas.push([s(j === 0 ? `${i + 1}. ` : '   ', gris), s(t)]))
  })
  if (lineas.length === 0) lineas.push([s('nada pendiente', gris)], [s('/refresh para que Claude proponga', gris)])
  return tarjeta(lineas.slice(0, max), {
    titulo: 'Siguiente acción',
    derecha: porReglas && acciones.length > 0 ? [s('por reglas', gris)] : [],
    ancho: w,
    aire: c.aire,
    ...(alto ? { alto } : {}),
  })
}

function tarjetasUso(c: Ctx, anchos: readonly number[]): Linea[][] {
  const u = c.d.uso
  const e = c.d.usoEstimado ?? null
  const una = (titulo: string, pct: number | null, aprox: boolean, pieUso: string, w: number): Linea[] => {
    const dentro = interior(w, c.aire)
    const etiqueta = pct === null ? 'n/d' : `${aprox ? '≈' : ''}${Math.round(pct)}%`
    const barra = barraSuave(pct === null ? null : Math.min(100, pct), Math.max(4, dentro - etiqueta.length - 1), pct === null ? COLOR.gris : colorPorcentaje(pct))
    return tarjeta([[...barra, s(' '), s(etiqueta, pct === null ? gris : { b: true })], [s(pieUso, gris)]], { titulo, ancho: w, aire: c.aire })
  }
  const w0 = anchos[0] ?? 20
  const w1 = anchos[1] ?? 20
  const reinicioEstimado = e && e.reinicioSemana !== null ? reinicio(new Date(e.reinicioSemana).toISOString(), c.ahora, c.d.desfase) : 'reinicio n/d'
  const cinco = u?.cinco_horas
    ? una('Sesión 5 h', u.cinco_horas.pct, false, reinicio(u.cinco_horas.reinicia, c.ahora, c.d.desfase), w0)
    : u === null && e && e.cinco_horas !== null
      ? una('Sesión 5 h', e.cinco_horas, true, 'ventana móvil de 5 h', w0)
      : una('Sesión 5 h', null, false, 'n/d · configúralo en config.json', w0)
  const sem = u?.semana
    ? una('Semana', u.semana.pct, false, reinicio(u.semana.reinicia, c.ahora, c.d.desfase), w1)
    : u === null && e && e.semana !== null
      ? una('Semana', e.semana, true, reinicioEstimado, w1)
      : una('Semana', null, false, 'n/d · configúralo en config.json', w1)
  return [cinco, sem]
}

function pie(c: Ctx, w: number): Linea {
  return extremos(
    [s(' /oficina · /refresh · /preguntar · /abrir', gris)],
    c.d.sinClasificar > 0 ? [s(`${c.d.sinClasificar} sin clasificar `, { c: COLOR.ambar })] : [],
    w,
  )
}

/** La cabecera (a la derecha de las pestañas): carpeta, fecha y el último /refresh. */
export function cabecera(d: DatosPanel | null, ahora: number, w: number): Linea {
  if (d === null) return ajustar([s(' huddle', { c: COLOR.titulo, b: true })], w)
  const refresh = d.ultimoRefresh === null ? 'sin /refresh' : `refresh hace ${duracion((ahora - d.ultimoRefresh) / 60_000)}`
  return ajustar(extremos([s(' huddle', { c: COLOR.titulo, b: true }), s(` · ${d.raiz}`, gris)], [s(`${fechaCabecera(ahora, d.desfase)} · ${refresh} `, gris)], w), w)
}

// ------------------------------------------------------------- composición

export type Modo = 'estrecho' | 'compacto' | 'ancho'

export function modoDe(w: number): Modo {
  return w < 70 ? 'estrecho' : w <= 90 ? 'compacto' : 'ancho'
}

/** El cuerpo del panel para `w` columnas y `h` filas (sin la fila de pestañas). */
export function componerPanel(d: DatosPanel | null, w: number, h: number, n: number, ahora: number): Linea[] {
  const total = Math.max(30, w)
  if (d === null) return [ajustar([s(' Leyendo la carpeta de control…', gris)], total)]
  const modo = modoDe(total)
  const hueco = modo === 'ancho' ? 2 : 1
  const c: Ctx = {
    d,
    vistas: vistaSesiones(d.sesiones, ahora, d.inactiva_min),
    fichas: fichasPanel(d, ahora),
    n,
    ahora,
    aire: modo === 'ancho' ? 2 : 1,
  }
  const dosCol = repartir(total, [1, 1], hueco)

  if (modo === 'estrecho') {
    const k = kpis(c, [...dosCol, ...dosCol])
    const lineas = [
      ...fila([k[0]!, k[1]!], dosCol, hueco),
      ...fila([k[2]!, k[3]!], dosCol, hueco),
      ...tarjetaRex(c, total, 1),
      ...tarjetaEjecucion(c, total, Math.min(10, 2 + Math.max(1, filasEjecucion(c)))),
      ...tarjetaProgreso(c, total),
      ...tarjetaContexto(c, total),
      ...tarjetaAlertas(c, total),
      ...tarjetaActividad(c, total),
      ...tarjetaSiguiente(c, total),
      ...fila(tarjetasUso(c, dosCol), dosCol, hueco),
      pie(c, total),
    ]
    return lineas.map(l => ajustar(l, total))
  }

  const cuatro = repartir(total, [1, 1, 1, 1], hueco)
  const filaKpis = fila(kpis(c, cuatro), cuatro, hueco)

  // Progreso | Contexto + Alertas, igualadas en alto.
  const contexto = tarjetaContexto(c, dosCol[1]!)
  const alto3 = Math.max(tarjetaProgreso(c, dosCol[0]!).length, contexto.length + tarjetaAlertas(c, dosCol[1]!).length)
  const fila3 = fila([tarjetaProgreso(c, dosCol[0]!, alto3), [...contexto, ...tarjetaAlertas(c, dosCol[1]!, alto3 - contexto.length)]], dosCol, hueco)

  // Actividad | Siguiente acción.
  const alto4 = Math.max(tarjetaActividad(c, dosCol[0]!).length, tarjetaSiguiente(c, dosCol[1]!).length)
  const fila4 = fila([tarjetaActividad(c, dosCol[0]!, alto4), tarjetaSiguiente(c, dosCol[1]!, alto4)], dosCol, hueco)

  const filaUso = fila(tarjetasUso(c, dosCol), dosCol, hueco)

  // Rex + Ejecutándose ahora, con lo que quede de alto. Rex a 2× solo si sobra.
  const resto = h - filaKpis.length - fila3.length - fila4.length - filaUso.length - 1
  const naturalEjec = 2 + Math.max(1, filasEjecucion(c))
  const doble = modo === 'ancho' && resto >= tamano(2).filas + 5
  const anchoRex = doble ? tamano(2).columnas + 2 + 2 * c.aire : modo === 'ancho' ? 30 : 28
  const altoRex = tarjetaRex(c, anchoRex, doble ? 2 : 1).length
  const altoFila2 = Math.max(altoRex, Math.min(naturalEjec, resto))
  const anchoEjec = total - anchoRex - hueco
  const fila2 = fila([tarjetaRex(c, anchoRex, doble ? 2 : 1, altoFila2), tarjetaEjecucion(c, anchoEjec, altoFila2)], [anchoRex, anchoEjec], hueco)

  return [...filaKpis, ...fila2, ...fila3, ...fila4, ...filaUso, pie(c, total)].map(l => ajustar(l, total))
}
