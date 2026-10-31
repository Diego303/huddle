// /proyectos: vuelve a escanear la raíz, apunta las carpetas nuevas en
// «Sin clasificar» (nunca mueve nada) y crea las fichas que falten.

import type { EngineInterface } from 'claude-code'

import type { Config } from '../config.ts'
import { estaConfigurada, leerConfig } from '../config.ts'
import { ficheroFicha, LINEAS_README, objetivoDeReadme, rellenar } from '../fichas.ts'
import { escribirAtomico, escribirSiNoExiste, esDirectorio, existe, leerTexto, listarCarpetas, primerasLineas } from '../ficheros.ts'
import { leerPlantillaFicha } from '../plantillas.ts'
import type { Entrada } from '../proyectos.ts'
import { anadirSinClasificar, carpetasDesaparecidas, carpetasNuevas, interpretarProyectos } from '../proyectos.ts'
import { unir } from '../rutas.ts'

export type Escaneo = {
  nuevas: string[]
  desaparecidas: string[]
  fichas: string[]
  sinClasificar: number
  seguimiento: number
  avisos: string[]
}

const README = ['README.md', 'readme.md', 'Readme.md', 'README']

/**
 * Crea la ficha de un proyecto en seguimiento. Es la única vez que se lee algo
 * de dentro del repo: las primeras líneas del README, para proponer el objetivo.
 */
export async function crearFicha($: EngineInterface, config: Config, entrada: Entrada): Promise<boolean> {
  const destino = unir(config.general_dir, 'proyectos', ficheroFicha(entrada.carpeta))
  if (await existe($, destino)) return false
  let objetivo: string | null = null
  for (const nombre of README) {
    const ruta = unir(config.raiz_proyectos, entrada.carpeta, nombre)
    if (!(await existe($, ruta))) continue
    const inicio = await primerasLineas($, ruta, LINEAS_README)
    objetivo = inicio === undefined ? null : objetivoDeReadme(inicio)
    break
  }
  const plantilla = await leerPlantillaFicha($, config.general_dir)
  const texto = rellenar(plantilla, {
    codigo: entrada.codigo,
    nombre: entrada.carpeta,
    objetivo: objetivo ? `${objetivo} (propuesto a partir del README)` : '(por definir)',
  })
  return escribirSiNoExiste($, destino, texto)
}

export async function reescanear($: EngineInterface, config: Config): Promise<Escaneo> {
  const ruta = unir(config.general_dir, 'PROYECTOS.md')
  const texto = await leerTexto($, ruta)
  if (texto === undefined) throw new Error(`no encuentro ${ruta}: ejecuta /configurar`)
  const enDisco = await listarCarpetas($, config.raiz_proyectos)
  const doc = interpretarProyectos(texto)
  const nuevas = carpetasNuevas(doc, enDisco, config.raiz_proyectos)
  if (nuevas.length > 0) await escribirAtomico($, ruta, anadirSinClasificar(texto, nuevas))
  const desaparecidas = carpetasDesaparecidas(doc, enDisco, config.raiz_proyectos)
  const fichas: string[] = []
  for (const entrada of doc.seguimiento) {
    if (desaparecidas.includes(entrada.carpeta)) continue
    if (await crearFicha($, config, entrada)) fichas.push(entrada.carpeta)
  }
  return {
    nuevas,
    desaparecidas,
    fichas,
    sinClasificar: doc.sinClasificar.length + nuevas.length,
    seguimiento: doc.seguimiento.length,
    avisos: doc.avisos,
  }
}

export function describirEscaneo(e: Escaneo): string[] {
  const l: string[] = []
  l.push(
    e.nuevas.length > 0
      ? `${e.nuevas.length} carpeta(s) nueva(s) en «Sin clasificar»: ${e.nuevas.join(', ')}`
      : 'No hay carpetas nuevas.',
  )
  l.push(`${e.seguimiento} en seguimiento · ${e.sinClasificar} sin clasificar`)
  if (e.fichas.length > 0) l.push(`Fichas creadas en proyectos/: ${e.fichas.join(', ')}`)
  if (e.desaparecidas.length > 0) l.push(`Ya no están en la raíz: ${e.desaparecidas.join(', ')}`)
  for (const a of e.avisos) l.push(`Aviso: ${a}`)
  return l
}

export async function proyectos($: EngineInterface): Promise<string> {
  const { config } = await leerConfig($)
  if (!estaConfigurada(config)) return 'Huddle aún no está configurado: abre Claude Code en tu carpeta de control y ejecuta /configurar.'
  if (!(await esDirectorio($, config.raiz_proyectos))) return `No encuentro la raíz ${config.raiz_proyectos}. Cámbiala con /directorio <ruta>.`
  const e = await reescanear($, config)
  return [`Raíz: ${config.raiz_proyectos}`, ...describirEscaneo(e)].join('\n')
}
