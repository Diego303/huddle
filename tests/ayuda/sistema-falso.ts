// Un sistema de ficheros, procesos y entorno en memoria para los tests: el kit
// de `claude plugin test` no tiene fs ni procesos, así que se responden aquí.

import type { On } from 'claude-code'

export type SistemaFalso = {
  ficheros: Map<string, string>
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

function plantilla(ruta: string): string | undefined {
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
    if (f !== undefined) return { value: { kind: 'file', size: f.length, mtimeMs: 0, isLink: false } }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('fs.list', (_, e) => {
    const base = e.path.replace(/\/$/, '')
    const nombres = new Map<string, 'file' | 'dir'>()
    for (const d of s.dirs) if (padre(d) === base) nombres.set(d.slice(base.length + 1), 'dir')
    for (const f of s.ficheros.keys()) if (padre(f) === base) nombres.set(f.slice(base.length + 1), 'file')
    return {
      value: [...nombres].map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })),
    }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    s.procesos.push(argv)
    const ok = { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
      return ok
    }
    if (argv[0] === 'rm') {
      for (const f of args.slice(1)) s.ficheros.delete(f)
      return ok
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
  on('command.register', (_, e) => ({ value: { command: e.name } }))
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
