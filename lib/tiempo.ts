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
