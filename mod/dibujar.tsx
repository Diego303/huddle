// Convierte los bloques del lienzo en elementos de la superficie. En el
// terminal, Rex es un `Raster`; en el resto (escritorio, VS Code), texto con
// color de fondo por celda.

import type { ElementTable, RenderElement, TextProps } from 'claude-code'

import type { Linea, Seg } from './lienzo.ts'
import type { Bloque } from './panel.ts'
import type { Celda } from './rex.ts'
import { empaquetar, hex } from './rex.ts'

function estilo(x: Seg): TextProps {
  const p: TextProps = {}
  if (x.c) p.color = x.c
  if (x.f) p.backgroundColor = x.f
  if (x.b) p.bold = true
  if (x.d) p.dimColor = true
  return p
}

function linea(t: ElementTable, l: Linea): RenderElement {
  const { Text } = t
  if (l.length === 0) return <Text> </Text>
  return <Text wrap="truncate">{l.map(x => <Text {...estilo(x)}>{x.t}</Text>)}</Text>
}

function rexComoTexto(t: ElementTable, celdas: readonly (readonly Celda[])[]): RenderElement {
  const { Box, Text } = t
  return (
    <Box flexDirection="column">
      {celdas.map(fila => (
        <Text>
          {fila.map(c => {
            const p: TextProps = {}
            const fg = hex(c.fg)
            const bg = hex(c.bg)
            if (fg) p.color = fg
            if (bg) p.backgroundColor = bg
            return <Text {...p}>{c.ch}</Text>
          })}
        </Text>
      ))}
    </Box>
  )
}

function rex(t: ElementTable, celdas: Celda[][]): RenderElement {
  if ('Raster' in t) {
    const columnas = celdas[0]?.length ?? 1
    return t.Raster({ key: 'rex', columns: columnas, rows: celdas.length, cells: empaquetar(celdas) })
  }
  return rexComoTexto(t, celdas)
}

export function dibujar(t: ElementTable, bloques: readonly Bloque[], botones?: RenderElement): RenderElement {
  const { Box } = t
  return (
    <Box flexDirection="column">
      {botones}
      {bloques.map(b =>
        b.tipo === 'lineas' ? (
          <Box flexDirection="column">{b.lineas.map(l => linea(t, l))}</Box>
        ) : (
          <Box flexDirection="row">
            {rex(t, b.celdas)}
            <Box flexDirection="column" marginLeft={2} width={b.ladoAncho}>
              {b.lado.map(l => linea(t, l))}
            </Box>
          </Box>
        ),
      )}
    </Box>
  )
}
