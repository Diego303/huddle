// Rutas POSIX sin Node: el módulo del mod no tiene `node:path`.

/** Une trozos de ruta y la normaliza. */
export function unir(...partes: string[]): string {
  return normalizar(partes.filter(p => p !== '').join('/'))
}

/** Quita barras repetidas y la final, y resuelve `.` y `..`. */
export function normalizar(ruta: string): string {
  const absoluta = ruta.startsWith('/')
  const salida: string[] = []
  for (const trozo of ruta.split('/')) {
    if (trozo === '' || trozo === '.') continue
    if (trozo === '..') {
      if (salida.length > 0 && salida[salida.length - 1] !== '..') salida.pop()
      else if (!absoluta) salida.push('..')
      continue
    }
    salida.push(trozo)
  }
  const cuerpo = salida.join('/')
  if (absoluta) return `/${cuerpo}`
  return cuerpo === '' ? '.' : cuerpo
}

export function padre(ruta: string): string {
  const n = normalizar(ruta)
  const i = n.lastIndexOf('/')
  if (i <= 0) return n.startsWith('/') ? '/' : '.'
  return n.slice(0, i)
}

export function nombre(ruta: string): string {
  const n = normalizar(ruta)
  return n.slice(n.lastIndexOf('/') + 1)
}

/** Una ruta de una unidad de Windows montada en WSL (`/mnt/d/...`), que no distingue mayúsculas. */
export function esDrvFs(ruta: string): boolean {
  return /^\/mnt\/[a-zA-Z](\/|$)/.test(ruta)
}

function clave(ruta: string): string {
  const n = normalizar(ruta)
  return esDrvFs(n) ? n.toLowerCase() : n
}

/** Compara dos rutas; bajo `/mnt/<letra>/` sin distinguir mayúsculas. */
export function mismaRuta(a: string, b: string): boolean {
  return clave(a) === clave(b)
}

/** `ruta` es `base` o está dentro. */
export function dentroDe(ruta: string, base: string): boolean {
  const r = clave(ruta)
  const b = clave(base)
  return r === b || r.startsWith(b === '/' ? '/' : `${b}/`)
}

/** Compara nombres de carpeta de una raíz: sin mayúsculas si la raíz está en DrvFs. */
export function mismoNombre(a: string, b: string, raiz: string): boolean {
  return esDrvFs(raiz) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Lo que escribe la persona como ruta: quita comillas, convierte `D:\Github` en
 * `/mnt/d/Github`, expande `~` y resuelve las relativas desde `cwd`.
 */
export function rutaDeUsuario(texto: string, home: string, cwd: string): string {
  let t = texto.trim().replace(/^(["'])(.*)\1$/, '$2').trim()
  const windows = /^([a-zA-Z]):[\\/](.*)$/.exec(t)
  if (windows) t = `/mnt/${windows[1]!.toLowerCase()}/${windows[2]!.replaceAll('\\', '/')}`
  if (t === '~') t = home
  else if (t.startsWith('~/')) t = `${home}/${t.slice(2)}`
  if (!t.startsWith('/')) t = `${cwd}/${t}`
  return normalizar(t)
}
