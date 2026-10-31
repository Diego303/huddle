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

/** Una columna de `w`: el texto cortado a `w - 1` y siempre un espacio detrás. */
export function col(texto: string, w: number, estilo: Omit<Seg, 't'> = {}): Linea {
  return w <= 1 ? [s(' ')] : [celda(texto, w - 1, estilo), s(' ')]
}

/** La primera opción que cabe en `w` columnas; si ninguna, la última cortada. */
export function queQuepa(opciones: readonly string[], w: number): string {
  return opciones.find(o => largo(o) <= w) ?? opciones[opciones.length - 1] ?? ''
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

// ------------------------------------------------------------- tarjetas

/** Fondo de las tarjetas, un poco más claro que el del terminal, y la pista de las barras. */
export const FONDO_TARJETA = '#21211f'
export const PISTA = '#30302d'
export const BORDE = '#5f5e5a'
export const CORAL_CLARO = '#F0997B'

/** Pone el fondo `f` a los segmentos que no tienen uno propio. */
export function conFondo(l: Linea, f: string): Linea {
  return l.map(x => (x.f ? x : { ...x, f }))
}

export type OpcionesTarjeta = {
  titulo?: string
  /** Texto en el borde superior, a la derecha (un contador, una leyenda). */
  derecha?: Linea
  ancho: number
  /** Alto total, bordes incluidos; si falta, el del contenido. */
  alto?: number
  /** Columnas de aire a cada lado por dentro del borde. */
  aire?: number
  fondo?: string
}

/** Ancho útil dentro de una tarjeta. */
export function interior(ancho: number, aire = 1): number {
  return Math.max(1, ancho - 2 - 2 * aire)
}

/**
 * Una tarjeta: `╭─ Título ───╮`, el contenido con fondo propio y `╰───╯`.
 * Cada línea mide exactamente `ancho`.
 */
export function tarjeta(lineas: readonly Linea[], o: OpcionesTarjeta): Linea[] {
  const w = Math.max(6, o.ancho)
  const aire = o.aire ?? 1
  const fondo = o.fondo ?? FONDO_TARJETA
  const dentro = interior(w, aire)
  const borde = { c: BORDE }
  const titulo: Linea = o.titulo ? [s('─ ', borde), s(o.titulo, { c: CORAL_CLARO, b: true }), s(' ', borde)] : []
  const derecha: Linea = o.derecha && o.derecha.length > 0 ? [s(' ', borde), ...o.derecha, s(' ─', borde)] : []
  const hueco = w - 2 - ancho(titulo) - ancho(derecha)
  const arriba: Linea =
    hueco >= 1
      ? [s('╭', borde), ...titulo, s('─'.repeat(hueco), borde), ...derecha, s('╮', borde)]
      : [s('╭', borde), ...ajustar(titulo, w - 2), s('╮', borde)]
  const altoInterior = o.alto === undefined ? lineas.length : Math.max(0, o.alto - 2)
  const cuerpo: Linea[] = []
  for (let i = 0; i < altoInterior; i++) {
    const l = lineas[i] ?? []
    cuerpo.push([s('│', borde), s(' '.repeat(aire), { f: fondo }), ...conFondo(ajustar(l, dentro), fondo), s(' '.repeat(aire), { f: fondo }), s('│', borde)])
  }
  return [arriba, ...cuerpo, [s(`╰${'─'.repeat(w - 2)}╯`, borde)]]
}

/** Bloques (tarjetas o pilas de tarjetas) uno al lado de otro, igualados en alto. */
export function fila(bloques: readonly (readonly Linea[])[], anchos: readonly number[], hueco = 1): Linea[] {
  const alto = Math.max(0, ...bloques.map(b => b.length))
  const out: Linea[] = []
  for (let r = 0; r < alto; r++) {
    const l: Linea = []
    bloques.forEach((b, i) => {
      if (i > 0) l.push(s(' '.repeat(hueco)))
      l.push(...ajustar(b[r] ?? [], anchos[i] ?? 0))
    })
    out.push(l)
  }
  return out
}

/** Reparte `total` columnas entre `n` piezas (con `hueco` entre ellas) según pesos. */
export function repartir(total: number, pesos: readonly number[], hueco = 1): number[] {
  const util = total - hueco * (pesos.length - 1)
  const suma = pesos.reduce((a, b) => a + b, 0)
  const anchos = pesos.map(p => Math.floor((util * p) / suma))
  let resto = util - anchos.reduce((a, b) => a + b, 0)
  for (let i = anchos.length - 1; resto > 0; i = (i - 1 + anchos.length) % anchos.length, resto--) anchos[i]! += 1
  return anchos
}

// ------------------------------------------------------------- barras suaves

const OCTAVOS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

/**
 * Barra con resolución de 1/8 de celda sobre una pista de fondo. Sin dato
 * (`null`), la pista vacía: nunca un relleno inventado.
 */
export function barraSuave(pct: number | null, w: number, color: string, pista = PISTA): Linea {
  if (w <= 0) return []
  if (pct === null) return [s(' '.repeat(w), { f: pista })]
  const octavos = Math.round((Math.max(0, Math.min(100, pct)) / 100) * w * 8)
  const llenas = Math.floor(octavos / 8)
  const parte = octavos % 8
  const out: Linea = []
  if (llenas > 0) out.push(s('█'.repeat(llenas), { c: color, f: pista }))
  if (parte > 0) out.push(s(OCTAVOS[parte]!, { c: color, f: pista }))
  const vacio = w - llenas - (parte > 0 ? 1 : 0)
  if (vacio > 0) out.push(s(' '.repeat(vacio), { f: pista }))
  return out
}

const ALTURA_VERTICAL = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/**
 * Una columna vertical de `filas` celdas para `v` sobre `max` (resolución de
 * 1/8 de celda), de arriba abajo. Sin valor, un `▁` apagado en la base.
 */
export function columnaVertical(v: number | null, max: number, filas: number): { ch: string; apagada: boolean }[] {
  const out: { ch: string; apagada: boolean }[] = []
  const vacia = v === null || v <= 0 || max <= 0
  const octavos = vacia ? 0 : Math.max(1, Math.round((v / max) * filas * 8))
  for (let r = 0; r < filas; r++) {
    const desdeAbajo = filas - 1 - r
    const n = Math.max(0, Math.min(8, octavos - desdeAbajo * 8))
    if (vacia) out.push({ ch: r === filas - 1 ? '▁' : ' ', apagada: true })
    else out.push({ ch: n === 0 ? ' ' : ALTURA_VERTICAL[n]!, apagada: false })
  }
  return out
}

/** Une segmentos contiguos con el mismo estilo (menos nodos que dibujar). */
export function compactar(l: Linea): Linea {
  const out: Linea = []
  for (const x of l) {
    const prev = out[out.length - 1]
    if (prev && prev.c === x.c && prev.f === x.f && prev.b === x.b && prev.d === x.d) out[out.length - 1] = { ...prev, t: prev.t + x.t }
    else out.push(x)
  }
  return out
}

/** Corta un texto en líneas de como mucho `w` columnas, por palabras. */
export function partir(texto: string, w: number, max = 2): string[] {
  const palabras = texto.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let actual = ''
  for (const p of palabras) {
    if (actual === '') actual = p
    else if (largo(actual) + 1 + largo(p) <= w) actual += ` ${p}`
    else {
      out.push(actual)
      actual = p
    }
  }
  if (actual !== '') out.push(actual)
  if (out.length > max) {
    const resto = out.slice(max - 1).join(' ')
    return [...out.slice(0, max - 1), [...resto].length > w ? `${[...resto].slice(0, w - 1).join('')}…` : resto]
  }
  return out
}
