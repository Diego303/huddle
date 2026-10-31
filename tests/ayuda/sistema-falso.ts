// Un sistema de ficheros, procesos y entorno en memoria para los tests: el kit
// de `claude plugin test` no tiene fs ni procesos, así que se responden aquí.

import type { On } from 'claude-code'

export type SistemaFalso = {
  ficheros: Map<string, string>
  /** Fecha de modificación de cada fichero (sube con cada escritura). */
  mtimes: Map<string, number>
  dirs: Set<string>
  /** Cada ruta que el mod ha leído o abierto (fs.read, fs.exists, fs.stat, head). */
  tocadas: string[]
  procesos: string[][]
  env: Record<string, string>
  cwd: string
  respuestaAsk: string | null
  /** Las preguntas que el mod ha hecho con $.ui.ask. */
  preguntas: string[]
  /** Los procesos lanzados en segundo plano ($.process.spawn): los avisos. */
  lanzados: string[][]
  /** Si es true, toda escritura falla (para comprobar que Huddle no rompe nada). */
  discoRoto: boolean
  /** Mientras exista, cada escritura espera a que se resuelva (para provocar carreras). */
  pausa: Promise<void> | null
  sesion: { id: string; repo: string | null; uso: unknown; agentes: unknown[] }
  /** Respuestas a otros procesos (git, claude…): si devuelve algo, gana. */
  responder: ((argv: string[], cwd: string | undefined) => { exitCode?: number; stdout?: string; stderr?: string } | undefined) | null
  /** Con qué cwd se lanzó cada proceso de `procesos`. */
  cwds: (string | undefined)[]
  /** Los comandos que ha registrado el mod. */
  comandos: string[]
}

/** Plantillas de prueba: cualquier lectura bajo .../templates/GENERAL/ se responde con esto. */
export const PLANTILLAS: Record<string, string> = {
  'ESTADO.md': '# Estado general\n\n## Hoy\n',
  'PROYECTOS.md':
    '# Proyectos\nRaíz: {{raiz}}\n\nTexto de ayuda.\n\n## Hacer seguimiento\n\n## No hacer seguimiento\n\n## Sin clasificar\n',
  'proyectos/_plantilla.md': '---\ncodigo: {{codigo}}\nfase:\n---\n# {{nombre}}\nObjetivo: {{objetivo}}\n\n## Tareas\n',
}

function padre(ruta: string): string {
  const i = ruta.lastIndexOf('/')
  return i <= 0 ? '/' : ruta.slice(0, i)
}

function anotarDirs(s: SistemaFalso, ruta: string): void {
  for (let d = padre(ruta); d !== '/' && !s.dirs.has(d); d = padre(d)) s.dirs.add(d)
}

/** La plantilla de la web, cuando se lee del mod. */
export const DASHBOARD = '<!DOCTYPE html><title>huddle</title>'

function plantilla(ruta: string): string | undefined {
  if (ruta.endsWith('/web/dashboard.html') && !ruta.includes('/.agentos/')) return DASHBOARD
  const i = ruta.indexOf('/templates/GENERAL/')
  return i < 0 ? undefined : PLANTILLAS[ruta.slice(i + '/templates/GENERAL/'.length)]
}

export function crearSistema(inicial: {
  ficheros?: Record<string, string>
  dirs?: string[]
  env?: Record<string, string>
  cwd: string
  respuestaAsk?: string | null
}): SistemaFalso {
  const s: SistemaFalso = {
    ficheros: new Map(Object.entries(inicial.ficheros ?? {})),
    mtimes: new Map(),
    dirs: new Set(),
    tocadas: [],
    procesos: [],
    env: { HOME: '/home/usuario', HUDDLE_CONFIG: '/home/usuario/.config/huddle/config.json', ...inicial.env },
    cwd: inicial.cwd,
    respuestaAsk: inicial.respuestaAsk ?? null,
    preguntas: [],
    lanzados: [],
    discoRoto: false,
    pausa: null,
    responder: null,
    cwds: [],
    comandos: [],
    sesion: { id: 'sesion-1', repo: null, uso: { startedAt: 0, context: { window: 1000000 }, rateLimits: [] }, agentes: [] },
  }
  for (const f of s.ficheros.keys()) anotarDirs(s, f)
  for (const d of inicial.dirs ?? []) {
    s.dirs.add(d)
    anotarDirs(s, d)
  }
  s.dirs.add(s.cwd)
  return s
}

let reloj = 1

export function instalarSistema(on: On, s: SistemaFalso): void {
  on('fs.read', (_, e) => {
    s.tocadas.push(e.path)
    const texto = s.ficheros.get(e.path) ?? plantilla(e.path)
    return texto === undefined ? { deny: `ENOENT: ${e.path}` } : { value: texto }
  })
  on('fs.write', async (_, e) => {
    if (s.pausa) await s.pausa
    if (s.discoRoto) return { deny: 'EIO: disco roto' }
    s.ficheros.set(e.path, e.text)
    s.mtimes.set(e.path, ++reloj)
    anotarDirs(s, e.path)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => {
    s.tocadas.push(e.path)
    return { value: s.ficheros.has(e.path) || s.dirs.has(e.path) }
  })
  on('fs.stat', (_, e) => {
    s.tocadas.push(e.path)
    if (s.dirs.has(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    const f = s.ficheros.get(e.path)
    if (f !== undefined) return { value: { kind: 'file', size: f.length, mtimeMs: s.mtimes.get(e.path) ?? 0, isLink: false } }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', (_, e) => {
    const base = e.path.replace(/\/$/, '')
    const nombres = new Map<string, 'file' | 'dir'>()
    for (const d of s.dirs) if (padre(d) === base) nombres.set(d.slice(base.length + 1), 'dir')
    for (const f of s.ficheros.keys()) if (padre(f) === base) nombres.set(f.slice(base.length + 1), 'file')
    return {
      value: [...nombres].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: s.mtimes.get(`${base}/${name}`) ?? 0, isLink: false })),
    }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    s.procesos.push(argv)
    s.cwds.push(e.init?.cwd)
    const ok = { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const propia = s.responder?.(argv, e.init?.cwd)
    if (propia) return { value: { ...ok.value, ...propia } }
    const args = argv.filter(a => a !== '--' && !a.startsWith('-'))
    if (argv[0] === 'date') return { value: { ...ok.value, stdout: '+0100\n' } }
    if (argv[0] === 'uname') return { value: { ...ok.value, stdout: 'Linux\n' } }
    if (argv[0] === 'mkdir') {
      for (const d of args.slice(1)) {
        s.dirs.add(d)
        anotarDirs(s, d)
      }
      return ok
    }
    if (argv[0] === 'mv') {
      const [, de, a] = args
      const texto = de === undefined ? undefined : s.ficheros.get(de)
      if (de === undefined || a === undefined || texto === undefined) return { value: { ...ok.value, exitCode: 1 } }
      s.ficheros.delete(de)
      s.ficheros.set(a, texto)
      s.mtimes.set(a, ++reloj)
      return ok
    }
    if (argv[0] === 'rm') {
      for (const f of args.slice(1)) {
        s.ficheros.delete(f)
        // rm -rf de una carpeta: todo lo que cuelga de ella.
        for (const g of [...s.ficheros.keys()]) if (g.startsWith(`${f}/`)) s.ficheros.delete(g)
        for (const d of [...s.dirs]) if (d === f || d.startsWith(`${f}/`)) s.dirs.delete(d)
      }
      return ok
    }
    // `sh -c '… cat >> "$1"'`: añadir al final (bitácora, tramos); `tail -c +N | head -c M`: leer desde un punto.
    if (argv[0] === 'sh' && argv[1] === '-c') {
      const guion = argv[2] ?? ''
      const ruta = argv[4] ?? ''
      if (guion.includes('cat >>')) {
        if (s.discoRoto) return { value: { ...ok.value, exitCode: 1 } }
        s.ficheros.set(ruta, (s.ficheros.get(ruta) ?? '') + (e.init?.stdin ?? ''))
        s.mtimes.set(ruta, ++reloj)
        anotarDirs(s, ruta)
        return ok
      }
      if (guion.includes('tail -c')) {
        s.tocadas.push(ruta)
        const texto = s.ficheros.get(ruta)
        if (texto === undefined) return { value: { ...ok.value, exitCode: 1 } }
        const desde = Number(argv[5]) - 1
        return { value: { ...ok.value, stdout: texto.slice(desde, desde + Number(argv[6])) } }
      }
    }
    if (argv[0] === 'head') {
      const n = Number(argv[2])
      const ruta = argv[argv.length - 1]!
      s.tocadas.push(ruta)
      const texto = s.ficheros.get(ruta)
      if (texto === undefined) return { value: { ...ok.value, exitCode: 1 } }
      return { value: { ...ok.value, stdout: texto.split('\n').slice(0, n).join('\n') } }
    }
    return { value: { ...ok.value, exitCode: 127, stderr: `${argv[0]}: no disponible en el test` } }
  })
  on('env.get', (_, e) => ({ value: s.env[e.name] }))
  on('session.cwd', () => ({ value: s.cwd }))
  // $.ui.ask es una llamada a la herramienta AskUserQuestion.
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    s.preguntas.push(e.questions.map(q => q.question).join(' | '))
    if (s.respuestaAsk === null) return { deny: 'nadie a quien preguntar' }
    const pregunta = e.questions[0]?.question ?? ''
    return { result: { questions: e.questions, answers: { [pregunta]: s.respuestaAsk } } }
  })
  on('command.register', (_, e) => {
    if (!s.comandos.includes(e.name)) s.comandos.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.id', () => ({ value: s.sesion.id }))
  on('session.repo', () => ({
    value: s.sesion.repo === null ? null : { root: s.sesion.repo, remote: null, internal: false, name: null },
  }))
  on('session.usage', () => ({ value: s.sesion.uso as never }))
  on('agent.list', () => ({ value: s.sesion.agentes as never }))
  on('process.spawn', async function* (_, e) {
    s.lanzados.push([...e.argv])
    return { value: { code: 0, signal: null } }
  })
}
