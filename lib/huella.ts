// FNV-1a de 32 bits: una huella corta y estable de un texto (versiones de la
// web, claves de sesión y el hash normalizado de un error).

export function huella(texto: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
