// Ficheros a través del motor. `$.fs` no tiene rename ni delete, así que la
// escritura atómica y el borrado pasan por `mv` y `rm` (§2.6 de las notas).

import type { EngineInterface } from 'claude-code'

import { padre, unir } from './rutas.ts'

export async function leerTexto($: EngineInterface, ruta: string): Promise<string | undefined> {
  try {
    return await $.fs.read(ruta)
  } catch {
    return undefined
  }
}

export async function existe($: EngineInterface, ruta: string): Promise<boolean> {
  try {
    return await $.fs.exists(ruta)
  } catch {
    return false
  }
}

export async function esDirectorio($: EngineInterface, ruta: string): Promise<boolean> {
  try {
    return (await $.fs.stat(ruta)).kind === 'dir'
  } catch {
    return false
  }
}

export async function crearDirectorio($: EngineInterface, ruta: string): Promise<void> {
  const r = await $.process.run(['mkdir', '-p', '--', ruta])
  if (r.exitCode !== 0) throw new Error(`no se pudo crear ${ruta}: ${r.stderr.trim()}`)
}

/** Escribe en un temporal del mismo directorio y lo mueve encima; si no hay `mv`, escribe directo. */
export async function escribirAtomico($: EngineInterface, ruta: string, texto: string): Promise<void> {
  const temporal = unir(padre(ruta), `.${Math.random().toString(36).slice(2, 10)}.huddle-tmp`)
  await $.fs.write(temporal, texto)
  let movido = false
  try {
    movido = (await $.process.run(['mv', '-f', '--', temporal, ruta])).exitCode === 0
  } catch {
    movido = false
  }
  if (!movido) {
    await $.fs.write(ruta, texto)
    await borrar($, temporal)
  }
}

/** Escribe solo si el fichero no existe. Devuelve si lo escribió. */
export async function escribirSiNoExiste($: EngineInterface, ruta: string, texto: string): Promise<boolean> {
  if (await existe($, ruta)) return false
  await escribirAtomico($, ruta, texto)
  return true
}

export async function borrar($: EngineInterface, ruta: string): Promise<void> {
  try {
    await $.process.run(['rm', '-f', '--', ruta])
  } catch {
    // si no se puede borrar, se queda: el lector y /refresh lo toleran
  }
}

/**
 * Añade texto al final de un fichero (creando su carpeta si hace falta). Es
 * lo que usan la bitácora y los tramos: líneas cortas, varias sesiones a la vez.
 */
export async function anadir($: EngineInterface, ruta: string, texto: string): Promise<boolean> {
  try {
    const r = await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")" && cat >> "$1"', 'huddle', ruta], { stdin: texto, timeoutMs: 5000 })
    return r.exitCode === 0
  } catch {
    return false
  }
}

/** Borra una carpeta entera (solo la usan la rotación de la bitácora y los tramos). */
export async function borrarCarpeta($: EngineInterface, ruta: string): Promise<void> {
  try {
    await $.process.run(['rm', '-rf', '--', ruta])
  } catch {
    // se reintenta en la siguiente sesión
  }
}

/** Las subcarpetas visibles de primer nivel (solo nombres: no entra en ninguna). */
export async function listarCarpetas($: EngineInterface, ruta: string): Promise<string[]> {
  const entradas = await $.fs.list(ruta)
  return entradas
    .filter(e => e.kind === 'dir' && !e.name.startsWith('.') && !/^\$|^System Volume Information$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, 'es'))
}

/** Las primeras `n` líneas de un fichero sin leerlo entero (`head`). */
export async function primerasLineas($: EngineInterface, ruta: string, n: number): Promise<string | undefined> {
  try {
    const r = await $.process.run(['head', '-n', String(n), '--', ruta], { timeoutMs: 5000 })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}
