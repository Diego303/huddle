// Los tramos del día: cada cambio de estado visible de una sesión añade una
// línea a .agentos/tramos/<AAAA-MM-DD>.jsonl. De aquí salen el cronograma de la
// web y las métricas de espera. Todo puro.

export type EstadoTramo = 'trabajando' | 'te_espera' | 'en_pausa' | 'inactiva' | 'atascada' | 'cerrada'

export type LineaTramo = {
  ts: string
  session_id: string
  estado: EstadoTramo
  /** Para el cronograma de sesiones ya cerradas: `struo · feat-auth`. */
  nombre?: string
  proyecto?: string
}

const ESTADOS = new Set<string>(['trabajando', 'te_espera', 'en_pausa', 'inactiva', 'atascada', 'cerrada'])

export function serializarTramo(l: LineaTramo): string {
  return `${JSON.stringify(l)}\n`
}

export function interpretarTramos(texto: string): LineaTramo[] {
  const out: LineaTramo[] = []
  for (const l of texto.split('\n')) {
    if (l.trim() === '') continue
    try {
      const v = JSON.parse(l) as LineaTramo
      if (v && typeof v.ts === 'string' && typeof v.session_id === 'string' && ESTADOS.has(v.estado) && Number.isFinite(Date.parse(v.ts))) out.push(v)
    } catch {
      // línea rota: fuera
    }
  }
  return out
}

/** Un tramo dibujable: los de `inactiva` y `cerrada` son huecos. */
export type Segmento = { desde: number; hasta: number; estado: 'trabajando' | 'te_espera' | 'en_pausa' | 'atascada'; abierto: boolean }
export type FilaTramos = { session_id: string; nombre: string; proyecto: string; segmentos: Segmento[] }

/**
 * Los tramos de cada sesión, en ms. El último de una sesión viva llega hasta
 * `ahora`; el de una que ya no está (y no dejó «cerrada») se corta a los
 * `topeMin` minutos, para no inventarse horas de trabajo.
 */
export function segmentosPorSesion(lineas: readonly LineaTramo[], ahora: number, vivas: ReadonlySet<string>, topeMin: number): FilaTramos[] {
  const porSesion = new Map<string, LineaTramo[]>()
  for (const l of [...lineas].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    if (!porSesion.has(l.session_id)) porSesion.set(l.session_id, [])
    porSesion.get(l.session_id)!.push(l)
  }
  const filas: FilaTramos[] = []
  for (const [id, ls] of porSesion) {
    const segmentos: Segmento[] = []
    ls.forEach((l, i) => {
      const desde = Date.parse(l.ts)
      const sig = ls[i + 1]
      const abierto = sig === undefined
      let hasta = sig ? Date.parse(sig.ts) : vivas.has(id) ? ahora : Math.min(ahora, desde + topeMin * 60_000)
      hasta = Math.max(desde, Math.min(hasta, ahora))
      if (l.estado === 'inactiva' || l.estado === 'cerrada' || hasta <= desde) return
      const previo = segmentos[segmentos.length - 1]
      if (previo && previo.estado === l.estado && previo.hasta === desde) previo.hasta = hasta
      else segmentos.push({ desde, hasta, estado: l.estado, abierto: abierto && vivas.has(id) })
    })
    if (segmentos.length === 0) continue
    const conNombre = [...ls].reverse().find(l => l.nombre)
    filas.push({ session_id: id, nombre: conNombre?.nombre ?? id.slice(0, 8), proyecto: conNombre?.proyecto ?? '', segmentos })
  }
  return filas.sort((a, b) => a.segmentos[0]!.desde - b.segmentos[0]!.desde)
}

export type MetricasEspera = { minutos: number; esperas: number; media: number | null; maxima: { minutos: number; nombre: string } | null }

/** Cuánto te han esperado: el total, la media por espera y la más larga (con su sesión). */
export function metricasEspera(filas: readonly FilaTramos[]): MetricasEspera {
  let total = 0
  let esperas = 0
  let maxima: MetricasEspera['maxima'] = null
  for (const f of filas) {
    for (const s of f.segmentos) {
      if (s.estado !== 'te_espera') continue
      const min = (s.hasta - s.desde) / 60_000
      total += min
      esperas += 1
      if (maxima === null || min > maxima.minutos) maxima = { minutos: min, nombre: f.nombre }
    }
  }
  return { minutos: total, esperas, media: esperas === 0 ? null : total / esperas, maxima }
}
