// Turnos por día (§2.9 del plan). Cada sesión escribe su propio fichero en
// .agentos/actividad/<session_id>.json, para que dos sesiones nunca pisen el
// contador de la otra; /refresh los junta en actividad.json.

export const DIAS_GUARDADOS = 30

export type ActividadSesion = {
  session_id: string
  proyecto: string
  dias: Record<string, number>
  /** Tokens por hora local (`AAAA-MM-DDTHH`), de los transcripts: el uso por proyecto y el `≈` sin dato oficial. */
  tokens?: Record<string, number>
  /** Hasta dónde se ha leído cada transcript (bytes) y el último mensaje contado. */
  transcripts?: Record<string, { offset: number; ultimo: string | null }>
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
  return sumarHoras(a, { [hora]: n }, desdeHora)
}

/** Suma tokens por hora y quita las horas anteriores a `desdeHora`. */
export function sumarHoras(a: ActividadSesion, porHora: Readonly<Record<string, number>>, desdeHora: string): ActividadSesion {
  const tokens: Record<string, number> = {}
  for (const [h, v] of Object.entries(a.tokens ?? {})) if (h >= desdeHora) tokens[h] = v
  let algo = false
  for (const [h, n] of Object.entries(porHora)) {
    if (!(n > 0) || h < desdeHora) continue
    tokens[h] = (tokens[h] ?? 0) + n
    algo = true
  }
  return algo || Object.keys(tokens).length !== Object.keys(a.tokens ?? {}).length ? { ...a, tokens } : a
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
    const transcripts: NonNullable<ActividadSesion['transcripts']> = {}
    if (v.transcripts && typeof v.transcripts === 'object') {
      for (const [f, t] of Object.entries(v.transcripts)) {
        if (t && typeof t.offset === 'number' && t.offset >= 0) transcripts[f] = { offset: t.offset, ultimo: typeof t.ultimo === 'string' ? t.ultimo : null }
      }
    }
    return {
      session_id: v.session_id,
      proyecto: v.proyecto,
      dias,
      ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
      ...(Object.keys(transcripts).length > 0 ? { transcripts } : {}),
    }
  } catch {
    return null
  }
}

/** `.agentos/actividad.json`: lo que /refresh junta de las sesiones ya cerradas. */
export type ActividadTotal = {
  dias: Record<string, Record<string, number>>
  total: number
  tokens?: Record<string, number>
  /** Los mismos tokens por proyecto: proyecto → hora → tokens. */
  tokensProyecto?: Record<string, Record<string, number>>
}

export function actividadTotalVacia(): ActividadTotal {
  return { dias: {}, total: 0 }
}

export function interpretarActividadTotal(json: string): ActividadTotal | null {
  try {
    const v = JSON.parse(json) as Partial<ActividadTotal>
    if (typeof v.dias !== 'object' || v.dias === null || typeof v.total !== 'number') return null
    const tokens = horas(v.tokens)
    const porProyecto: Record<string, Record<string, number>> = {}
    if (v.tokensProyecto && typeof v.tokensProyecto === 'object') {
      for (const [p, h] of Object.entries(v.tokensProyecto)) {
        const hs = horas(h)
        if (Object.keys(hs).length > 0) porProyecto[p] = hs
      }
    }
    return {
      dias: v.dias as ActividadTotal['dias'],
      total: v.total,
      ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
      ...(Object.keys(porProyecto).length > 0 ? { tokensProyecto: porProyecto } : {}),
    }
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
  const porProyecto: Record<string, Record<string, number>> = {}
  for (const [p, hs] of Object.entries(total.tokensProyecto ?? {})) {
    for (const [h, n] of Object.entries(hs)) if (h >= desdeHora) (porProyecto[p] ??= {})[h] = n
  }
  for (const [h, n] of Object.entries(sesion.tokens ?? {})) {
    if (h < desdeHora) continue
    const p = (porProyecto[sesion.proyecto] ??= {})
    p[h] = (p[h] ?? 0) + n
  }
  return {
    dias,
    total: total.total + suma,
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
    ...(Object.keys(porProyecto).length > 0 ? { tokensProyecto: porProyecto } : {}),
  }
}

/** Turnos de un día en el total (todas las sesiones cerradas). */
export function turnosDelDia(total: ActividadTotal, dia: string): number {
  return Object.values(total.dias[dia] ?? {}).reduce((a, b) => a + b, 0)
}
