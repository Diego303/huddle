// Contrato de los valores de Huddle en $.state (los lee el panel al dibujar).

export type Vista = 'panel' | 'oficina'
export type ModoOficina = 'sesiones' | 'agentes'

declare module 'claude-code' {
  interface PluginState {
    huddle: {
      /** DatosPanel (lib/lector.ts) serializado: lo escribe el lector cada 2 s. */
      datos: Shaped<string | null>
      vista: Vista
      modo: ModoOficina
      /** Avanza cada 600 ms para las animaciones. */
      fotograma: number
    }
  }
}
