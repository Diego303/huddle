// Un lienzo de texto con color, independiente de la superficie: el panel se
// compone como líneas de segmentos y `dibujar.tsx` lo convierte en elementos.

export type Seg = { t: string; c?: string; f?: string; b?: true; d?: true }
export type Linea = Seg[]

export const COLOR = {
  titulo: '#D85A30',
  verde: '#5DCAA5',
  verdeOscuro: '#1D9E75',
  ambar: '#EF9F27',
  rojo: '#E24B4A',
  azul: '#378ADD',
  morado: '#7F77DD',
  gris: '#888780',
  grisClaro: '#B4B2A9',
} as const

export function s(t: string, estilo: Omit<Seg, 't'> = {}): Seg {
  return { t, ...estilo }
}

/** Ancho en columnas (todo lo que usa Huddle ocupa una columna por carácter). */
export function largo(texto: string): number {
  return [...texto].length
}

export function ancho(l: Linea): number {
  return l.reduce((n, x) => n + largo(x.t), 0)
}

/** Corta (con …) o rellena con espacios hasta `w` columnas. */
export function ajustar(l: Linea, w: number): Linea {
  const total = ancho(l)
  if (total <= w) return total === w ? l : [...l, { t: ' '.repeat(w - total) }]
  const salida: Linea = []
  let restante = w - 1
  for (const x of l) {
    if (restante <= 0) break
    const letras = [...x.t]
    if (letras.length <= restante) {
      salida.push(x)
      restante -= letras.length
    } else {
      salida.push({ ...x, t: letras.slice(0, restante).join('') })
      restante = 0
    }
  }
  salida.push({ t: '…', c: COLOR.gris })
  return salida
}

/** Texto cortado a `w` columnas y rellenado: para columnas alineadas. */
export function celda(texto: string, w: number, estilo: Omit<Seg, 't'> = {}): Seg {
  const letras = [...texto]
  const t = letras.length > w ? `${letras.slice(0, Math.max(0, w - 1)).join('')}…` : texto + ' '.repeat(w - letras.length)
  return { t, ...estilo }
}

/** Una línea con texto a la izquierda y a la derecha, separados por espacio. */
export function extremos(izq: Linea, der: Linea, w: number): Linea {
  const hueco = w - ancho(izq) - ancho(der)
  if (hueco < 1) return ajustar([...izq, s(' '), ...der], w)
  return [...izq, s(' '.repeat(hueco)), ...der]
}

/** `█████░░░░░` con el relleno del color dado. Sin dato, una barra vacía punteada. */
export function barra(pct: number | null, w: number, color: string): Linea {
  if (pct === null) return [s('·'.repeat(w), { c: COLOR.gris })]
  const lleno = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  return [s('█'.repeat(lleno), { c: color }), s('░'.repeat(w - lleno), { c: COLOR.gris })]
}

const ALTURAS = '▁▂▃▄▅▆▇█'

/** Un carácter de minibarra para `v` sobre `max`; 0 es un espacio y sin dato un punto. */
export function minibarra(v: number | null, max: number): string {
  if (v === null) return '·'
  if (v <= 0 || max <= 0) return ' '
  return ALTURAS[Math.max(0, Math.min(7, Math.ceil((v / max) * 8) - 1))] ?? '█'
}

/** Dos bloques de líneas uno al lado del otro. */
export function columnas(a: readonly Linea[], b: readonly Linea[], wa: number, wb: number, sep = ' │ '): Linea[] {
  const n = Math.max(a.length, b.length)
  const out: Linea[] = []
  for (let i = 0; i < n; i++) out.push([...ajustar(a[i] ?? [], wa), s(sep, { c: COLOR.gris }), ...ajustar(b[i] ?? [], wb)])
  return out
}

export function texto(l: Linea): string {
  return l.map(x => x.t).join('')
}
