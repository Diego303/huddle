// La pantalla Panel (§3.1 del plan) compuesta como bloques de líneas y Rex.
// La disposición principal es la compacta (el panel acoplado a la derecha, ~89
// columnas); a partir de 100 columnas se usan dos columnas, como el wireframe.

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
import type { Linea } from './lienzo.ts'
import { ajustar, barra, celda, COLOR, columnas, extremos, minibarra, s } from './lienzo.ts'
import type { Celda } from './rex.ts'
import { COLUMNAS as ANCHO_REX, fotograma } from './rex.ts'

export type Bloque = { tipo: 'lineas'; lineas: Linea[] } | { tipo: 'rex'; celdas: Celda[][]; lado: Linea[]; ladoAncho: number }

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const SPIN = ['◐', '◓', '◑', '◒']
const dos = (n: number) => String(n).padStart(2, '0')

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

function colorContexto(pct: number): string {
  return pct >= 80 ? COLOR.rojo : pct >= 60 ? COLOR.ambar : COLOR.azul
}

function titulo(t: string, extra: Linea = []): Linea {
  return [s(t, { c: COLOR.titulo, b: true }), ...extra]
}

// ------------------------------------------------------------- secciones

function cabecera(d: DatosPanel, ahora: number, w: number): Linea {
  const refresh = d.ultimoRefresh === null ? 'sin /refresh' : `refresh hace ${duracion((ahora - d.ultimoRefresh) / 60_000)}`
  return extremos(
    [s('huddle', { c: COLOR.titulo, b: true }), s(` · ${d.raiz}`, { c: COLOR.gris })],
    [s(`${fechaCabecera(ahora, d.desfase)} · ${refresh}`, { c: COLOR.gris })],
    w,
  )
}

function lineaContadores(vistas: SesionVista[], d: DatosPanel, w: number): Linea[] {
  const c = contadores(vistas)
  const hoyPct = d.hoy ? porcentaje(d.hoy) : null
  const a: Linea = [
    s('Sesiones '),
    s(`${c.vivas}`, { b: true }),
    s(`/${c.total}`, { c: COLOR.gris }),
    s(' · Te esperan '),
    s(`${c.teEsperan}`, { b: true, ...(c.teEsperan > 0 ? { c: COLOR.ambar } : {}) }),
    s(' · Agentes '),
    s(`${c.leads}`, { b: true }),
    s(` +${c.subagentes} sub`, { c: COLOR.gris }),
  ]
  const b: Linea = [s('Tareas hoy '), s(hoyPct === null ? '—' : `${hoyPct}%`, { b: true }), s(' '), ...barra(hoyPct, 10, COLOR.verdeOscuro)]
  if (w >= 80) return [extremos(a, b, w)]
  return [a, b]
}

function bloqueRex(vistas: SesionVista[], fichas: FichaPanel[], d: DatosPanel, n: number, ladoAncho: number): Bloque {
  const estado = estadoRex(vistas, fichas)
  const lado: Linea[] = [
    titulo('Rex', [s(` · ${estado}`, { c: COLOR.gris })]),
    [],
    [s(`“${bocadillo(estado, vistas, fichas)}”`, { b: true, ...(estado === 'alerta' ? { c: COLOR.ambar } : {}) })],
    [],
    [s(`${textoRacha(racha(d.dias))} · nivel ${nivel(d.turnosTotales)}`, { c: COLOR.gris })],
  ]
  return { tipo: 'rex', celdas: fotograma(estado, n), lado, ladoAncho }
}

function ejecutandose(vistas: SesionVista[], n: number, w: number, max: number): Linea[] {
  const out: Linea[] = [titulo('Ejecutándose ahora')]
  if (vistas.length === 0) {
    out.push([s('  (ninguna sesión abierta)', { c: COLOR.gris })])
    return out
  }
  const wNombre = Math.min(28, Math.max(16, Math.floor(w * 0.34)))
  const wRol = 9
  const wDetalle = Math.max(8, w - wNombre - wRol - 6)
  const filas: Linea[] = []
  for (const v of vistas) {
    const color = colorEstado(v.estado)
    const detalle = v.estado === 'inactiva' ? `inactiva ${duracion(v.quietaMin)}` : v.s.detalle
    filas.push([
      s('● ', { c: color }),
      celda(v.etiqueta, wNombre, v.estado === 'inactiva' ? { d: true } : {}),
      celda('sesión', wRol, { c: COLOR.gris }),
      celda(detalle, wDetalle, v.estado === 'te_espera' ? { c: COLOR.ambar } : { c: COLOR.grisClaro }),
      s(` ${icono(v.estado, n)}`, { c: color }),
    ])
    for (const a of v.agentes) {
      filas.push([
        s('  └ ', { c: COLOR.gris }),
        celda(a.id, wNombre, { c: a.color }),
        celda(a.tipo, wRol, { c: a.color }),
        celda(a.estado === 'trabajando' ? a.descripcion : `${a.descripcion} · ${a.detalle}`, wDetalle - 2, { c: COLOR.grisClaro }),
        s(` ${icono(a.estado, n + 1)}`, { c: colorEstado(a.estado) }),
      ])
    }
  }
  if (filas.length > max) {
    const resto = filas.length - (max - 1)
    out.push(...filas.slice(0, max - 1), [s(`  … y ${resto} más`, { c: COLOR.gris })])
  } else {
    out.push(...filas)
  }
  return out
}

function progreso(fichas: FichaPanel[], w: number): Linea[] {
  const out: Linea[] = [titulo('Progreso por proyecto')]
  if (fichas.length === 0) out.push([s('  sin fichas: mueve proyectos a «Hacer seguimiento» y usa /proyectos', { c: COLOR.gris })])
  const wNombre = Math.min(14, Math.max(...fichas.map(f => f.carpeta.length), 6))
  const wFase = Math.max(6, Math.min(18, w - wNombre - 20))
  for (const f of fichas) {
    const fase = [f.fase, f.tareas.total > 0 ? `${f.tareas.hechas}/${f.tareas.total}` : ''].filter(Boolean).join(' · ')
    out.push([
      celda(f.carpeta, wNombre + 1),
      celda(fase || '—', wFase + 1, { c: COLOR.gris }),
      ...barra(f.pct, 10, f.pct === 100 ? COLOR.verde : COLOR.verdeOscuro),
      s(f.pct === null ? '    —' : `${String(f.pct).padStart(4)}%`),
    ])
  }
  return out
}

function contexto(vistas: SesionVista[], w: number): Linea[] {
  const out: Linea[] = [titulo('Contexto por sesión')]
  const vivas = vistas.filter(v => v.estado !== 'inactiva')
  if (vivas.length === 0) out.push([s('  —', { c: COLOR.gris })])
  const wNombre = Math.max(12, Math.min(26, w - 18))
  for (const v of vivas) {
    const pct = v.s.contexto_pct
    out.push([
      celda(v.etiqueta.replace(' · ', '·'), wNombre + 1),
      ...barra(pct, 10, pct === null ? COLOR.gris : colorContexto(pct)),
      s(pct === null ? '  n/d' : `${String(pct).padStart(4)}%`, pct === null ? { c: COLOR.gris } : {}),
    ])
  }
  return out
}

function listaAlertas(vistas: SesionVista[], d: DatosPanel, ahora: number) {
  const todas = [...alertasBasicas(vistas, d.sinClasificar), ...alertasGit(d.git ?? {}, ahora)]
  // Las graves primero; «sin clasificar» al final.
  const peso = (a: { nivel: string; texto: string }) => (a.texto.includes('sin clasificar') ? 2 : a.nivel === 'grave' ? 0 : 1)
  return todas.sort((a, b) => peso(a) - peso(b))
}

function alertas(vistas: SesionVista[], d: DatosPanel, ahora: number): Linea[] {
  const lista = listaAlertas(vistas, d, ahora)
  if (lista.length === 0) return [titulo('Alertas'), [s('  ninguna', { c: COLOR.gris })]]
  const mas = lista.length > 5 ? [[s(`  … y ${lista.length - 5} más`, { c: COLOR.gris })]] : []
  return [titulo('Alertas'), ...lista.slice(0, 5).map(a => [s('▲ ', { c: a.nivel === 'grave' ? COLOR.rojo : COLOR.ambar }), s(a.texto)]), ...mas]
}

function actividad(d: DatosPanel): Linea[] {
  const maxT = Math.max(0, ...d.dias.map(x => x.turnos))
  const maxC = Math.max(0, ...d.dias.map(x => x.commits ?? 0))
  const barras: Linea = [s(' ')]
  const letras: Linea = [s(' ')]
  for (const dia of d.dias) {
    barras.push(s(minibarra(dia.commits, maxC), { c: COLOR.morado }), s(minibarra(dia.turnos, maxT), { c: COLOR.verde }), s(' '))
    const sem = new Date(`${dia.dia}T12:00:00Z`).getUTCDay()
    letras.push(s(`${LETRA[sem]}  `, { c: COLOR.gris }))
  }
  return [
    titulo('Actividad 7 días', [s('  ■', { c: COLOR.morado }), s(' commits', { c: COLOR.gris }), s(' ■', { c: COLOR.verde }), s(' turnos', { c: COLOR.gris })]),
    barras,
    letras,
  ]
}

function siguiente(vistas: SesionVista[], d: DatosPanel): Linea[] {
  const acciones = d.siguiente.length > 0 ? d.siguiente : accionesPorReglas(vistas, d.git ?? {})
  const out: Linea[] = [titulo('Siguiente acción', d.siguiente.length === 0 && acciones.length > 0 ? [s('  (por reglas)', { c: COLOR.gris })] : [])]
  if (acciones.length === 0) out.push([s('  nada pendiente · /refresh para que Claude proponga', { c: COLOR.gris })])
  acciones.forEach((a, i) => out.push([s(`${i + 1}. `, { c: COLOR.gris }), s(a)]))
  return out
}

function uso(d: DatosPanel, ahora: number, w: number): Linea[] {
  const u = d.uso
  const ventana = (nombre: string, v: { pct: number; reinicia: string | null } | null | undefined): Linea =>
    v
      ? [s(`${nombre} `), ...barra(v.pct, 10, v.pct >= 80 ? COLOR.rojo : v.pct >= 60 ? COLOR.ambar : COLOR.azul), s(` ${Math.round(v.pct)}%`, { b: true }), s(` · ${reinicio(v.reinicia, ahora, d.desfase)}`, { c: COLOR.gris })]
      : [s(`${nombre} `), s('n/d · configúralo en config.json', { c: COLOR.gris })]
  const e = d.usoEstimado ?? null
  // Sin dato oficial pero con límites en la config: estimación con ≈.
  const estimada = (nombre: string, pct: number | null, reinicia: string): Linea =>
    pct === null
      ? [s(`${nombre} `), s('n/d · configúralo en config.json', { c: COLOR.gris })]
      : [s(`${nombre} `), ...barra(Math.min(100, pct), 10, pct >= 80 ? COLOR.rojo : pct >= 60 ? COLOR.ambar : COLOR.azul), s(` ≈${pct}%`, { b: true }), s(` · ${reinicia}`, { c: COLOR.gris })]
  const a = u === null && e ? estimada('Sesión 5 h', e.cinco_horas, 'ventana móvil de 5 h') : ventana('Sesión 5 h', u?.cinco_horas)
  const b =
    u === null && e
      ? estimada('Semana', e.semana, e.reinicioSemana === null ? 'reinicio n/d' : reinicio(new Date(e.reinicioSemana).toISOString(), ahora, d.desfase))
      : ventana('Semana', u?.semana)
  return w >= 96 ? [extremos(a, b, w)] : [a, b]
}

function pie(d: DatosPanel, w: number): Linea {
  return extremos(
    [s('/oficina · /refresh · /preguntar · /abrir', { c: COLOR.gris })],
    d.sinClasificar > 0 ? [s(`${d.sinClasificar} sin clasificar`, { c: COLOR.ambar })] : [],
    w,
  )
}

function regla(w: number): Linea {
  return [s('─'.repeat(w), { c: COLOR.gris })]
}

// ------------------------------------------------------------- composición

export function fichasPanel(d: DatosPanel, ahora: number): FichaPanel[] {
  return d.fichas.map(f => {
    const pct = porcentaje(f.tareas)
    return { ...f, pct, completadaHace: pct === 100 ? (ahora - f.mtime) / 60_000 : null }
  })
}

/** El panel entero para `w` columnas y `h` filas. `n` es el fotograma de la animación. */
export function componerPanel(d: DatosPanel | null, w: number, h: number, n: number, ahora: number): Bloque[] {
  const ancho = Math.max(30, w)
  if (d === null) return [{ tipo: 'lineas', lineas: [titulo('huddle'), [s('Leyendo la carpeta de control…', { c: COLOR.gris })]] }]
  const vistas = vistaSesiones(d.sesiones, ahora, d.inactiva_min)
  const fichas = fichasPanel(d, ahora)
  if (ancho >= 100) return panelAncho(d, vistas, fichas, ancho, h, n, ahora)

  const fijas =
    2 + // cabecera + contadores
    11 + // Rex
    1 + Math.max(1, fichas.length) +
    1 + Math.max(1, vistas.filter(v => v.estado !== 'inactiva').length) +
    1 + Math.max(1, Math.min(6, listaAlertas(vistas, d, ahora).length)) +
    3 + 4 + 2 + 1 + 6 // actividad, siguiente, uso, pie, separaciones
  const maxSesiones = Math.max(3, h - fijas)
  const lineas = (l: Linea[]): Bloque => ({ tipo: 'lineas', lineas: l.map(x => ajustar(x, ancho)) })
  return [
    lineas([cabecera(d, ahora, ancho), ...lineaContadores(vistas, d, ancho)]),
    bloqueRex(vistas, fichas, d, n, Math.max(10, ancho - ANCHO_REX - 2)),
    lineas([...ejecutandose(vistas, n, ancho, maxSesiones), [], ...progreso(fichas, ancho), [], ...contexto(vistas, ancho), [], ...alertas(vistas, d, ahora), [], ...actividad(d), [], ...siguiente(vistas, d), regla(ancho), ...uso(d, ahora, ancho), pie(d, ancho)]),
  ]
}

function panelAncho(d: DatosPanel, vistas: SesionVista[], fichas: FichaPanel[], w: number, h: number, n: number, ahora: number): Bloque[] {
  const izq = Math.floor((w - 3) * 0.42)
  const der = w - 3 - izq
  const arriba = Math.max(4, Math.min(14, h - 30))
  const lineas = (l: Linea[]): Bloque => ({ tipo: 'lineas', lineas: l.map(x => ajustar(x, w)) })
  const anchoTexto = w - ANCHO_REX - 3
  return [
    lineas([cabecera(d, ahora, w), regla(w)]),
    {
      tipo: 'rex',
      celdas: fotograma(estadoRex(vistas, fichas), n),
      lado: [...lineaContadores(vistas, d, anchoTexto), [], ...ejecutandose(vistas, n, anchoTexto, arriba)].map(x => ajustar(x, anchoTexto)),
      ladoAncho: anchoTexto,
    },
    lineas([
      ...bloqueRexTexto(vistas, fichas, d),
      regla(w),
      ...columnas(progreso(fichas, izq), [...contexto(vistas, der), ...alertas(vistas, d, ahora)], izq, der),
      regla(w),
      ...columnas(actividad(d), siguiente(vistas, d), izq, der),
      regla(w),
      ...uso(d, ahora, w),
      pie(d, w),
    ]),
  ]
}

/** En la disposición ancha, el bocadillo de Rex va en una línea bajo su dibujo. */
function bloqueRexTexto(vistas: SesionVista[], fichas: FichaPanel[], d: DatosPanel): Linea[] {
  const estado = estadoRex(vistas, fichas)
  return [[s(`Rex · “${bocadillo(estado, vistas, fichas)}”`, estado === 'alerta' ? { c: COLOR.ambar, b: true } : { b: true }), s(`   ${textoRacha(racha(d.dias))} · nivel ${nivel(d.turnosTotales)}`, { c: COLOR.gris })]]
}
