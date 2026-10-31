// La sesión torre: la que se abre en la carpeta de control. Solo ella abre el
// panel, lee .agentos/ cada 2 s y anima a Rex. Las demás sesiones solo escriben.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { dibujar } from '../mod/dibujar.tsx'
import { componerOficina } from '../mod/oficina.ts'
import { componerPanel } from '../mod/panel.ts'
import type { ModoOficina } from '../types/index.d.ts'

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
  return r.isPlaced ? 'Panel.' : `El panel no cabe ahora: ${r.reason ?? 'sin motivo'}`
}

/** /oficina [sesiones|agentes]: la vista Oficina, en el modo pedido (o el último). */
export async function abrirOficina($: EngineInterface, args: string): Promise<string> {
  if (!esTorre()) return 'La oficina solo se abre en la carpeta de control (la de /configurar).'
  const pedido = args.trim().toLowerCase()
  if (pedido !== '' && pedido !== 'sesiones' && pedido !== 'agentes') return 'Uso: /oficina [sesiones|agentes]'
  if (pedido !== '') {
    const modo: ModoOficina = pedido
    await update($, modoAtom, () => modo)
  }
  await update($, vistaAtom, () => 'oficina')
  const r = await $.ui.open({ id: PANEL, title: 'Huddle', columns: 90, rows: 44 })
  const modo = await read($, modoAtom)
  return r.isPlaced ? `Oficina · ${modo}.` : `El panel no cabe ahora: ${r.reason ?? 'sin motivo'}`
}

/** El hook `ui.render` del panel: lee los datos publicados y dibuja la vista que toque. */
export async function pintarPanel($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const json = await read($, datosAtom)
  const n = await read($, fotogramaAtom)
  const vista = await read($, vistaAtom)
  const modo = await read($, modoAtom)
  let datos: DatosPanel | null = null
  try {
    datos = json ? (JSON.parse(json) as DatosPanel) : null
  } catch {
    datos = null
  }
  const t = $.ui.resolve(e)
  const { Box, Button } = t
  // Teclas: funcionan cuando el panel tiene el foco (ctrl+x tab o un clic).
  const botones = (
    <Box flexDirection="row">
      <Button key="vista-panel" label="Panel" hotkey="p" {...(vista === 'panel' ? { variant: 'primary' as const } : {})} onPress={() => update($, vistaAtom, () => 'panel')} />
      <Button key="vista-oficina" label="Oficina" hotkey="o" {...(vista === 'oficina' ? { variant: 'primary' as const } : {})} onPress={() => update($, vistaAtom, () => 'oficina')} />
      {vista === 'oficina' && (
        <Button key="modo-sesiones" label="Sesiones" hotkey="s" {...(modo === 'sesiones' ? { variant: 'primary' as const } : {})} onPress={() => update($, modoAtom, () => 'sesiones')} />
      )}
      {vista === 'oficina' && (
        <Button key="modo-agentes" label="Agentes" hotkey="a" {...(modo === 'agentes' ? { variant: 'primary' as const } : {})} onPress={() => update($, modoAtom, () => 'agentes')} />
      )}
    </Box>
  )
  const ahora = Date.now()
  const columnas = e.props.bodyColumns
  const bloques =
    vista === 'oficina'
      ? [{ tipo: 'lineas' as const, lineas: componerOficina(datos, modo, columnas, n, ahora) }]
      : componerPanel(datos, columnas, e.props.scroll.bodyRows - 1, n, ahora)
  return dibujar(t, bloques, botones)
}
