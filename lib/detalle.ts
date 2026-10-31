// El «detalle» de una sesión o un agente: qué está haciendo, en pocas palabras.
// Privacidad (§2.6): de la entrada de una herramienta solo se guarda la ruta del
// fichero, la descripción de un subagente o, en Bash, el nombre del programa.
// Nunca el texto de un prompt, una respuesta o un comando entero.

import { dentroDe, normalizar } from './rutas.ts'

export const MAX_DETALLE = 60

export function recortar(texto: string, max = MAX_DETALLE): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** La ruta relativa a `cwd` si está dentro; si no, solo el nombre del fichero. */
export function rutaCorta(ruta: string, cwd: string): string {
  const n = normalizar(ruta)
  const base = normalizar(cwd)
  if (dentroDe(n, base) && n.length > base.length) return n.slice(base.length + 1)
  return n.slice(n.lastIndexOf('/') + 1)
}

/** El programa de una línea de Bash: el primero que no sea `cd`, `env` o una asignación. */
export function programaDeBash(comando: string): string {
  for (const trozo of comando.split(/&&|\|\||;|\||\n/)) {
    const palabras = trozo.trim().split(/\s+/).filter(p => p !== '' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(p))
    while (palabras[0] === 'env' || palabras[0] === 'sudo' || palabras[0] === 'time') palabras.shift()
    const p = palabras[0]
    if (p === undefined || p === 'cd' || p === 'pushd' || p === 'export') continue
    return p.slice(p.lastIndexOf('/') + 1).replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 20) || 'bash'
  }
  return 'bash'
}

/** Normaliza el `subagent_type` de un subagente: `Explore` → `explore`, `general-purpose` → `general`. */
export function tipoDeAgente(tipo: string | undefined): string {
  const t = (tipo ?? 'general-purpose').toLowerCase()
  const sinPlugin = t.slice(t.lastIndexOf(':') + 1)
  if (sinPlugin === 'general-purpose' || sinPlugin === '') return 'general'
  if (/test/.test(sinPlugin)) return 'tests'
  return sinPlugin.replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'general'
}

export function esHerramientaDeAgente(tool: string): boolean {
  return tool === 'Agent' || tool === 'Task'
}

/** Qué hace una llamada a una herramienta, sin datos privados. */
export function detalleDeHerramienta(tool: string, entrada: Record<string, unknown>, cwd: string): string {
  const ruta = texto(entrada.file_path) ?? texto(entrada.notebook_path) ?? texto(entrada.path)
  switch (tool) {
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return recortar(ruta ? `editando ${rutaCorta(ruta, cwd)}` : 'editando')
    case 'Read':
      return recortar(ruta ? `leyendo ${rutaCorta(ruta, cwd)}` : 'leyendo')
    case 'Bash':
      return `Bash · ${programaDeBash(texto(entrada.command) ?? '')}`
    case 'Agent':
    case 'Task':
      return recortar(`${tipoDeAgente(texto(entrada.subagent_type))}: ${texto(entrada.description) ?? 'subagente'}`)
    case 'AskUserQuestion':
      return 'pregunta'
    case 'TodoWrite':
      return 'actualizando tareas'
  }
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(tool)
  if (mcp) return recortar(`mcp ${mcp[1]} · ${mcp[2]}`)
  return recortar(tool)
}
