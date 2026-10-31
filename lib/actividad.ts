// Turnos por día (§2.9 del plan). Cada sesión escribe su propio fichero en
// .agentos/actividad/<session_id>.json, para que dos sesiones nunca pisen el
// contador de la otra; /refresh los junta en actividad.json.

export const DIAS_GUARDADOS = 30

export type ActividadSesion = {
  session_id: string
  proyecto: string
  dias: Record<string, number>
}

export function actividadVacia(session_id: string, proyecto: string): ActividadSesion {
  return { session_id, proyecto, dias: {} }
}

export function sumarTurno(a: ActividadSesion, dia: string): ActividadSesion {
  return { ...a, dias: { ...a.dias, [dia]: (a.dias[dia] ?? 0) + 1 } }
}

/** Quita los días anteriores a `desde` (formato AAAA-MM-DD, que se ordena como texto). */
export function podar(a: ActividadSesion, desde: string): ActividadSesion {
  return { ...a, dias: Object.fromEntries(Object.entries(a.dias).filter(([d]) => d >= desde)) }
}

export function interpretarActividad(json: string): ActividadSesion | null {
  try {
    const v = JSON.parse(json) as Partial<ActividadSesion>
    if (typeof v.session_id !== 'string' || typeof v.proyecto !== 'string' || typeof v.dias !== 'object' || v.dias === null) {
      return null
    }
    const dias: Record<string, number> = {}
    for (const [d, n] of Object.entries(v.dias)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof n === 'number' && n > 0) dias[d] = n
    return { session_id: v.session_id, proyecto: v.proyecto, dias }
  } catch {
    return null
  }
}
