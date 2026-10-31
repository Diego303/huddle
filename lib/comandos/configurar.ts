// /configurar [raíz]: convierte el directorio de la sesión en la carpeta de
// control. Crea lo que falte (nunca sobrescribe), la config global y el
// .gitignore con .agentos/.

import type { EngineInterface } from 'claude-code'

import { CONFIG_POR_DEFECTO, guardarConfig, leerConfig } from '../config.ts'
import { crearDirectorio, escribirAtomico, escribirSiNoExiste, esDirectorio, leerTexto, listarCarpetas } from '../ficheros.ts'
import { leerPlantilla } from '../plantillas.ts'
import { generarProyectos } from '../proyectos.ts'
import { dentroDe, nombre, normalizar, padre, rutaDeUsuario, unir } from '../rutas.ts'
import { describirEscaneo, reescanear } from './proyectos.ts'

async function preguntarRaiz($: EngineInterface, propuesta: string, home: string, cwd: string): Promise<string | null> {
  try {
    const opciones = propuesta === home ? [propuesta, '/'] : [propuesta, home]
    const r = await $.ui.ask('¿Dónde viven tus proyectos? Si no es ninguna de estas, escribe la ruta.', {
      header: 'Raíz',
      options: opciones,
    })
    return r.trim() ? rutaDeUsuario(r, home, cwd) : null
  } catch {
    // sin nadie a quien preguntar (-p) o si se descarta: se usa la propuesta
    return propuesta
  }
}

/** Añade `.agentos/` al .gitignore de la carpeta de control si no está. */
async function ignorarAgentos($: EngineInterface, dir: string): Promise<boolean> {
  const ruta = unir(dir, '.gitignore')
  const actual = (await leerTexto($, ruta)) ?? ''
  if (actual.split(/\r?\n/).some(l => /^\/?\.agentos\/?$/.test(l.trim()))) return false
  const base = actual === '' || actual.endsWith('\n') ? actual : `${actual}\n`
  await escribirAtomico($, ruta, `${base}.agentos/\n`)
  return true
}

export async function configurar($: EngineInterface, args: string): Promise<string> {
  const home = (await $.env.get('HOME')) ?? '/'
  const general = normalizar(await $.session.cwd())
  const previa = await leerConfig($)

  let raiz: string | null = args.trim() ? rutaDeUsuario(args, home, general) : previa.config.raiz_proyectos || null
  if (raiz === null) raiz = await preguntarRaiz($, padre(general), home, general)
  if (raiz === null) return 'Dime la raíz de tus proyectos: /configurar <ruta>, por ejemplo /configurar /mnt/d/GitHub'
  if (!(await esDirectorio($, raiz))) return `No encuentro la carpeta ${raiz}. Prueba con /configurar <ruta>.`

  const creados: string[] = []
  for (const dir of ['proyectos', 'registro', '.agentos/estado']) await crearDirectorio($, unir(general, dir))
  if (await escribirSiNoExiste($, unir(general, 'ESTADO.md'), await leerPlantilla($, 'ESTADO.md'))) creados.push('ESTADO.md')
  const plantillaFicha = await leerPlantilla($, 'proyectos/_plantilla.md')
  if (await escribirSiNoExiste($, unir(general, 'proyectos', '_plantilla.md'), plantillaFicha)) {
    creados.push('proyectos/_plantilla.md')
  }

  const config = {
    ...CONFIG_POR_DEFECTO,
    ...previa.config,
    general_dir: general,
    raiz_proyectos: raiz,
  }

  const lineas: string[] = []
  const rutaProyectos = unir(general, 'PROYECTOS.md')
  if ((await leerTexto($, rutaProyectos)) === undefined) {
    const carpetas = await listarCarpetas($, raiz)
    const propia = dentroDe(general, raiz) && padre(general) !== general ? [nombre(general)] : []
    const noSeguir = carpetas.filter(c => propia.some(p => p.toLowerCase() === c.toLowerCase()))
    const texto = generarProyectos(await leerPlantilla($, 'PROYECTOS.md'), raiz, carpetas, noSeguir)
    await escribirAtomico($, rutaProyectos, texto)
    creados.push('PROYECTOS.md')
    const pendientes = carpetas.length - noSeguir.length
    lineas.push(`${pendientes} carpeta(s) de ${raiz} en «Sin clasificar».`)
  } else {
    lineas.push('PROYECTOS.md ya existía: lo dejo como está y solo apunto carpetas nuevas.')
    lineas.push(...describirEscaneo(await reescanear($, config)))
  }

  if (await ignorarAgentos($, general)) creados.push('.gitignore (.agentos/)')
  const rutaConfig = await guardarConfig($, config)

  return [
    `Carpeta de control: ${general}`,
    `Raíz de proyectos: ${raiz}`,
    creados.length > 0 ? `Creado: ${creados.join(', ')}` : 'No había nada que crear.',
    ...lineas,
    `Config: ${rutaConfig}`,
    'Siguiente paso: abre PROYECTOS.md y mueve cada carpeta a «Hacer seguimiento» o «No hacer seguimiento»; luego /proyectos.',
  ].join('\n')
}
