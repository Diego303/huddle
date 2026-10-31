// La sesión torre: la que se abre en la carpeta de control. Solo ella abre el
// panel, lee .agentos/ cada 2 s y anima a Rex. Las demás sesiones solo escriben.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import { dibujar, linea } from '../mod/dibujar.tsx'
import { componerOficina, resumenOficina } from '../mod/oficina.ts'
import { cabecera, componerPanel } from '../mod/panel.ts'
import type { ModoOficina } from '../types/index.d.ts'

import { usoDe } from './estado.ts'
import type { DatosPanel } from './lector.ts'
import { leerPanel } from './lector.ts'
import { escribirWeb, webActiva } from './web.ts'
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
let webEscrita = 0
/** La torre reescribe datos.js también sin cambios cada tanto, para las horas relativas y las inactivas. */
const REFRESCO_WEB_MS = 30_000

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
    const ahora = Date.now()
    if (firma !== ultimo || ahora - webEscrita > REFRESCO_WEB_MS) {
      webEscrita = ahora
      if (await webActiva($, config)) {
        await escribirWeb($, config, datos, ahoraLocal().slice(11, 19))
      }
    }
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

const CORAL = '#D85A30'
const OSCURO = '#1a1a18'
const PILDORA_APAGADA = '#30302d'

type Pestana = { key: string; etiqueta: string; tecla: string; activa: boolean; pulsar: () => void }

/** Ancho de una fila de pestañas: cada una se dibuja `p: ` + ` etiqueta `, con un espacio entre ellas. */
export function anchoPestanas(etiquetas: readonly string[]): number {
  return etiquetas.reduce((n, e) => n + 3 + e.length + 2, 0) + Math.max(0, etiquetas.length - 1)
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
  const { Box, Button, Text } = t
  const ahora = Date.now()
  const columnas = e.props.bodyColumns
  const filas = e.props.scroll.bodyRows

  // Pestañas como píldoras: la activa en coral con texto oscuro, el resto en gris.
  // Sus teclas (p, o, s, a) funcionan cuando el panel tiene el foco (ctrl+x tab).
  const pestanas: Pestana[] = [
    { key: 'vista-panel', etiqueta: 'Panel', tecla: 'p', activa: vista === 'panel', pulsar: () => void update($, vistaAtom, () => 'panel') },
    { key: 'vista-oficina', etiqueta: 'Oficina', tecla: 'o', activa: vista === 'oficina', pulsar: () => void update($, vistaAtom, () => 'oficina') },
    ...(vista === 'oficina'
      ? [
          { key: 'modo-sesiones', etiqueta: 'Sesiones', tecla: 's', activa: modo === 'sesiones', pulsar: () => void update($, modoAtom, () => 'sesiones') },
          { key: 'modo-agentes', etiqueta: 'Agentes', tecla: 'a', activa: modo === 'agentes', pulsar: () => void update($, modoAtom, () => 'agentes') },
        ]
      : []),
  ]
  const ocupado = anchoPestanas(pestanas.map(p => p.etiqueta))
  const resto = Math.max(0, columnas - ocupado)
  const textoCabecera = vista === 'oficina' ? resumenOficina(datos, ahora, resto) : cabecera(datos, ahora, resto)
  const fila = (
    <Box flexDirection="row">
      {pestanas.flatMap((p, i) => [
        ...(i > 0 ? [<Text> </Text>] : []),
        <Button key={p.key} plain hotkey={p.tecla} onPress={p.pulsar}>
          <Text {...(p.activa ? { backgroundColor: CORAL, color: OSCURO, bold: true } : { backgroundColor: PILDORA_APAGADA, color: '#888780' })}>{` ${p.etiqueta} `}</Text>
        </Button>,
      ])}
      {resto > 0 ? linea(t, textoCabecera) : null}
    </Box>
  )
  const cuerpo = vista === 'oficina' ? componerOficina(datos, modo, columnas, n, ahora) : componerPanel(datos, columnas, filas - 1, n, ahora)
  return dibujar(t, cuerpo, fila)
}
