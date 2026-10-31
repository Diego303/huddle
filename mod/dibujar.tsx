// Convierte las líneas del lienzo en elementos de la superficie: una `Text` por
// línea, con un trozo por cada tramo de estilo (los contiguos iguales, juntos).
// Arriba, si la hay, la fila de pestañas (botones) con la cabecera a su lado.

import type { ElementTable, RenderElement, TextProps } from 'claude-code'

import type { Linea, Seg } from './lienzo.ts'
import { compactar } from './lienzo.ts'

function estilo(x: Seg): TextProps {
  const p: TextProps = {}
  if (x.c) p.color = x.c
  if (x.f) p.backgroundColor = x.f
  if (x.b) p.bold = true
  if (x.d) p.dimColor = true
  return p
}

export function linea(t: ElementTable, l: Linea): RenderElement {
  const { Text } = t
  const tramos = compactar(l)
  if (tramos.length === 0) return <Text> </Text>
  return <Text wrap="truncate">{tramos.map(x => <Text {...estilo(x)}>{x.t}</Text>)}</Text>
}

export function dibujar(t: ElementTable, lineas: readonly Linea[], cabecera?: RenderElement): RenderElement {
  const { Box } = t
  return (
    <Box flexDirection="column">
      {cabecera}
      {lineas.map(l => linea(t, l))}
    </Box>
  )
}
