import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PROMPT_FICHA, resumenFichas } from '../lib/comandos/fichas.ts'
import { estadoInicial } from '../lib/estado.ts'
import { huecos, interpretarPropuesta, rellenarFicha } from '../lib/fichas.ts'
import { interpretarFicha } from '../lib/panel-datos.ts'
import { crearSistema, instalarSistema, PLANTILLAS } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const PLANTILLA = [
  '---',
  'codigo: STR',
  'fase:',
  '---',
  '# struo',
  'Objetivo: (por definir)',
  '',
  '## Estado',
  'Dos o tres líneas, como mucho.',
  '',
  '## Tareas',
  '<!-- Una casilla por tarea: «- [ ] pendiente» o «- [x] hecha». El progreso sale de aquí. -->',
  '',
  '## Bloqueos',
  '- (ninguno)',
  '',
  '## Próximos pasos',
  '1. …',
  '',
].join('\n')

const RESPUESTA = {
  fase: 'MVP',
  objetivo: 'Un gestor de tareas para equipos pequeños.',
  estado: 'El backend está hecho.\nFalta el panel.',
  tareas: [
    { texto: 'API de tareas', hecha: true },
    { texto: '- [ ] Autenticación', hecha: true },
    { texto: 'Panel web', hecha: false },
    { texto: 'Desplegar', hecha: false },
  ],
  bloqueos: [],
  proximos: ['Terminar el panel', 'Probar con usuarios'],
}

describe('la propuesta de Claude', () => {
  test('saca el JSON aunque venga entre ``` y limpia viñetas y casillas', () => {
    const p = interpretarPropuesta(`Aquí tienes:\n\`\`\`json\n${JSON.stringify(RESPUESTA)}\n\`\`\``)
    expect(p?.fase).toBe('MVP')
    expect(p?.tareas[1]).toEqual({ texto: 'Autenticación', hecha: true })
    expect(p?.estado).toBe('El backend está hecho.\nFalta el panel.')
    expect(interpretarPropuesta('no sé')).toBeNull()
    expect(interpretarPropuesta('{"fase":"MVP"}')).toBeNull()
  })

  test('una ficha recién creada tiene todo por rellenar', () => {
    expect(huecos(PLANTILLA)).toEqual(['fase', 'objetivo', 'Estado', 'Tareas', 'Bloqueos', 'Próximos pasos'])
  })

  test('rellena los huecos y el progreso sale de las casillas', () => {
    const r = rellenarFicha(PLANTILLA, interpretarPropuesta(JSON.stringify(RESPUESTA))!, '2026-10-31')
    expect(r.rellenado).toEqual(['fase', 'objetivo', 'Estado', 'Tareas', 'Próximos pasos'])
    expect(r.texto).toContain('fase: MVP\n---')
    expect(r.texto).toContain('Objetivo: Un gestor de tareas para equipos pequeños. (propuesto por Claude)')
    expect(r.texto).toContain('## Estado\nEl backend está hecho.\nFalta el panel.\n_(propuesto por Claude el 2026-10-31)_\n\n## Tareas')
    expect(r.texto).toContain('El progreso sale de aquí. -->\n- [x] API de tareas\n- [x] Autenticación\n- [ ] Panel web\n- [ ] Desplegar\n')
    expect(r.texto).toContain('## Bloqueos\n- (ninguno)\n')
    expect(r.texto).toMatch(/## Próximos pasos\n1\. Terminar el panel\n2\. Probar con usuarios\n$/)
    expect(interpretarFicha('struo', r.texto)).toMatchObject({ fase: 'MVP', tareas: { hechas: 2, total: 4 } })
    // Otra vez: ya no queda nada que rellenar.
    expect(rellenarFicha(r.texto, interpretarPropuesta(JSON.stringify(RESPUESTA))!, '2026-11-01').rellenado).toEqual([])
  })

  test('lo que ya has escrito no se toca', () => {
    const tuya = PLANTILLA.replace('fase:', 'fase: beta').replace('Dos o tres líneas, como mucho.', 'Lo escribí yo.').replace('-->\n', '-->\n- [ ] Mi tarea\n')
    const r = rellenarFicha(tuya, interpretarPropuesta(JSON.stringify(RESPUESTA))!, '2026-10-31')
    expect(r.rellenado).toEqual(['objetivo', 'Próximos pasos'])
    expect(r.texto).toContain('fase: beta')
    expect(r.texto).toContain('## Estado\nLo escribí yo.\n')
    expect(r.texto).toContain('-->\n- [ ] Mi tarea\n\n## Bloqueos')
    expect(r.texto).not.toContain('API de tareas')
  })

  test('el prompt pide JSON y no tocar nada; el resumen cuenta y suma el coste', () => {
    const p = PROMPT_FICHA('struo', '/r/struo', PLANTILLA)
    expect(p).toContain('Responde SOLO con un objeto JSON')
    expect(p).toContain('No modifiques nada')
    expect(p).toContain('Objetivo: (por definir)')
    expect(
      resumenFichas([
        { carpeta: 'a', rellenado: ['Tareas'], error: null, coste: 0.1, conSesion: true },
        { carpeta: 'b', rellenado: [], error: null, coste: 0.05, conSesion: false },
        { carpeta: 'c', rellenado: [], error: 'la respuesta no traía la ficha', coste: null, conSesion: false },
      ]),
    ).toBe('rellenadas: a · sin cambios: b · con error: c (la respuesta no traía la ficha) · $0.15')
  })
})

// ----------------------------------------------------------- de punta a punta

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const AG = `${GENERAL}/.agentos`

function escenario(): SistemaFalso {
  const quieta = estadoInicial({ session_id: 'quieta', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: `${RAIZ}/struo`, rama: 'main', ahora: new Date().toISOString() })
  const s = crearSistema({
    cwd: GENERAL,
    dirs: [GENERAL, `${RAIZ}/struo`, `${RAIZ}/web`, `${AG}/estado`, `${GENERAL}/registro`, `${GENERAL}/proyectos`],
    ficheros: {
      '/home/usuario/.config/huddle/config.json': JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n- web\n- borrado\n## No hacer seguimiento\n- GENERAL\n',
      [`${GENERAL}/proyectos/struo.md`]: PLANTILLA,
      [`${GENERAL}/proyectos/_plantilla.md`]: PLANTILLAS['proyectos/_plantilla.md']!,
      [`${RAIZ}/web/README.md`]: '# Web\n\nLa web de la consulta, hecha con Astro.\n',
      [`${AG}/estado/quieta.json`]: JSON.stringify(quieta),
    },
  })
  s.sesion.id = 'torre'
  s.responder = argv => {
    if (argv[0] === 'claude') {
      const pregunta = argv.at(-1) ?? ''
      const result = pregunta.includes('«web»') ? 'No lo tengo claro.' : JSON.stringify(RESPUESTA)
      return { stdout: JSON.stringify({ result, is_error: false, permission_denials: [], total_cost_usd: 0.02 }) }
    }
    return undefined
  }
  return s
}

async function arrancar($: Engine, on: On, s: SistemaFalso) {
  instalarSistema(on, s)
  const reloj = mock.clock(on, { now: Date.now() })
  const toasts: string[] = []
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: true })
  await reloj.advance(500)
  return { reloj, toasts }
}

async function correr($: Engine, args = ''): Promise<string> {
  const r = await $.command.run({ command: 'fichas', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  return r.text ?? ''
}

describe('/fichas', () => {
  test('crea las que faltan, pregunta en solo lectura y rellena en segundo plano', async ($, on) => {
    const s = escenario()
    const { reloj, toasts } = await arrancar($, on, s)
    const r = await correr($)
    expect(r).toContain('Rellenando 2 fichas en segundo plano: struo, web.')
    expect(s.ficheros.has(`${AG}/fichas.en-curso`)).toBe(true)
    expect(await correr($)).toContain('Ya estoy rellenando fichas')
    for (let i = 0; i < 20 && s.ficheros.has(`${AG}/fichas.en-curso`); i++) await reloj.advance(100)
    expect(s.ficheros.has(`${AG}/fichas.en-curso`)).toBe(false)

    // struo: a una bifurcación de su sesión en pausa; web: claude -p nuevo en su repo.
    const claudes = s.procesos.map((a, i) => ({ a, cwd: s.cwds[i] })).filter(x => x.a[0] === 'claude')
    expect(claudes).toHaveLength(2)
    const struo = claudes.find(x => x.a.at(-1)?.includes('«struo»'))!
    expect(struo.a[struo.a.indexOf('--resume') + 1]).toBe('quieta')
    expect(struo.a).toContain('--fork-session')
    const web = claudes.find(x => x.a.at(-1)?.includes('«web»'))!
    expect(web.a).not.toContain('--resume')
    expect(web.cwd).toBe(`${RAIZ}/web`)

    const ficha = s.ficheros.get(`${GENERAL}/proyectos/struo.md`) ?? ''
    expect(interpretarFicha('struo', ficha)).toMatchObject({ fase: 'MVP', tareas: { hechas: 2, total: 4 } })
    // web no traía JSON: su ficha se creó y se queda como estaba.
    expect(s.ficheros.get(`${GENERAL}/proyectos/web.md`)).toContain('La web de la consulta, hecha con Astro. (propuesto a partir del README)')
    const mes = new Date().toISOString().slice(0, 7)
    expect(s.ficheros.get(`${GENERAL}/registro/${mes}.md`)).toContain('/fichas · rellenadas: struo · con error: web (la respuesta no traía la ficha) · $0.04')
    expect(toasts.at(-1)).toContain('Fichas: rellenadas: struo')

    // Ya completa: no se vuelve a preguntar.
    expect(await correr($, 'struo')).toContain('La ficha de struo ya está completa')
    expect(await correr($, 'nada')).toContain('Uso: /fichas [proyecto]')
  })
})
