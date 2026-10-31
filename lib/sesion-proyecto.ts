// A qué proyecto pertenece una sesión (§2.6 del plan), sin ejecutar git: el
// motor ya da la raíz del repo principal también desde un worktree.

import type { Config } from './config.ts'
import type { TipoSesion } from './estado.ts'
import type { Proyectos } from './proyectos.ts'
import { dentroDe, mismoNombre, normalizar } from './rutas.ts'

export type Clasificacion = { tipo: TipoSesion; proyecto: string; codigo: string }

export const TORRE: Clasificacion = { tipo: 'torre', proyecto: 'GENERAL', codigo: 'GEN' }
export const OTROS: Clasificacion = { tipo: 'otros', proyecto: 'otros', codigo: 'OTR' }

/**
 * La carpeta de control es la torre. Si no, el repo (o el cwd, sin repo) tiene
 * que caer bajo la raíz y su carpeta de primer nivel estar en seguimiento; lo
 * demás va a `otros`, sin leer nada.
 */
export function clasificar(cwd: string, repoRaiz: string | null, config: Config, doc: Proyectos | null): Clasificacion {
  if (config.general_dir !== '' && dentroDe(cwd, config.general_dir)) return TORRE
  const raiz = normalizar(config.raiz_proyectos)
  if (raiz === '' || doc === null) return OTROS
  for (const base of [repoRaiz, cwd]) {
    if (base === null || !dentroDe(base, raiz)) continue
    const resto = normalizar(base).slice(raiz.length + 1)
    const carpeta = resto.split('/')[0]
    if (!carpeta) continue
    const entrada = doc.seguimiento.find(e => mismoNombre(e.carpeta, carpeta, raiz))
    if (entrada) return { tipo: 'proyecto', proyecto: entrada.carpeta, codigo: entrada.codigo }
  }
  return OTROS
}

/** La rama a partir del contenido de `HEAD`: `ref: refs/heads/x` → `x`; un HEAD suelto → 7 caracteres del sha. */
export function ramaDeHead(head: string): string | null {
  const t = head.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(t)
  if (ref) return ref[1]!
  if (/^[0-9a-f]{40,64}$/.test(t)) return t.slice(0, 7)
  return null
}

/** El directorio git al que apunta un fichero `.git` de worktree (`gitdir: …`), relativo o absoluto. */
export function gitdirDeFichero(contenido: string, dir: string): string | null {
  const m = /^gitdir:\s*(.+)$/m.exec(contenido)
  if (!m) return null
  const destino = m[1]!.trim()
  return normalizar(destino.startsWith('/') ? destino : `${dir}/${destino}`)
}
