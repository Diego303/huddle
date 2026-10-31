// Tokens de los transcripts de Claude Code, por hora local. Cada sesión lee
// solo lo nuevo de su propio transcript (y del de sus subagentes) desde la
// última vez: aquí está la parte pura, que suma un trozo de texto.
//
// Un mensaje del asistente se escribe en varias líneas (una por bloque) con el
// mismo `message.id` y el mismo `usage`: se cuenta una sola vez. Se suman
// `input_tokens + output_tokens + cache_creation_input_tokens`, igual que
// antes con `turn.complete`; las lecturas de caché no cuentan.

import { horaLocal } from './tiempo.ts'

/** Por encima de esto, un transcript que se ve por primera vez se empieza a leer por el final. */
export const HISTORIA_MAX_BYTES = 4_000_000

export type Leido = {
  /** Caracteres del trozo que se han usado: hasta la última línea completa. */
  usados: number
  porHora: Record<string, number>
  ultimo: string | null
}

type LineaTranscript = { type?: unknown; timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } }

function numero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** Suma los tokens de las líneas completas de `trozo`. `ultimo`: el último `message.id` contado. */
export function sumarTrozo(trozo: string, ultimo: string | null, desfaseMin: number): Leido {
  const fin = trozo.lastIndexOf('\n')
  const usados = fin + 1
  const porHora: Record<string, number> = {}
  let previo = ultimo
  for (const l of trozo.slice(0, usados).split('\n')) {
    if (!l.includes('"usage"')) continue
    let v: LineaTranscript
    try {
      v = JSON.parse(l) as LineaTranscript
    } catch {
      continue
    }
    const id = typeof v.message?.id === 'string' ? v.message.id : null
    const u = v.message?.usage
    const ms = typeof v.timestamp === 'string' ? Date.parse(v.timestamp) : NaN
    if (v.type !== 'assistant' || !u || !Number.isFinite(ms)) continue
    if (id !== null && id === previo) continue
    previo = id
    const n = numero(u.input_tokens) + numero(u.output_tokens) + numero(u.cache_creation_input_tokens)
    if (n === 0) continue
    const h = horaLocal(ms, desfaseMin)
    porHora[h] = (porHora[h] ?? 0) + n
  }
  return { usados, porHora, ultimo: previo }
}

/** Bytes UTF-8 de un texto (sin depender de TextEncoder ni Buffer). */
export function bytesUtf8(texto: string): number {
  let n = 0
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4
      i += 1
    } else n += 3
  }
  return n
}

/** La carpeta de los transcripts de los subagentes de una sesión: `<transcript sin .jsonl>/subagents`. */
export function dirSubagentes(transcript: string): string {
  return `${transcript.replace(/\.jsonl$/, '')}/subagents`
}
