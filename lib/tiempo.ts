// Fechas locales sin depender de la zona horaria del entorno del mod: el
// desfase se pide una vez al sistema (`date +%z`) y se pasa explícito.

const dos = (n: number): string => String(n).padStart(2, '0')

/** `+0100` → 60; `-0530` → -330. Lo que no encaja da 0 (UTC). */
export function desfaseDeTexto(texto: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(texto.trim())
  if (!m) return 0
  const minutos = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutos : minutos
}

function partes(ms: number, desfaseMin: number) {
  const d = new Date(ms + desfaseMin * 60_000)
  return {
    a: d.getUTCFullYear(),
    mes: d.getUTCMonth() + 1,
    dia: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
    semana: d.getUTCDay(),
  }
}

/** `2026-10-31T00:46:12+01:00` */
export function isoLocal(ms: number, desfaseMin: number): string {
  const p = partes(ms, desfaseMin)
  const signo = desfaseMin < 0 ? '-' : '+'
  const abs = Math.abs(desfaseMin)
  return `${p.a}-${dos(p.mes)}-${dos(p.dia)}T${dos(p.h)}:${dos(p.min)}:${dos(p.s)}${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`
}

/** `2026-10-31`, el día local. */
export function diaLocal(ms: number, desfaseMin: number): string {
  const p = partes(ms, desfaseMin)
  return `${p.a}-${dos(p.mes)}-${dos(p.dia)}`
}

/** Los `n` días locales que acaban en el de `ms`, del más antiguo al más reciente. */
export function ultimosDias(ms: number, desfaseMin: number, n: number): string[] {
  const dias: string[] = []
  for (let i = n - 1; i >= 0; i--) dias.push(diaLocal(ms - i * 86_400_000, desfaseMin))
  return dias
}

/** `2026-10-31T00`, la hora local (para agrupar tokens). */
export function horaLocal(ms: number, desfaseMin: number): string {
  return isoLocal(ms, desfaseMin).slice(0, 13)
}

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

/**
 * El último reinicio semanal antes de `ms` según `jue 09:00` (hora local), en
 * ms; null si el texto no se entiende.
 */
export function ultimoReinicio(ms: number, desfaseMin: number, texto: string): number | null {
  const m = /^\s*([a-záéíóú]{3})[a-záéíóú]*\.?\s+(\d{1,2}):(\d{2})\s*$/i.exec(texto)
  if (!m) return null
  const dia = DIAS_SEMANA.indexOf(m[1]!.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  if (dia < 0) return null
  const local = new Date(ms + desfaseMin * 60_000)
  const base = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), Number(m[2]), Number(m[3]))
  const atras = (local.getUTCDay() - dia + 7) % 7
  let candidato = base - atras * 86_400_000
  if (candidato > ms + desfaseMin * 60_000) candidato -= 7 * 86_400_000
  return candidato - desfaseMin * 60_000
}

const SEMANA_CORTA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** `jue 09:00`: día de la semana y hora local. */
export function diaYHora(ms: number, desfaseMin: number): string {
  const p = partes(ms, desfaseMin)
  return `${SEMANA_CORTA[p.semana]} ${dos(p.h)}:${dos(p.min)}`
}

/** `09:05`: la hora local. */
export function horaMinuto(ms: number, desfaseMin: number): string {
  const p = partes(ms, desfaseMin)
  return `${dos(p.h)}:${dos(p.min)}`
}

/** La medianoche local del día de `ms`, en ms. */
export function medianoche(ms: number, desfaseMin: number): number {
  const local = ms + desfaseMin * 60_000
  return ms - (((local % 86_400_000) + 86_400_000) % 86_400_000)
}
