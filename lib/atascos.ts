// El detector de atascos: sesiones que parecen dar vueltas. Puro y por sesión:
// cada evento de la sesión llega como una «señal» y el detector devuelve su
// estado nuevo y, si lo hay, el atasco. Las tres reglas y sus umbrales:
//
// - comando: el mismo comando falla `comando_repeticiones` veces seguidas con
//   el mismo error (mismo `error_hash`).
// - fichero: el mismo fichero se edita `fichero_ediciones` veces en
//   `fichero_minutos` minutos sin un comando de tests en verde entre medias.
// - progreso: `sin_progreso_minutos` minutos trabajando sin tests en verde, sin
//   ficheros nuevos y sin commits.
//
// Un atasco se limpia con progreso: tests en verde, un commit o un comando que
// funciona y no es de solo mirar (para «sin progreso», un fichero nuevo; un
// comando cualquiera no basta, porque esa regla mide justo eso).

import type { EstadoNombre } from './estado.ts'

export type Umbrales = { comando_repeticiones: number; fichero_ediciones: number; fichero_minutos: number; sin_progreso_minutos: number }

export const UMBRALES_POR_DEFECTO: Umbrales = { comando_repeticiones: 3, fichero_ediciones: 5, fichero_minutos: 30, sin_progreso_minutos: 20 }

export type Regla = 'comando' | 'fichero' | 'progreso'

export type Atasco = {
  regla: Regla
  /** Identifica el atasco: la misma clave no vuelve a avisar. */
  clave: string
  /** ISO local: desde cuándo dura. */
  desde: string
  /** «mismo comando falla 4 veces seguidas». */
  motivo: string
  prueba: { comando?: string; error?: string; fichero?: string; tests?: string[]; texto?: string }
}

export type Senal =
  | { tipo: 'bash'; ms: number; comando: string; ok: boolean; hash: string | null; error: string | null; test: boolean; tests: string | null; commit: boolean; soloLectura: boolean }
  | { tipo: 'edit'; ms: number; fichero: string; nuevo: boolean }
  | { tipo: 'estado'; ms: number; estado: EstadoNombre }

type Racha = { hash: string; n: number; desde: number; error: string }

export type Detector = {
  /** Fallos seguidos de cada comando con el mismo error. */
  rachas: Record<string, Racha>
  /** Cuándo se editó cada fichero desde los últimos tests en verde. */
  ediciones: Record<string, number[]>
  /** Cómo van los tests desde el último verde: «41/48 ✗». */
  tests: string[]
  /** Tiempo trabajando desde el último avance (tests en verde, fichero nuevo o commit). */
  trabajo: { ms: number; desde: number | null; ultimo: number | null; estado: EstadoNombre }
  cuenta: { ediciones: number; comandos: number }
  atasco: (Atasco & { desdeMs: number }) | null
}

/** Un hueco entre eventos de más de esto no cuenta entero como trabajo (un comando largo, una sesión olvidada). */
const HUECO_MAX_MS = 10 * 60_000
const TESTS_GUARDADOS = 6

export function detectorVacio(): Detector {
  return { rachas: {}, ediciones: {}, tests: [], trabajo: { ms: 0, desde: null, ultimo: null, estado: 'en_pausa' }, cuenta: { ediciones: 0, comandos: 0 }, atasco: null }
}

export const PISTAS: Record<Regla, string> = {
  comando: 'Repite lo mismo esperando otro resultado. Revisa el error o dale una pista.',
  fichero: 'Da vueltas sobre el mismo fichero. Quizá conviene replantear el enfoque.',
  progreso: 'Lleva rato sin avanzar. Pregúntale qué le falta o divide la tarea.',
}

function sinAvance(d: Detector, ms: number): Detector {
  return { ...d, trabajo: { ...d.trabajo, ms: 0, desde: null }, cuenta: { ediciones: 0, comandos: 0 }, atasco: d.atasco?.regla === 'progreso' ? null : d.atasco }
}

/**
 * Aplica una señal. `iso` convierte ms en la hora local con la que se guarda
 * el atasco. Devuelve el detector nuevo; el atasco va en `atasco`.
 */
export function evaluar(previo: Detector, s: Senal, u: Umbrales, iso: (ms: number) => string): Detector {
  let d: Detector = { ...previo, rachas: { ...previo.rachas }, ediciones: { ...previo.ediciones }, tests: [...previo.tests], trabajo: { ...previo.trabajo }, cuenta: { ...previo.cuenta } }

  // El tiempo trabajando se cuenta entre eventos, solo mientras la sesión trabaja.
  const t = d.trabajo
  if (t.ultimo !== null && t.estado === 'trabajando' && s.ms > t.ultimo) {
    t.ms += Math.min(s.ms - t.ultimo, HUECO_MAX_MS)
    if (t.desde === null) t.desde = t.ultimo
  }
  t.ultimo = s.ms
  if (s.tipo === 'estado') t.estado = s.estado

  if (s.tipo === 'bash') {
    d.cuenta.comandos += 1
    if (s.ok) {
      delete d.rachas[s.comando]
      const verde = s.test
      if (verde) {
        d.ediciones = {}
        d.tests = []
      }
      if (verde || s.commit) d = sinAvance(d, s.ms)
      // Un comando que funciona (y no solo mira) limpia los bucles de comando y de fichero.
      if (d.atasco && d.atasco.regla !== 'progreso' && (verde || s.commit || !s.soloLectura)) {
        if (d.atasco.regla === 'comando') d.rachas = {}
        else d.ediciones = {}
        d.atasco = null
      }
    } else if (s.hash !== null) {
      const r = d.rachas[s.comando]
      d.rachas[s.comando] = r && r.hash === s.hash ? { ...r, n: r.n + 1, error: s.error ?? r.error } : { hash: s.hash, n: 1, desde: s.ms, error: s.error ?? '' }
    }
    if (!s.ok && s.test) d.tests = [...d.tests, s.tests ? `${s.tests} ✗` : '✗'].slice(-TESTS_GUARDADOS)
  }

  if (s.tipo === 'edit') {
    d.cuenta.ediciones += 1
    const ventana = s.ms - u.fichero_minutos * 60_000
    d.ediciones[s.fichero] = [...(d.ediciones[s.fichero] ?? []).filter(x => x >= ventana), s.ms]
    if (s.nuevo) d = sinAvance(d, s.ms)
  }

  // Detección, por orden de importancia. Un atasco sigue hasta que haya avance.
  const nuevo = detectar(d, s.ms, u, iso)
  if (nuevo && (d.atasco === null || nuevo.clave === d.atasco.clave || prioridad(nuevo.regla) < prioridad(d.atasco.regla))) {
    d.atasco = d.atasco && d.atasco.clave === nuevo.clave ? { ...nuevo, desde: d.atasco.desde, desdeMs: d.atasco.desdeMs } : nuevo
  }
  return d
}

function prioridad(r: Regla): number {
  return r === 'comando' ? 0 : r === 'fichero' ? 1 : 2
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`
}

function detectar(d: Detector, ms: number, u: Umbrales, iso: (ms: number) => string): (Atasco & { desdeMs: number }) | null {
  const racha = Object.entries(d.rachas)
    .filter(([, r]) => r.n >= u.comando_repeticiones)
    .sort((a, b) => b[1].n - a[1].n)[0]
  if (racha) {
    const [comando, r] = racha
    return {
      regla: 'comando',
      clave: `comando:${comando}:${r.hash}`,
      desde: iso(r.desde),
      desdeMs: r.desde,
      motivo: `mismo comando falla ${r.n} veces seguidas`,
      prueba: { comando, error: r.error },
    }
  }
  const ventana = ms - u.fichero_minutos * 60_000
  const fichero = Object.entries(d.ediciones)
    .map(([f, ts]) => [f, ts.filter(x => x >= ventana)] as const)
    .filter(([, ts]) => ts.length >= u.fichero_ediciones)
    .sort((a, b) => b[1].length - a[1].length)[0]
  if (fichero) {
    const [f, ts] = fichero
    return {
      regla: 'fichero',
      clave: `fichero:${f}`,
      desde: iso(ts[0]!),
      desdeMs: ts[0]!,
      motivo: `edita el mismo fichero ${ts.length} veces sin que pasen los tests`,
      prueba: { fichero: f, tests: d.tests },
    }
  }
  if (d.trabajo.ms >= u.sin_progreso_minutos * 60_000) {
    const desde = d.trabajo.desde ?? ms
    return {
      regla: 'progreso',
      clave: 'progreso',
      desde: iso(desde),
      desdeMs: desde,
      motivo: `${Math.round(d.trabajo.ms / 60_000)} min trabajando sin tests en verde, ficheros nuevos ni commits`,
      prueba: { texto: `${plural(d.cuenta.ediciones, 'edición', 'ediciones')} y ${plural(d.cuenta.comandos, 'comando', 'comandos')} desde el último avance` },
    }
  }
  return null
}

// ----------------------------------------------------------- ignorados

/** `.agentos/atascos-ignorados.json`: lo que ignoraste, hasta que la sesión cambie de tarea. */
export type Ignorado = { session_id: string; clave: string; tarea: number; ts: string }

export function interpretarIgnorados(texto: string): Ignorado[] {
  try {
    const v = JSON.parse(texto) as { ignorados?: unknown }
    if (!Array.isArray(v?.ignorados)) return []
    return v.ignorados.filter(
      (x): x is Ignorado => !!x && typeof x.session_id === 'string' && typeof x.clave === 'string' && typeof x.tarea === 'number' && typeof x.ts === 'string',
    )
  } catch {
    return []
  }
}

export function serializarIgnorados(lista: readonly Ignorado[]): string {
  return `${JSON.stringify({ ignorados: lista }, null, 2)}\n`
}

export function estaIgnorado(lista: readonly Ignorado[], sessionId: string, clave: string, tarea: number): boolean {
  return lista.some(i => i.session_id === sessionId && i.clave === clave && i.tarea === tarea)
}
