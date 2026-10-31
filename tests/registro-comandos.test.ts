// Fuera de la carpeta de control Huddle no añade ningún comando: Claude normal.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const CONFIG = '/home/usuario/.config/huddle/config.json'
const TODOS = ['configurar', 'directorio', 'proyectos', 'panel', 'oficina', 'refresh', 'proyecto', 'preguntar', 'abrir', 'registro', 'cierre']

function sistema(cwd: string, configurado: boolean): SistemaFalso {
  return crearSistema({
    cwd,
    dirs: [GENERAL, `${RAIZ}/struo`, `${GENERAL}/.agentos/estado`],
    ficheros: {
      ...(configurado ? { [CONFIG]: JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }) } : {}),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo\n',
    },
  })
}

async function arrancar($: Engine, on: On, s: SistemaFalso, interactiva = true) {
  instalarSistema(on, s)
  const reloj = mock.clock(on, { now: Date.now() })
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: interactiva })
  await reloj.advance(500)
  return reloj
}

describe('dónde aparecen los comandos', () => {
  test('en un proyecto cualquiera, ninguno', async ($, on) => {
    const s = sistema(`${RAIZ}/struo`, true)
    await arrancar($, on, s)
    expect(s.comandos).toEqual([])
  })

  test('en una sesión no interactiva, ninguno', async ($, on) => {
    const s = sistema(GENERAL, true)
    await arrancar($, on, s, false)
    expect(s.comandos).toEqual([])
  })

  test('en la carpeta de control, todos', async ($, on) => {
    const s = sistema(GENERAL, true)
    await arrancar($, on, s)
    expect([...s.comandos].sort()).toEqual([...TODOS].sort())
  })

  test('sin configurar, solo /configurar; y al configurar, la sesión pasa a ser la torre', async ($, on) => {
    const s = sistema(GENERAL, false)
    s.respuestaAsk = null
    const reloj = await arrancar($, on, s)
    expect(s.comandos).toEqual(['configurar'])
    const r = await $.command.run({ command: 'configurar', args: RAIZ, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toContain('Carpeta de control')
    await reloj.advance(500)
    expect([...s.comandos].sort()).toEqual([...TODOS].sort())
  })
})
