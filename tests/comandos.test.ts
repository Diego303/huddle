import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { interpretarConfig } from '../lib/config.ts'
import { interpretarProyectos } from '../lib/proyectos.ts'
import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const CONFIG = '/home/usuario/.config/huddle/config.json'

function escenario(): SistemaFalso {
  return crearSistema({
    cwd: GENERAL,
    respuestaAsk: RAIZ,
    dirs: [GENERAL, `${RAIZ}/struo`, `${RAIZ}/web`, `${RAIZ}/privado`, `${RAIZ}/.oculta`],
    ficheros: {
      [`${RAIZ}/struo/README.md`]: '# Struo\n\nMotor de olas para features en paralelo.\n',
      [`${RAIZ}/privado/README.md`]: '# Privado\n\nNo debe leerse nunca.\n',
      [`${RAIZ}/web/index.html`]: '<html></html>',
    },
  })
}

async function arrancar($: Engine, cwd: string): Promise<void> {
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
}

/** Ejecuta un comando como si la persona lo tecleara en el prompt. */
async function correr($: Engine, command: string, args = ''): Promise<string> {
  const r = await $.command.run({
    command,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })
  return r.text ?? ''
}

/** Lo que el mod ha abierto dentro de una carpeta de la raíz. */
function tocadasEn(s: SistemaFalso, carpeta: string): string[] {
  return s.tocadas.filter(r => r.startsWith(`${RAIZ}/${carpeta}/`))
}

describe('comandos de la Fase 1', () => {
  test('/configurar crea la carpeta de control sin abrir los proyectos', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)

    const r = await correr($, 'configurar')
    expect(s.preguntas).toHaveLength(1)
    expect(r).toContain(`Carpeta de control: ${GENERAL}`)
    expect(r).toContain('3 carpeta(s)')

    for (const f of ['ESTADO.md', 'PROYECTOS.md', 'proyectos/_plantilla.md', '.gitignore']) {
      expect(s.ficheros.has(`${GENERAL}/${f}`)).toBe(true)
    }
    for (const d of ['proyectos', 'registro', '.agentos/estado']) expect(s.dirs.has(`${GENERAL}/${d}`)).toBe(true)
    expect(s.ficheros.get(`${GENERAL}/.gitignore`)).toBe('.agentos/\n')

    const doc = interpretarProyectos(s.ficheros.get(`${GENERAL}/PROYECTOS.md`) ?? '')
    expect(doc.raiz).toBe(RAIZ)
    expect(doc.noSeguimiento.map(e => e.carpeta)).toEqual(['GENERAL'])
    expect(doc.sinClasificar.map(e => e.carpeta)).toEqual(['privado', 'struo', 'web'])

    const { config } = interpretarConfig(s.ficheros.get(CONFIG) ?? '')
    expect(config.general_dir).toBe(GENERAL)
    expect(config.raiz_proyectos).toBe(RAIZ)

    // Solo se listó la raíz: no se ha abierto nada de dentro de ningún proyecto.
    for (const c of ['struo', 'web', 'privado']) expect(tocadasEn(s, c)).toEqual([])
    // Ningún temporal de la escritura atómica se queda por ahí.
    expect([...s.ficheros.keys()].filter(f => f.includes('huddle-tmp'))).toEqual([])
  })

  test('/configurar acepta la raíz como argumento y no pregunta', async ($, on) => {
    const s = escenario()
    s.respuestaAsk = null
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    const r = await correr($, 'configurar', 'D:\\huddle-pruebas')
    expect(r).toContain(`Raíz de proyectos: ${RAIZ}`)
    expect(s.preguntas).toEqual([])
  })

  test('/configurar usa la ruta que se escribe a mano', async ($, on) => {
    const s = escenario()
    s.dirs.add('/home/usuario/otros')
    s.respuestaAsk = '~/otros'
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    const r = await correr($, 'configurar')
    expect(r).toContain('Raíz de proyectos: /home/usuario/otros')
  })

  test('/configurar avisa si la raíz no existe', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    const r = await correr($, 'configurar', '/no/existe')
    expect(r).toContain('No encuentro la carpeta /no/existe')
    expect(s.ficheros.has(CONFIG)).toBe(false)
  })

  test('/proyectos apunta las nuevas, crea fichas y no lee lo que no se sigue', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    await correr($, 'configurar')

    // La persona clasifica a mano y aparece una carpeta nueva.
    const editado = (s.ficheros.get(`${GENERAL}/PROYECTOS.md`) ?? '')
      .replace('## Hacer seguimiento\n', '## Hacer seguimiento\n- struo (STR)\n')
      .replace('- GENERAL\n', '- GENERAL\n- privado\n')
      .replace(/- privado\n- struo\n/, '')
    s.ficheros.set(`${GENERAL}/PROYECTOS.md`, editado)
    s.dirs.add(`${RAIZ}/nueva`)
    s.tocadas.length = 0

    const r = await correr($, 'proyectos')
    expect(r).toContain('nueva(s) en «Sin clasificar»: nueva')
    expect(r).toContain('Fichas creadas en proyectos/: struo')

    const texto = s.ficheros.get(`${GENERAL}/PROYECTOS.md`) ?? ''
    expect(texto.startsWith(editado.trimEnd())).toBe(true)
    const doc = interpretarProyectos(texto)
    expect(doc.seguimiento.map(e => e.carpeta)).toEqual(['struo'])
    expect(doc.noSeguimiento.map(e => e.carpeta)).toEqual(['GENERAL', 'privado'])
    expect(doc.sinClasificar.map(e => e.carpeta)).toEqual(['web', 'nueva'])

    const ficha = s.ficheros.get(`${GENERAL}/proyectos/struo.md`) ?? ''
    expect(ficha).toContain('codigo: STR')
    expect(ficha).toContain('Objetivo: Motor de olas para features en paralelo. (propuesto a partir del README)')

    // Lo único que se ha abierto dentro de un proyecto es el README de struo.
    expect(tocadasEn(s, 'privado')).toEqual([])
    expect(tocadasEn(s, 'web')).toEqual([])
    expect(tocadasEn(s, 'nueva')).toEqual([])
    expect(new Set(tocadasEn(s, 'struo'))).toEqual(new Set([`${RAIZ}/struo/README.md`]))

    // La ficha solo se crea una vez: el README no se vuelve a leer.
    s.tocadas.length = 0
    const otra = await correr($, 'proyectos')
    expect(otra).toContain('No hay carpetas nuevas.')
    expect(tocadasEn(s, 'struo')).toEqual([])
  })

  test('/configurar otra vez no pisa lo que ya hay', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    await correr($, 'configurar')
    s.ficheros.set(`${GENERAL}/ESTADO.md`, 'mío')
    s.ficheros.set(`${GENERAL}/.gitignore`, 'node_modules/\n.agentos/\n')
    const r = await correr($, 'configurar')
    expect(r).toContain('PROYECTOS.md ya existía')
    expect(r).toContain('No había nada que crear.')
    expect(s.ficheros.get(`${GENERAL}/ESTADO.md`)).toBe('mío')
    expect(s.ficheros.get(`${GENERAL}/.gitignore`)).toBe('node_modules/\n.agentos/\n')
  })

  test('/directorio cambia la raíz en la config y en PROYECTOS.md', async ($, on) => {
    const s = escenario()
    s.dirs.add('/home/usuario/otros')
    s.dirs.add('/home/usuario/otros/alfa')
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    await correr($, 'configurar')

    const r = await correr($, 'directorio', '~/otros')
    expect(r).toContain(`Raíz cambiada: ${RAIZ} → /home/usuario/otros`)
    expect(r).toContain('alfa')
    expect(interpretarConfig(s.ficheros.get(CONFIG) ?? '').config.raiz_proyectos).toBe('/home/usuario/otros')
    expect(interpretarProyectos(s.ficheros.get(`${GENERAL}/PROYECTOS.md`) ?? '').raiz).toBe('/home/usuario/otros')

    expect(await correr($, 'directorio')).toContain('Raíz actual: /home/usuario/otros')
    expect(await correr($, 'directorio', '/nada')).toContain('No encuentro')
  })

  test('sin configurar, /proyectos y /directorio lo dicen', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await arrancar($, GENERAL)
    expect(await correr($, 'proyectos')).toContain('ejecuta /configurar')
    expect(await correr($, 'directorio', RAIZ)).toContain('ejecuta /configurar')
  })
})
