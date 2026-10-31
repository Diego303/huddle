// Pedirle algo a Claude desde un comando. El host no deja llamar a
// `$.prompt.submit` dentro de un hook `command.run` (esperaría al turno que
// ese mismo hook retiene), así que se encola con un temporizador: sale en
// cuanto el comando ha contestado y se convierte en un turno al quedar libre.

import type { EngineInterface } from 'claude-code'

export function encolarPrompt($: EngineInterface, texto: string): void {
  try {
    $.clock.after(50, () => {
      void $.prompt.submit({ text: texto }).catch(() => undefined)
    })
  } catch {
    // sin reloj (no debería pasar): no se pide nada
  }
}
