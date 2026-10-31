// Comprueba que web/dashboard.html es autocontenido: ni CDN ni peticiones de red.
// La única carga externa permitida es su propio datos.js, al lado.
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
for (const m of html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) if (!m[1].startsWith('datos.js')) fallos.push(`carga ${m[1]} (solo se permite datos.js, por script)`)
if (!/s\.src\s*=\s*'datos\.js\?t='/.test(html)) fallos.push('no relee datos.js?t=… cada 2 s')
if (!/setInterval\(cargar, 2000\)/.test(html)) fallos.push('no tiene el sondeo de 2 s')
if (fallos.length > 0) {
  console.error(`web/dashboard.html no es autocontenido:\n- ${fallos.join('\n- ')}`)
  process.exit(1)
}
console.log(`web/dashboard.html: autocontenido (${(html.length / 1024).toFixed(1)} KB)`)
