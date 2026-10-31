// Lo que el panel calcula a partir de los ficheros (§3.1 del plan). Todo puro:
// el lector junta los datos en `DatosPanel` y la vista se calcula al dibujar.

import type { Agente, EstadoNombre, EstadoSesion, Uso } from './estado.ts'

// ---------------------------------------------------------------- Markdown

function sinComentarios(texto: string): string {
  return texto.replace(/<!--[\s\S]*?-->/g, '')
}

/** Las líneas de una sección `## Título` (sin tildes ni mayúsculas en el título). */
export function seccion(texto: string, titulo: string): string[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const lineas = sinComentarios(texto).split(/\r?\n/)
  const i = lineas.findIndex(l => /^##\s/.test(l) && norm(l.replace(/^##\s+/, '')) === norm(titulo))
  if (i < 0) return []
  const fin = lineas.findIndex((l, j) => j > i && /^#{1,2}\s/.test(l))
  return lineas.slice(i + 1, fin < 0 ? undefined : fin)
}

export type Casillas = { hechas: number; total: number }

export function casillas(lineas: readonly string[]): Casillas {
  let hechas = 0
  let total = 0
  for (const l of lineas) {
    const m = /^\s*[-*+]\s+\[([ xX])\]/.exec(l)
    if (!m) continue
    total += 1
    if (m[1] !== ' ') hechas += 1
  }
  return { hechas, total }
}

export function porcentaje(c: Casillas): number | null {
  return c.total === 0 ? null : Math.round((c.hechas / c.total) * 100)
}

export type Ficha = { carpeta: string; codigo: string; fase: string; tareas: Casillas }

/** Una ficha de proyecto: código y fase del front matter, y las casillas de `## Tareas`. */
export function interpretarFicha(carpeta: string, texto: string): Ficha {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(texto)?.[1] ?? ''
  const campo = (k: string) => new RegExp(`^${k}:\\s*(.*?)\\s*$`, 'm').exec(fm)?.[1] ?? ''
  return {
    carpeta,
    codigo: campo('codigo').toUpperCase(),
    fase: campo('fase').replace(/^["']|["']$/g, ''),
    tareas: casillas(seccion(texto, 'Tareas')),
  }
}

/** `## Siguiente acción` de ESTADO.md: como mucho 3 elementos, numerados o en viñeta. */
export function siguienteAccion(estadoMd: string): string[] {
  return seccion(estadoMd, 'Siguiente acción')
    .map(l => /^\s*(?:\d+[.)]|[-*+])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(l)?.[1] ?? '')
    .filter(l => l !== '' && l !== '...' && l !== '…')
    .slice(0, 3)
}

// ---------------------------------------------------------------- sesiones

export type EstadoVisible = EstadoNombre | 'inactiva'

export type AgenteVista = Agente & { id: string; color: string }

export type SesionVista = {
  s: EstadoSesion
  estado: EstadoVisible
  leadId: string
  etiqueta: string
  agentes: AgenteVista[]
  /** Minutos desde el último evento. */
  quietaMin: number
  /** Minutos esperando, si te espera. */
  esperaMin: number | null
}

export const COLOR_ROL: Record<string, string> = {
  lead: '#D85A30',
  explore: '#7F77DD',
  plan: '#378ADD',
  tests: '#1D9E75',
  general: '#1D9E75',
}

export function colorDeRol(tipo: string): string {
  return COLOR_ROL[tipo] ?? '#1D9E75'
}

const ORDEN: Record<EstadoVisible, number> = { te_espera: 0, trabajando: 1, en_pausa: 2, inactiva: 3 }

function ms(iso: string): number {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

const dos = (n: number) => String(n).padStart(2, '0')

/**
 * Estado visible, IDs (`STR-lead-01`, `STR-explore-01`: numerados por proyecto
 * según el orden de inicio) y orden de la lista: primero lo que te espera.
 */
export function vistaSesiones(sesiones: readonly EstadoSesion[], ahora: number, inactivaMin: number): SesionVista[] {
  const porInicio = [...sesiones].sort((a, b) => ms(a.inicio) - ms(b.inicio) || a.session_id.localeCompare(b.session_id))
  const leads = new Map<string, number>()
  const tipos = new Map<string, number>()
  const vistas = porInicio.map(s => {
    const quietaMin = Math.max(0, (ahora - ms(s.ultimo_evento)) / 60_000)
    const estado: EstadoVisible = quietaMin > inactivaMin && s.estado !== 'te_espera' ? 'inactiva' : s.estado
    const n = (leads.get(s.codigo) ?? 0) + 1
    leads.set(s.codigo, n)
    const agentes = [...s.agentes]
      .sort((a, b) => ms(a.inicio) - ms(b.inicio))
      .map(a => {
        const k = `${s.codigo}-${a.tipo}`
        const m = (tipos.get(k) ?? 0) + 1
        tipos.set(k, m)
        return { ...a, id: `${k}-${dos(m)}`, color: colorDeRol(a.tipo) }
      })
    const etiqueta =
      s.tipo === 'torre' ? 'GENERAL · torre' : s.tipo === 'otros' ? `otros · ${nombreCarpeta(s.cwd)}` : `${s.proyecto} · ${s.rama ?? 'n/d'}`
    return {
      s,
      estado,
      leadId: `${s.codigo}-lead-${dos(n)}`,
      etiqueta,
      agentes,
      quietaMin,
      esperaMin: s.estado === 'te_espera' && s.te_espera_desde ? Math.max(0, (ahora - ms(s.te_espera_desde)) / 60_000) : null,
    }
  })
  return vistas.sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || ms(a.s.inicio) - ms(b.s.inicio))
}

function nombreCarpeta(ruta: string): string {
  return ruta.slice(ruta.lastIndexOf('/') + 1) || ruta
}

export type Contadores = { vivas: number; total: number; teEsperan: number; leads: number; subagentes: number }

export function contadores(vistas: readonly SesionVista[]): Contadores {
  const vivas = vistas.filter(v => v.estado !== 'inactiva')
  return {
    vivas: vivas.length,
    total: vistas.length,
    teEsperan: vistas.filter(v => v.estado === 'te_espera').length,
    leads: vivas.filter(v => v.estado === 'trabajando').length,
    subagentes: vivas.reduce((n, v) => n + v.agentes.filter(a => a.estado !== 'en_pausa').length, 0),
  }
}

// ---------------------------------------------------------------- uso

/** El uso más reciente que haya visto alguna sesión (o la propia torre). */
export function usoMasReciente(usos: readonly (Uso | null)[]): Uso | null {
  let mejor: Uso | null = null
  for (const u of usos) if (u && (mejor === null || ms(u.leido) > ms(mejor.leido))) mejor = u
  return mejor
}

// ---------------------------------------------------------------- actividad

export type Dia = { dia: string; turnos: number; commits: number | null }

/** Días seguidos con turnos o commits, terminando hoy (o ayer, si hoy aún no hay nada). */
export function racha(dias: readonly Dia[]): number {
  const activos = dias.map(d => d.turnos > 0 || (d.commits ?? 0) > 0)
  let i = activos.length - 1
  if (i >= 0 && !activos[i]) i -= 1
  let n = 0
  for (; i >= 0 && activos[i]; i--) n += 1
  return n
}

/** Nivel de Rex: empieza en 1 y sube uno cada 100 turnos acumulados. */
export function nivel(turnosTotales: number): number {
  return 1 + Math.floor(Math.max(0, turnosTotales) / 100)
}

// ---------------------------------------------------------------- Rex

export type EstadoRex = 'alerta' | 'celebrando' | 'trabajando' | 'durmiendo'

export type FichaPanel = Ficha & { pct: number | null; completadaHace: number | null }

/** La prioridad de §3.2: alerta > celebrando > trabajando > durmiendo. */
export function estadoRex(vistas: readonly SesionVista[], fichas: readonly FichaPanel[]): EstadoRex {
  if (vistas.some(v => v.estado === 'te_espera')) return 'alerta'
  if (fichas.some(f => f.pct === 100 && f.completadaHace !== null && f.completadaHace < 24 * 60)) return 'celebrando'
  if (vistas.some(v => v.estado === 'trabajando' || v.agentes.some(a => a.estado === 'trabajando'))) return 'trabajando'
  return 'durmiendo'
}

export function bocadillo(estado: EstadoRex, vistas: readonly SesionVista[], fichas: readonly FichaPanel[]): string {
  switch (estado) {
    case 'alerta': {
      const v = vistas.find(x => x.estado === 'te_espera')
      const quien = v ? (v.s.tipo === 'proyecto' ? (v.s.rama ?? v.s.proyecto) : v.s.proyecto) : 'alguien'
      const mas = vistas.filter(x => x.estado === 'te_espera').length - 1
      return mas > 0 ? `¡${quien} y ${mas} más te esperan!` : `¡${quien} te espera!`
    }
    case 'celebrando': {
      const f = fichas.find(x => x.pct === 100)
      return `¡${f?.carpeta ?? 'un proyecto'} al 100 %!`
    }
    case 'trabajando': {
      const n = contadores(vistas)
      const total = n.leads + n.subagentes
      return total === 1 ? '1 agente en marcha' : `${total} agentes en marcha`
    }
    case 'durmiendo':
      return 'zzz…'
  }
}

// ---------------------------------------------------------------- alertas

export type Alerta = { texto: string; nivel: 'aviso' | 'grave' }

/** Lo que las alertas usan de git (de /refresh). */
export type GitAlerta = { ahead: number; cambios: number; sucio_desde: string | null; ci?: 'ok' | 'fallo' | 'en_curso' | null }

const TRES_DIAS = 3 * 86_400_000

/** Las de git: commits sin push, cambios sin commitear hace más de 3 días y CI en rojo. */
export function alertasGit(git: Readonly<Record<string, GitAlerta>>, ahora: number): Alerta[] {
  const a: Alerta[] = []
  for (const [p, r] of Object.entries(git)) {
    if (r.ci === 'fallo') a.push({ texto: `${p}: CI en rojo`, nivel: 'grave' })
    if (r.ahead > 0) a.push({ texto: `${p}: ${r.ahead} commit${r.ahead === 1 ? '' : 's'} sin push`, nivel: 'aviso' })
    const desde = r.sucio_desde ? Date.parse(r.sucio_desde) : Number.NaN
    if (r.cambios > 0 && Number.isFinite(desde) && ahora - desde > TRES_DIAS) {
      a.push({ texto: `${p}: cambios sin commitear desde hace ${Math.floor((ahora - desde) / 86_400_000)} días`, nivel: 'aviso' })
    }
  }
  return a
}

/** Las alertas que no dependen de git. */
export function alertasBasicas(vistas: readonly SesionVista[], sinClasificar: number): Alerta[] {
  const a: Alerta[] = []
  for (const v of vistas) {
    if (v.estado === 'inactiva') continue
    const nombre = v.s.tipo === 'proyecto' ? (v.s.rama ?? v.s.proyecto) : v.s.proyecto
    if (v.s.contexto_pct !== null && v.s.contexto_pct >= 80) a.push({ texto: `${nombre}: contexto ${v.s.contexto_pct} %, compactar`, nivel: 'grave' })
    if (v.esperaMin !== null && v.esperaMin > 5) a.push({ texto: `${nombre}: te espera desde hace ${Math.round(v.esperaMin)} min`, nivel: 'aviso' })
  }
  if (sinClasificar > 0) a.push({ texto: `${sinClasificar} carpeta(s) sin clasificar en PROYECTOS.md`, nivel: 'aviso' })
  return a
}

/**
 * Siguiente acción por reglas si ESTADO.md no tiene (§2.5): primero las
 * sesiones que te esperan, luego las de contexto alto y después los commits sin push.
 */
export function accionesPorReglas(vistas: readonly SesionVista[], git: Readonly<Record<string, GitAlerta>> = {}): string[] {
  const r: string[] = []
  for (const v of vistas) if (v.estado === 'te_espera') r.push(`Atender ${v.etiqueta}: ${v.s.detalle}`)
  for (const v of vistas) {
    if (v.estado !== 'inactiva' && (v.s.contexto_pct ?? 0) >= 80) r.push(`Compactar ${v.etiqueta} (${v.s.contexto_pct} %)`)
  }
  for (const [p, g] of Object.entries(git)) if (g.ahead > 0) r.push(`Push en ${p} (${g.ahead} commit${g.ahead === 1 ? '' : 's'} sin subir)`)
  return r.slice(0, 3)
}
