// La bitácora de cada sesión: una línea JSON por evento en
// .agentos/bitacora/<AAAA-MM-DD>/<session_id>.jsonl. Todo puro: aquí se decide
// qué se guarda y cómo; sesion.ts lo escribe agrupado, fuera de los hooks.
//
// Privacidad: nunca el texto de un prompt ni una respuesta. De Bash se guarda
// el comando, con los secretos enmascarados, y la primera línea del error.

import { programaDeBash, rutaCorta } from './detalle.ts'
import { huella } from './huella.ts'

export type TipoBitacora = 'edit' | 'bash' | 'sub' | 'perm' | 'pregunta' | 'start' | 'end'

export type LineaBitacora = {
  ts: string
  tipo: TipoBitacora
  resumen: string
  fichero?: string
  mas?: number
  menos?: number
  ok?: boolean
  error_hash?: string
}

export const MAX_RESUMEN = 120
/** Días que se guardan; los más antiguos se borran al arrancar una sesión. */
export const DIAS_BITACORA = 7

export function truncar(texto: string, max = MAX_RESUMEN): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// ------------------------------------------------------------------ secretos

const FLAGS_SECRETAS = 'password|passwd|pass|pwd|token|access-token|auth-token|api-key|apikey|api_key|secret|client-secret|private-key'
const NOMBRES_SECRETOS = 'TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|_KEY|KEY_'

/**
 * Enmascara lo que parezca un secreto en un comando o un mensaje: cabeceras
 * `Authorization`, credenciales en URLs, `--password x`, variables como
 * `TOKEN=…` y cadenas de más de 24 caracteres alfanuméricos seguidos.
 */
export function enmascarar(texto: string): string {
  return texto
    .replace(/(authorization\s*:\s*)(?:(bearer|basic|token)\s+)?[^'"\n]+/gi, (_, cab: string, tipo?: string) => `${cab}${tipo ? `${tipo} ` : ''}***`)
    .replace(/(\/\/[^/\s:@'"]+:)[^@\s/'"]+@/g, '$1***@')
    .replace(new RegExp(`(--(?:${FLAGS_SECRETAS}))(=|\\s+)("[^"]*"|'[^']*'|[^\\s'"]+)`, 'gi'), '$1$2***')
    .replace(new RegExp(`\\b([A-Za-z0-9_]*(?:${NOMBRES_SECRETOS})[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\\s'"]+)`, 'gi'), '$1=***')
    .replace(/[A-Za-z0-9]{25,}/g, '***')
}

// ------------------------------------------------------------------- errores

/** La línea que mejor cuenta el error: la primera que lo diga, o la primera que haya. */
export function primeraLineaError(texto: string): string {
  const lineas = texto
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l !== '' && !/^exit code -?\d+$/i.test(l))
  const conError = lineas.find(l => /error|fail|fatal|cannot|can't|not found|no such|denied|exception|refused|✗|✖/i.test(l))
  return enmascarar(truncar(conError ?? lineas[0] ?? 'error', 160))
}

/** El error sin lo que cambia de una vez a otra: rutas absolutas y números. */
export function normalizarError(linea: string): string {
  return linea
    .toLowerCase()
    .replace(/(^|[\s'"`(=:])(?:[a-z]:)?[\\/][^\s'"`():,]*/g, '$1<ruta>')
    .replace(/0x[0-9a-f]+/g, '<n>')
    .replace(/\d+(?:[.,]\d+)*/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hashError(linea: string): string {
  return huella(normalizarError(linea))
}

// --------------------------------------------------------- tipos de comando

const SOLO_LECTURA = new Set([
  'ls', 'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'find', 'fd', 'pwd', 'echo', 'printf',
  'which', 'whereis', 'type', 'wc', 'stat', 'file', 'tree', 'du', 'df', 'date', 'whoami', 'env', 'true', 'sleep', 'sed',
  'awk', 'jq', 'diff', 'cmp', 'realpath', 'dirname', 'basename', 'readlink', 'nl', 'sort', 'uniq', 'cut', 'tr', 'column',
  'xxd', 'od', 'id', 'uname', 'hostname', 'ps',
])
const GIT_LECTURA = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'remote', 'blame', 'grep', 'describe', 'reflog', 'shortlog'])

function subcomandoGit(comando: string): string | null {
  const m = /\bgit\s+(?:-C\s+\S+\s+|--no-pager\s+|-c\s+\S+\s+)*([a-z-]+)/.exec(comando)
  return m ? m[1]! : null
}

/** Un comando que solo mira: si funciona, no cuenta como avance. */
export function esSoloLectura(comando: string): boolean {
  const p = programaDeBash(comando)
  if (p === 'git') {
    const sub = subcomandoGit(comando)
    return sub !== null && GIT_LECTURA.has(sub)
  }
  return SOLO_LECTURA.has(p)
}

const NO_SON_TESTS = new Set(['git', 'echo', 'printf', 'cat', 'grep', 'rg', 'ls', 'find', 'head', 'tail', 'sed', 'awk', 'cd', 'mkdir', 'touch'])

/** Un comando que ejecuta tests (pnpm test, vitest, pytest, go test, cargo test…). */
export function esTest(comando: string): boolean {
  if (NO_SON_TESTS.has(programaDeBash(comando))) return false
  return (
    /(^|[\s/:])(test|tests|jest|vitest|pytest|mocha|ava|rspec|phpunit|ctest|unittest)(?=$|[\s:.,;&|)])/i.test(comando) ||
    /(^|\s)--test\b/.test(comando) ||
    /\b(?:npm|pnpm|yarn|bun)\s+t(?=$|\s)/.test(comando)
  )
}

export function esCommit(comando: string): boolean {
  return subcomandoGit(comando) === 'commit'
}

/** El resumen de tests de la salida («41 passed, 7 failed», «129 pass / 1 fail»…): `41/48`. */
export function resumenTests(salida: string): { pasan: number; total: number } | null {
  const ultimo = (re: RegExp) => {
    let n: number | null = null
    for (const m of salida.matchAll(re)) n = Number(m[1])
    return n
  }
  const pasan = ultimo(/(\d+)\s+(?:tests?\s+)?(?:passed|passing|pass)\b/gi)
  const fallan = ultimo(/(\d+)\s+(?:tests?\s+)?(?:failed|failing|fail)\b/gi)
  if (pasan === null && fallan === null) return null
  const total = ultimo(/(\d+)\s+total\b/gi) ?? (pasan ?? 0) + (fallan ?? 0)
  return { pasan: pasan ?? Math.max(0, total - (fallan ?? 0)), total }
}

// ---------------------------------------------------------- las líneas

/** Las líneas añadidas y quitadas de un `structuredPatch` (Edit, Write, MultiEdit). */
export function contarCambios(patch: unknown): { mas: number; menos: number } | null {
  if (!Array.isArray(patch)) return null
  let mas = 0
  let menos = 0
  for (const trozo of patch) {
    const lineas = (trozo as { lines?: unknown })?.lines
    if (!Array.isArray(lineas)) continue
    for (const l of lineas) {
      if (typeof l !== 'string') continue
      if (l.startsWith('+')) mas += 1
      else if (l.startsWith('-')) menos += 1
    }
  }
  return { mas, menos }
}

export function lineaEdicion(ts: string, ruta: string, cwd: string, cambios: { mas: number; menos: number } | null, ok: boolean, nuevo: boolean, quien = ''): LineaBitacora {
  const fichero = rutaCorta(ruta, cwd)
  const cifras = cambios ? ` (+${cambios.mas} −${cambios.menos})` : ''
  return {
    ts,
    tipo: 'edit',
    resumen: truncar(`${quien}${fichero}${cifras}${nuevo ? ' · nuevo' : ''}${ok ? '' : ' · ✗ no se aplicó'}`),
    fichero,
    ...(cambios ? { mas: cambios.mas, menos: cambios.menos } : {}),
    ok,
  }
}

export function lineaBash(ts: string, comando: string, ok: boolean, error: string | null, tests: { pasan: number; total: number } | null, quien = ''): LineaBitacora {
  const cmd = enmascarar(comando.replace(/\s+/g, ' ').trim())
  const cifras = tests ? ` · ${tests.pasan}/${tests.total}` : ''
  const fin = ok ? `${cifras} ✓` : `${cifras} ✗${error ? ` ${error}` : ''}`
  return {
    ts,
    tipo: 'bash',
    resumen: truncar(`${quien}${cmd}${fin}`),
    ok,
    ...(ok || error === null ? {} : { error_hash: hashError(error) }),
  }
}

export function lineaSubagente(ts: string, tipo: string, descripcion: string, minutos: number | null): LineaBitacora {
  const dura = minutos === null ? '' : minutos < 1 ? ' · <1 min' : ` · ${Math.round(minutos)} min`
  return { ts, tipo: 'sub', resumen: truncar(`${tipo} · «${descripcion}»${dura}`) }
}

export function lineaAviso(ts: string, tipo: 'perm' | 'pregunta', mensaje: string, detalle: string | null): LineaBitacora {
  return { ts, tipo, resumen: truncar(enmascarar(`${mensaje}${detalle ? ` · ${detalle}` : ''}`)) }
}

export function lineaSesion(ts: string, tipo: 'start' | 'end', nombre: string, motivo = ''): LineaBitacora {
  return { ts, tipo, resumen: truncar(tipo === 'start' ? `sesión iniciada · ${nombre}` : `sesión cerrada · ${nombre}${motivo ? ` (${motivo})` : ''}`) }
}

export function serializarLinea(l: LineaBitacora): string {
  return `${JSON.stringify(l)}\n`
}

const TIPOS = new Set<string>(['edit', 'bash', 'sub', 'perm', 'pregunta', 'start', 'end'])

/** Las líneas válidas de un .jsonl (una a medio escribir se ignora). */
export function interpretarBitacora(texto: string): LineaBitacora[] {
  const out: LineaBitacora[] = []
  for (const l of texto.split('\n')) {
    if (l.trim() === '') continue
    try {
      const v = JSON.parse(l) as LineaBitacora
      if (v && typeof v.ts === 'string' && TIPOS.has(v.tipo) && typeof v.resumen === 'string') out.push(v)
    } catch {
      // línea rota: fuera
    }
  }
  return out
}

/** Los días (carpetas `AAAA-MM-DD` o ficheros `AAAA-MM-DD.jsonl`) más antiguos que `desde`. */
export function diasViejos(nombres: readonly string[], desde: string): string[] {
  return nombres.filter(n => /^\d{4}-\d{2}-\d{2}(\.jsonl)?$/.test(n) && n.slice(0, 10) < desde)
}
