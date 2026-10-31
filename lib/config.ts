// Config global, ~/.config/huddle/config.json (§2.1 del plan): la única fuente
// de verdad para las rutas. La comparten todas las sesiones.

import type { EngineInterface } from 'claude-code'

import type { Umbrales } from './atascos.ts'
import { UMBRALES_POR_DEFECTO } from './atascos.ts'
import { escribirAtomico, leerTexto } from './ficheros.ts'
import { normalizar, unir } from './rutas.ts'

export type Config = {
  general_dir: string
  raiz_proyectos: string
  /** Solo de respaldo: el motor da la ventana real del modelo. */
  ventana_contexto: number
  notificaciones: { windows: boolean; repetir_min: number }
  /** Solo de respaldo, sin dato oficial de uso (sin suscripción). */
  limites: { sesion_5h_tokens: number | null; semana_tokens: number | null; reinicio_semanal: string }
  inactiva_min: number
  /** El capricho estacional de Rex. */
  rex: { estacional: boolean }
  /** Umbrales del detector de atascos (pestaña Actividad de la web). */
  atascos: Umbrales
}

export const CONFIG_POR_DEFECTO: Config = {
  general_dir: '',
  raiz_proyectos: '',
  ventana_contexto: 200000,
  notificaciones: { windows: true, repetir_min: 5 },
  limites: { sesion_5h_tokens: null, semana_tokens: null, reinicio_semanal: 'jue 09:00' },
  inactiva_min: 30,
  rex: { estacional: true },
  atascos: { ...UMBRALES_POR_DEFECTO },
}

function objeto(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function texto(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def
}

function numero(v: unknown, def: number, min = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def
}

function numeroONulo(v: unknown, def: number | null): number | null {
  if (v === null) return null
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : def
}

/** Lee el JSON de la config sobre los valores por defecto; lo que no encaja se ignora con un aviso. */
export function interpretarConfig(json: string): { config: Config; avisos: string[] } {
  const avisos: string[] = []
  let bruto: Record<string, unknown> = {}
  try {
    bruto = objeto(JSON.parse(json))
  } catch {
    avisos.push('config.json no es JSON válido: se usan los valores por defecto')
  }
  const d = CONFIG_POR_DEFECTO
  const n = objeto(bruto.notificaciones)
  const l = objeto(bruto.limites)
  const r = objeto(bruto.rex)
  const a = objeto(bruto.atascos)
  const config: Config = {
    general_dir: texto(bruto.general_dir, '') && normalizar(texto(bruto.general_dir, '')),
    raiz_proyectos: texto(bruto.raiz_proyectos, '') && normalizar(texto(bruto.raiz_proyectos, '')),
    ventana_contexto: numero(bruto.ventana_contexto, d.ventana_contexto, 1),
    notificaciones: {
      windows: typeof n.windows === 'boolean' ? n.windows : d.notificaciones.windows,
      repetir_min: numero(n.repetir_min, d.notificaciones.repetir_min),
    },
    limites: {
      sesion_5h_tokens: numeroONulo(l.sesion_5h_tokens, d.limites.sesion_5h_tokens),
      semana_tokens: numeroONulo(l.semana_tokens, d.limites.semana_tokens),
      reinicio_semanal: texto(l.reinicio_semanal, d.limites.reinicio_semanal),
    },
    inactiva_min: numero(bruto.inactiva_min, d.inactiva_min, 1),
    rex: { estacional: typeof r.estacional === 'boolean' ? r.estacional : d.rex.estacional },
    atascos: {
      comando_repeticiones: numero(a.comando_repeticiones, d.atascos.comando_repeticiones, 2),
      fichero_ediciones: numero(a.fichero_ediciones, d.atascos.fichero_ediciones, 2),
      fichero_minutos: numero(a.fichero_minutos, d.atascos.fichero_minutos, 1),
      sin_progreso_minutos: numero(a.sin_progreso_minutos, d.atascos.sin_progreso_minutos, 1),
    },
  }
  return { config, avisos }
}

export function serializarConfig(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function estaConfigurada(config: Config): boolean {
  return config.general_dir !== '' && config.raiz_proyectos !== ''
}

/** `HUDDLE_CONFIG`, si está; si no, `$XDG_CONFIG_HOME/huddle/config.json` o `~/.config/huddle/config.json`. */
export async function rutaConfig($: EngineInterface): Promise<string> {
  const propia = await $.env.get('HUDDLE_CONFIG')
  if (propia) return normalizar(propia)
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  if (xdg) return unir(xdg, 'huddle', 'config.json')
  const home = (await $.env.get('HOME')) ?? ''
  return unir(home, '.config', 'huddle', 'config.json')
}

export type ConfigLeida = { config: Config; ruta: string; existe: boolean; avisos: string[] }

export async function leerConfig($: EngineInterface): Promise<ConfigLeida> {
  const ruta = await rutaConfig($)
  const json = await leerTexto($, ruta)
  if (json === undefined) return { config: { ...CONFIG_POR_DEFECTO }, ruta, existe: false, avisos: [] }
  return { ...interpretarConfig(json), ruta, existe: true }
}

export async function guardarConfig($: EngineInterface, config: Config): Promise<string> {
  const ruta = await rutaConfig($)
  await escribirAtomico($, ruta, serializarConfig(config))
  return ruta
}
