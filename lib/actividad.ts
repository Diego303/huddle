// Turnos por día (§2.9 del plan). Cada sesión escribe su propio fichero en
// .agentos/actividad/<session_id>.json, para que dos sesiones nunca pisen el
// contador de la otra; /refresh los junta en actividad.json.

export const DIAS_GUARDADOS = 30

export type ActividadSesion = {
  session_id: string
  proyecto: string
  dias: Record<string, number>
  /** Tokens por hora local (`AAAA-MM-DDTHH`), solo para estimar el uso sin dato oficial. */
  tokens?: Record<string, number>
}

/** Cuántas horas de tokens se guardan (una semana y un día). */
export const HORAS_TOKENS = 8 * 24

export function actividadVacia(session_id: string, proyecto: string): ActividadSesion {
  return { session_id, proyecto, dias: {} }
}

export function sumarTurno(a: ActividadSesion, dia: string): ActividadSesion {
  return { ...a, dias: { ...a.dias, [dia]: (a.dias[dia] ?? 0) + 1 } }
}

export function sumarTokens(a: ActividadSesion, hora: string, n: number, desdeHora: string): ActividadSesion {
  if (!(n > 0)) return a
  const tokens: Record<string, number> = {}
  for (const [h, v] of Object.entries(a.tokens ?? {})) if (h >= desdeHora) tokens[h] = v
  tokens[hora] = (tokens[hora] ?? 0) + n
  return { ...a, tokens }
}

/** Quita los días anteriores a `desde` (formato AAAA-MM-DD, que se ordena como texto). */
export function podar(a: ActividadSesion, desde: string): ActividadSesion {
  return { ...a, dias: Object.fromEntries(Object.entries(a.dias).filter(([d]) => d >= desde)) }
}

function horas(v: unknown): Record<string, number> {
  const r: Record<string, number> = {}
  if (v && typeof v === 'object') for (const [h, n] of Object.entries(v)) if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(h) && typeof n === 'number' && n > 0) r[h] = n
  return r
}

export function interpretarActividad(json: string): ActividadSesion | null {
  try {
    const v = JSON.parse(json) as Partial<ActividadSesion>
    if (typeof v.session_id !== 'string' || typeof v.proyecto !== 'string' || typeof v.dias !== 'object' || v.dias === null) {
      return null
    }
    const dias: Record<string, number> = {}
    for (const [d, n] of Object.entries(v.dias)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof n === 'number' && n > 0) dias[d] = n
    const tokens = horas(v.tokens)
    return Object.keys(tokens).length > 0 ? { session_id: v.session_id, proyecto: v.proyecto, dias, tokens } : { session_id: v.session_id, proyecto: v.proyecto, dias }
  } catch {
    return null
  }
}

/** `.agentos/actividad.json`: lo que /refresh junta de las sesiones ya cerradas. */
export type ActividadTotal = { dias: Record<string, Record<string, number>>; total: number; tokens?: Record<string, number> }

export function actividadTotalVacia(): ActividadTotal {
  return { dias: {}, total: 0 }
}

export function interpretarActividadTotal(json: string): ActividadTotal | null {
  try {
    const v = JSON.parse(json) as Partial<ActividadTotal>
    if (typeof v.dias !== 'object' || v.dias === null || typeof v.total !== 'number') return null
    const tokens = horas(v.tokens)
    return Object.keys(tokens).length > 0 ? { dias: v.dias as ActividadTotal['dias'], total: v.total, tokens } : { dias: v.dias as ActividadTotal['dias'], total: v.total }
  } catch {
    return null
  }
}

/** Suma una sesión cerrada al total y quita los días anteriores a `desde` (el total se conserva). */
export function juntar(total: ActividadTotal, sesion: ActividadSesion, desde: string, desdeHora = ''): ActividadTotal {
  const dias: ActividadTotal['dias'] = {}
  for (const [d, p] of Object.entries(total.dias)) if (d >= desde) dias[d] = { ...p }
  let suma = 0
  for (const [d, n] of Object.entries(sesion.dias)) {
    suma += n
    if (d < desde) continue
    const p = (dias[d] ??= {})
    p[sesion.proyecto] = (p[sesion.proyecto] ?? 0) + n
  }
  const tokens: Record<string, number> = {}
  for (const fuente of [total.tokens ?? {}, sesion.tokens ?? {}]) for (const [h, n] of Object.entries(fuente)) if (h >= desdeHora) tokens[h] = (tokens[h] ?? 0) + n
  return Object.keys(tokens).length > 0 ? { dias, total: total.total + suma, tokens } : { dias, total: total.total + suma }
}

/** Turnos de un día en el total (todas las sesiones cerradas). */
export function turnosDelDia(total: ActividadTotal, dia: string): number {
  return Object.values(total.dias[dia] ?? {}).reduce((a, b) => a + b, 0)
}
