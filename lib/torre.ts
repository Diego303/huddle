// La sesión torre: la que se abre en la carpeta de control. Solo ella abre el
// panel, lee .agentos/ cada 2 s y anima a Rex. Las demás sesiones solo escriben.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { dibujar } from '../mod/dibujar.tsx'
import { componerPanel } from '../mod/panel.ts'

import { usoDe } from './estado.ts'
import type { DatosPanel } from './lector.ts'
import { leerPanel } from './lector.ts'
import { ahoraLocal, configActual, desfaseActual, estadoActual } from './sesion.ts'

export const PANEL = 'huddle'
const LECTURA_MS = 2000
const FOTOGRAMA_MS = 600

export const datosAtom = atom({ plugin: 'huddle', key: 'datos' } as const, null, { shape: 'datos-1' })
export const vistaAtom = atom({ plugin: 'huddle', key: 'vista' } as const, 'panel')
export const modoAtom = atom({ plugin: 'huddle', key: 'modo' } as const, 'sesiones')
export const fotogramaAtom = atom({ plugin: 'huddle', key: 'fotograma' } as const, 0)

let activa = false
let ultimo = ''
let leyendo = false

export function esTorre(): boolean {
  return estadoActual()?.tipo === 'torre' && configActual() !== null
}

/** Relee la carpeta de control y, si algo cambió, lo publica para el panel. */
export async function refrescarPanel($: EngineInterface): Promise<void> {
  const config = configActual()
  if (config === null || leyendo) return
  leyendo = true
  try {
    const motor = await $.session.usage().catch(() => null)
    const propio = motor ? usoDe(motor, ahoraLocal()) : null
    const datos = await leerPanel($, config, desfaseActual(), propio)
    const firma = JSON.stringify({ ...datos, generado: 0, uso: datos.uso ? { ...datos.uso, leido: '' } : null })
    if (firma === ultimo) return
    ultimo = firma
    const json = JSON.stringify(datos)
    await update($, datosAtom, () => json)
  } catch {
    // el panel se queda con lo último que leyó
  } finally {
    leyendo = false
  }
}

/** Abre el panel (si cabe sin pedirlo: ≥ 144 columnas) y arranca la lectura y la animación. */
export async function iniciarTorre($: EngineInterface): Promise<void> {
  if (activa || !esTorre()) return
  activa = true
  await refrescarPanel($)
  void $.ui.open({ id: PANEL, title: 'Huddle', columns: 90, rows: 44 }).catch(() => undefined)
  $.clock.every(LECTURA_MS, () => {
    void refrescarPanel($)
  })
  $.clock.every(FOTOGRAMA_MS, () => {
    void update($, fotogramaAtom, n => (n + 1) % 1200).catch(() => undefined)
  })
}

/** /panel: abre el panel (si estaba cerrado) en la vista Panel. */
export async function abrirPanel($: EngineInterface): Promise<string> {
  if (!esTorre()) return 'El panel solo se abre en la carpeta de control (la de /configurar).'
  await update($, vistaAtom, () => 'panel')
  const r = await $.ui.open({ id: PANEL, title: 'Huddle', columns: 90, rows: 44 })
  return r.isPlaced ? 'Panel abierto.' : `El panel no cabe ahora: ${r.reason ?? 'sin motivo'}`
}

/** El hook `ui.render` del panel: lee los datos publicados y dibuja la vista. */
export async function pintarPanel($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const json = await read($, datosAtom)
  const n = await read($, fotogramaAtom)
  let datos: DatosPanel | null = null
  try {
    datos = json ? (JSON.parse(json) as DatosPanel) : null
  } catch {
    datos = null
  }
  const bloques = componerPanel(datos, e.props.bodyColumns, e.props.scroll.bodyRows, n, Date.now())
  return dibujar($.ui.resolve(e), bloques)
}
