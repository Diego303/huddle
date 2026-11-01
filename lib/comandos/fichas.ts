// /fichas [proyecto]: Claude rellena las fichas de los proyectos en seguimiento.
// /fichas [proyecto] actualizar: Claude las pone al día (tareas hechas, estado).
// Por cada una, una consulta en solo lectura como la de /preguntar: si la
// sesión del proyecto está en pausa o inactiva, se le pregunta a una
// bifurcación suya (sabe lo que habéis hecho); si no, a un `claude -p` nuevo
// en el repo. Solo se rellena lo que sigue vacío: lo que hayas escrito no se
// toca. Va en segundo plano: el comando contesta enseguida y avisa al acabar.

import type { EngineInterface } from 'claude-code'

import type { Config } from '../config.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import { actualizarFicha, ficheroFicha, huecos, interpretarActualizacion, interpretarPropuesta, rellenarFicha, tareasDeFicha } from '../fichas.ts'
import { borrar, escribirAtomico, existe, leerTexto } from '../ficheros.ts'
import type { Entrada } from '../proyectos.ts'
import { unir } from '../rutas.ts'
import { desfaseActual } from '../sesion.ts'
import { diaLocal } from '../tiempo.ts'
import { buscarEntrada, listaProyectos, seguimiento } from './buscar.ts'
import { argvPreguntar, interpretarRespuesta, sesionQuieta } from './preguntar.ts'
import { crearFicha } from './proyectos.ts'
import { apuntar } from './registro.ts'

/** Cuántas consultas a la vez. */
const A_LA_VEZ = 3
/** Un cerrojo más viejo que esto se da por abandonado. */
const CERROJO_MS = 20 * 60_000

export const PROMPT_FICHA = (carpeta: string, ruta: string, ficha: string) =>
  [
    `[Huddle · /fichas] Ayúdame a rellenar la ficha del proyecto «${carpeta}» (${ruta}).`,
    'Mira lo que haga falta en solo lectura: README, docs, planes, el git log y el código; y lo que sepas de esta conversación, si la hay. No modifiques nada.',
    'Responde SOLO con un objeto JSON, sin nada alrededor, con esta forma:',
    '{"fase":"…","objetivo":"…","estado":"…","tareas":[{"texto":"…","hecha":true}],"bloqueos":["…"],"proximos":["…"]}',
    '- fase: una o dos palabras (idea, prototipo, MVP, beta, producción, mantenimiento…).',
    '- objetivo: una frase.',
    '- estado: dos o tres líneas, como mucho, de cómo está ahora.',
    '- tareas: entre 4 y 12 tareas grandes del proyecto entero, en orden; hecha=true solo si el código o el git muestran que está terminada.',
    '- bloqueos: lo que impide avanzar; [] si no hay nada.',
    '- proximos: de 1 a 3 pasos concretos.',
    '',
    'La ficha actual (no repitas lo que ya tenga):',
    ficha.trimEnd(),
  ].join('\n')

export const PROMPT_ACTUALIZAR = (carpeta: string, ruta: string, ficha: string) => {
  const tareas = tareasDeFicha(ficha)
  return [
    `[Huddle · /fichas actualizar] Ayúdame a poner al día la ficha del proyecto «${carpeta}» (${ruta}): qué tareas están ya terminadas y cómo va ahora.`,
    'Mira lo que haga falta en solo lectura: el git log, el código, los tests, los planes; y lo que sepas de esta conversación, si la hay. No modifiques nada.',
    'Estas son sus tareas, con su número y cómo están marcadas ahora:',
    ...tareas.map((t, i) => `${i + 1}. [${t.hecha ? 'x' : ' '}] ${t.texto}`),
    '',
    'Responde SOLO con un objeto JSON, sin nada alrededor, con esta forma:',
    '{"hechas":[1,2],"fase":"…","estado":"…"}',
    '- hechas: los números de TODAS las tareas que están terminadas ahora (también las que ya lo estaban); una tarea va solo si el código o el git muestran que está hecha.',
    '- fase: una o dos palabras (idea, prototipo, MVP, beta, producción, mantenimiento…).',
    '- estado: dos o tres líneas, como mucho, de cómo está el proyecto ahora.',
    '',
    'La ficha actual:',
    ficha.trimEnd(),
  ].join('\n')
}

export type Modo = 'rellenar' | 'actualizar'

type Resultado = { carpeta: string; rellenado: string[]; error: string | null; coste: number | null; conSesion: boolean }

async function rellenarUna($: EngineInterface, config: Config, e: Entrada, dia: string, modo: Modo = 'rellenar'): Promise<Resultado> {
  const ruta = unir(config.raiz_proyectos, e.carpeta)
  const destino = unir(config.general_dir, 'proyectos', ficheroFicha(e.carpeta))
  const quieta = await sesionQuieta($, config, e.carpeta)
  const base = { carpeta: e.carpeta, rellenado: [], coste: null, conSesion: quieta !== null }
  const antes = await leerTexto($, destino)
  if (antes === undefined) return { ...base, error: 'sin ficha' }
  let r
  try {
    const prompt = modo === 'actualizar' ? PROMPT_ACTUALIZAR(e.carpeta, ruta, antes) : PROMPT_FICHA(e.carpeta, ruta, antes)
    const p = await $.process.run(argvPreguntar(prompt, quieta?.id ?? null), { cwd: quieta?.cwd ?? ruta, timeoutMs: 300_000 })
    r = interpretarRespuesta(p.stdout)
    if (p.exitCode !== 0 && p.stdout.trim() === '') return { ...base, error: `claude terminó con código ${p.exitCode}` }
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
  if (r.error) return { ...base, coste: r.coste, error: 'Claude devolvió un error' }
  if (modo === 'actualizar') {
    const a = interpretarActualizacion(r.texto, tareasDeFicha(antes).length)
    if (a === null) return { ...base, coste: r.coste, error: 'la respuesta no traía las tareas' }
    const ahora = (await leerTexto($, destino)) ?? antes
    const hecho = actualizarFicha(ahora, a, dia)
    if (hecho.cambios.length > 0) await escribirAtomico($, destino, hecho.texto)
    return { ...base, rellenado: hecho.cambios, coste: r.coste, error: null }
  }
  const propuesta = interpretarPropuesta(r.texto)
  if (propuesta === null) return { ...base, coste: r.coste, error: 'la respuesta no traía la ficha' }
  // Se vuelve a leer justo antes de escribir, por si la has editado mientras tanto.
  const ahora = (await leerTexto($, destino)) ?? antes
  const hecho = rellenarFicha(ahora, propuesta, dia)
  if (hecho.rellenado.length > 0) await escribirAtomico($, destino, hecho.texto)
  return { ...base, rellenado: hecho.rellenado, coste: r.coste, error: null }
}

/** El resumen final, para el aviso y el registro. */
export function resumenFichas(resultados: readonly Resultado[], modo: Modo = 'rellenar'): string {
  const bien = resultados
    .filter(r => r.error === null && r.rellenado.length > 0)
    .map(r => (modo === 'actualizar' ? `${r.carpeta} (${r.rellenado.join(', ')})` : r.carpeta))
  const igual = resultados.filter(r => r.error === null && r.rellenado.length === 0).map(r => r.carpeta)
  const mal = resultados.filter(r => r.error !== null).map(r => `${r.carpeta} (${r.error})`)
  const costes = resultados.map(r => r.coste).filter((c): c is number => c !== null)
  return [
    bien.length > 0 ? `${modo === 'actualizar' ? 'al día' : 'rellenadas'}: ${bien.join(', ')}` : modo === 'actualizar' ? 'ningún cambio' : 'ninguna rellenada',
    igual.length > 0 ? `sin cambios: ${igual.join(', ')}` : '',
    mal.length > 0 ? `con error: ${mal.join(', ')}` : '',
    costes.length > 0 ? `$${costes.reduce((a, b) => a + b, 0).toFixed(2)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** El trabajo de verdad, ya fuera del comando. */
export async function rellenarEnFondo($: EngineInterface, config: Config, entradas: readonly Entrada[], cerrojo: string, modo: Modo = 'rellenar'): Promise<void> {
  const dia = diaLocal(Date.now(), desfaseActual())
  const resultados: Resultado[] = []
  const cola = [...entradas]
  try {
    await Promise.all(
      Array.from({ length: Math.min(A_LA_VEZ, cola.length) }, async () => {
        for (let e = cola.shift(); e !== undefined; e = cola.shift()) {
          resultados.push(await rellenarUna($, config, e, dia, modo).catch(err => ({ carpeta: e!.carpeta, rellenado: [], coste: null, conSesion: false, error: String(err) })))
        }
      }),
    )
    const resumen = resumenFichas(resultados, modo)
    await apuntar($, config, `/fichas${modo === 'actualizar' ? ' actualizar' : ''} · ${resumen}`).catch(() => undefined)
    try {
      $.ui.toast(`Fichas: ${resumen}`)
    } catch {
      // sin pantalla: queda en el registro
    }
  } finally {
    await borrar($, cerrojo).catch(() => undefined)
  }
}

function lanzar($: EngineInterface, config: Config, entradas: readonly Entrada[], cerrojo: string, modo: Modo): void {
  $.clock.after(50, () => {
    void rellenarEnFondo($, config, entradas, cerrojo, modo).catch(() => undefined)
  })
}

/**
 * Si merece la pena preguntar. «Bloqueos: (ninguno)» es también una respuesta
 * válida, así que solo se rellena si ya se pregunta por otra cosa.
 */
export function faltaAlgo(texto: string): boolean {
  return huecos(texto).some(h => h !== 'Bloqueos')
}

export async function fichas($: EngineInterface, args: string): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: ejecuta /configurar en tu carpeta de control.'
  const cerrojo = unir(config.general_dir, '.agentos', 'fichas.en-curso')
  const desde = Number((await leerTexto($, cerrojo)) ?? '')
  if (Number.isFinite(desde) && desde > 0 && Date.now() - desde < CERROJO_MS) return 'Ya estoy con las fichas: te aviso al acabar.'
  // `actualizar` puede ir antes o después del proyecto: /fichas actualizar · /fichas struo actualizar.
  const palabras = args.trim().split(/\s+/).filter(Boolean)
  const modo: Modo = palabras.some(p => p.toLowerCase() === 'actualizar') ? 'actualizar' : 'rellenar'

  const entradas = await seguimiento($, config)
  if (entradas.length === 0) return 'No hay proyectos en seguimiento: muévelos a «Hacer seguimiento» en PROYECTOS.md.'
  let candidatas: Entrada[]
  const nombre = palabras.filter(p => p.toLowerCase() !== 'actualizar').join(' ')
  if (nombre !== '') {
    const e = buscarEntrada(entradas, nombre)
    if (e === null) return `¿Qué proyecto? Uso: /fichas [proyecto] [actualizar]. En seguimiento: ${listaProyectos(entradas)}`
    candidatas = [e]
  } else {
    candidatas = entradas
  }

  if (modo === 'actualizar') return actualizar($, config, candidatas, nombre !== '', cerrojo)

  // Las que faltan se crean primero, como haría /proyectos; las que ya están completas se saltan.
  const pendientes: Entrada[] = []
  for (const e of candidatas) {
    if (!(await existe($, unir(config.raiz_proyectos, e.carpeta)))) continue
    await crearFicha($, config, e)
    const texto = (await leerTexto($, unir(config.general_dir, 'proyectos', ficheroFicha(e.carpeta)))) ?? ''
    if (faltaAlgo(texto)) pendientes.push(e)
  }
  if (pendientes.length === 0) {
    return nombre !== ''
      ? `La ficha de ${candidatas[0]!.carpeta} ya está completa. Para que Claude la rehaga, vacía la sección que quieras y repite /fichas ${candidatas[0]!.carpeta}.`
      : 'Todas las fichas están completas. Para rehacer una, vacía la sección que quieras y usa /fichas <proyecto>.'
  }

  await escribirAtomico($, cerrojo, String(Date.now()))
  lanzar($, config, pendientes, cerrojo, 'rellenar')
  const n = pendientes.length
  return [
    `Rellenando ${n} ${n === 1 ? 'ficha' : 'fichas'} en segundo plano: ${pendientes.map(e => e.carpeta).join(', ')}.`,
    'Cada proyecto lo mira Claude en solo lectura: una bifurcación de su sesión si está en pausa, o un claude -p nuevo en su repo.',
    'Solo relleno lo que está vacío. Cada ficha sale en el panel en cuanto está; al acabar te aviso y lo apunto en el registro.',
  ].join('\n')
}

/** /fichas [proyecto] actualizar: las fichas que tienen tareas, para ponerlas al día. */
async function actualizar($: EngineInterface, config: Config, candidatas: readonly Entrada[], uno: boolean, cerrojo: string): Promise<string> {
  const conTareas: Entrada[] = []
  for (const e of candidatas) {
    const texto = await leerTexto($, unir(config.general_dir, 'proyectos', ficheroFicha(e.carpeta)))
    if (texto !== undefined && tareasDeFicha(texto).length > 0) conTareas.push(e)
  }
  if (conTareas.length === 0) {
    return uno
      ? `La ficha de ${candidatas[0]!.carpeta} no tiene tareas que poner al día: usa /fichas ${candidatas[0]!.carpeta} para que Claude las proponga.`
      : 'Ninguna ficha tiene tareas todavía: usa /fichas para que Claude las proponga.'
  }
  await escribirAtomico($, cerrojo, String(Date.now()))
  lanzar($, config, conTareas, cerrojo, 'actualizar')
  const n = conTareas.length
  return [
    `Poniendo al día ${n} ${n === 1 ? 'ficha' : 'fichas'} en segundo plano: ${conTareas.map(e => e.carpeta).join(', ')}.`,
    'Claude mira cada proyecto en solo lectura y marca como hechas las tareas que ya lo estén. No desmarca nada ni cambia el texto de las tareas.',
    'El estado y la fase solo se reescriben si están vacíos o los escribió Claude. El porcentaje se actualiza en el panel en cuanto cada ficha está; al acabar te aviso.',
  ].join('\n')
}

/**
 * Para /cierre: pone al día, en segundo plano, las fichas (con tareas) de los
 * proyectos que se tocaron hoy. Devuelve la línea que lo cuenta, o '' si no hay nada.
 */
export async function actualizarTocados($: EngineInterface, config: Config, carpetas: readonly string[]): Promise<string> {
  if (carpetas.length === 0) return ''
  const cerrojo = unir(config.general_dir, '.agentos', 'fichas.en-curso')
  const desde = Number((await leerTexto($, cerrojo)) ?? '')
  if (Number.isFinite(desde) && desde > 0 && Date.now() - desde < CERROJO_MS) return 'Las fichas ya se están poniendo al día.'
  const nombres = new Set(carpetas.map(c => c.toLowerCase()))
  const conTareas: Entrada[] = []
  for (const e of await seguimiento($, config)) {
    if (!nombres.has(e.carpeta.toLowerCase())) continue
    const texto = await leerTexto($, unir(config.general_dir, 'proyectos', ficheroFicha(e.carpeta)))
    if (texto !== undefined && tareasDeFicha(texto).length > 0) conTareas.push(e)
  }
  if (conTareas.length === 0) return ''
  await escribirAtomico($, cerrojo, String(Date.now()))
  lanzar($, config, conTareas, cerrojo, 'actualizar')
  return `Pongo al día las fichas de ${conTareas.map(e => e.carpeta).join(', ')} (tareas hechas y estado), en segundo plano: te aviso al acabar.`
}
