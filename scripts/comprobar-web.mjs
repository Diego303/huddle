// Comprueba que web/dashboard.html es autocontenido: ni CDN ni peticiones de red.
// Las únicas cargas permitidas son sus dos ficheros de datos, al lado: datos.js
// y bitacora.js (la bitácora de la pestaña Actividad, que va aparte).
import fs from 'node:fs'

const html = fs.readFileSync(new URL('../web/dashboard.html', import.meta.url), 'utf8')
const fallos = []
const prohibido = [
  [/https?:\/\//i, 'una URL http(s)'],
  [/<link\b/i, 'un <link>'],
  [/@import\b/i, 'un @import'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, 'una API de red'],
  [/\burl\s*\(\s*['"]?(?!data:)[a-z]/i, 'un url() externo'],
]
for (const [re, que] of prohibido) if (re.test(html)) fallos.push(`contiene ${que}`)
for (const m of html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) {
  if (!m[1].startsWith('datos.js') && !m[1].startsWith('bitacora.js')) fallos.push(`carga ${m[1]} (solo se permiten datos.js y bitacora.js, por script)`)
}
if (!/s\.src\s*=\s*'datos\.js\?t='/.test(html)) fallos.push('no relee datos.js?t=… cada 2 s')
if (!/setInterval\(cargar, 2000\)/.test(html)) fallos.push('no tiene el sondeo de 2 s')
if (fallos.length > 0) {
  console.error(`web/dashboard.html no es autocontenido:\n- ${fallos.join('\n- ')}`)
  process.exit(1)
}
console.log(`web/dashboard.html: autocontenido (${(html.length / 1024).toFixed(1)} KB)`)
