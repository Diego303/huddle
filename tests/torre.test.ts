// La sesión torre de verdad: lee la carpeta de control (en memoria), publica
// los datos y el motor del kit dibuja el panel en el terminal y en escritorio.

import { describe, expect, mock, test } from 'claude-code/testing'

import { estadoInicial } from '../lib/estado.ts'
import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const ESTADO = `${GENERAL}/.agentos/estado`

function escenario() {
  const otra = {
    ...estadoInicial({ session_id: 'otra', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: `${RAIZ}/struo`, rama: 'feat-x', ahora: new Date().toISOString() }),
    estado: 'te_espera' as const,
    detalle: 'permiso: Write',
    te_espera_desde: new Date().toISOString(),
  }
  const s = crearSistema({
    cwd: GENERAL,
    dirs: [GENERAL, `${RAIZ}/struo`, ESTADO, `${GENERAL}/proyectos`],
    ficheros: {
      '/home/usuario/.config/huddle/config.json': JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n## Sin clasificar\n- nueva\n',
      [`${GENERAL}/proyectos/struo.md`]: '---\ncodigo: STR\nfase: ola 3\n---\n# struo\n## Tareas\n- [x] a\n- [ ] b\n',
      [`${GENERAL}/ESTADO.md`]: '# Estado\n## Hoy\n- [x] uno\n- [ ] dos\n## Siguiente acción\n1. Aprobar el permiso de struo\n',
      [`${ESTADO}/otra.json`]: JSON.stringify(otra),
      [`${ESTADO}/rota.json`]: '{"version": 1, "sess',
    },
  })
  s.sesion.id = 'torre'
  return s
}

function props(columnas: number, filas: number) {
  return {
    plugin: 'huddle',
    component: 'Pane',
    requestId: 'huddle',
    props: { title: 'Huddle', isFocused: false, bodyColumns: columnas, placement: 'dock', scroll: { offset: 0, bodyRows: filas }, view: {} },
  } as const
}

describe('la torre', () => {
  test('abre el panel y lo dibuja en terminal y escritorio con los datos de las otras sesiones', async ($, on) => {
    const s = escenario()
    instalarSistema(on, s)
    const reloj = mock.clock(on, { now: Date.now() })
    let abierto = 0
    on('classic.*', () => ({}))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('ui.open', () => {
      abierto += 1
      return { value: { isPlaced: true } }
    })
    await $.classic.SessionStart({ source: 'startup', session_id: 'torre', cwd: GENERAL, transcript_path: '/t.jsonl' })
    await $.session.start({ cwd: GENERAL, surface: 'terminal', isInteractive: true })
    await reloj.advance(2500)
    expect(abierto).toBe(1)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...props(89, 46), surface })
      for (const t of [/Ejecutándose ahora/, /struo · feat-x/, /permiso: Write/, /GENERAL · torre/, /ola 3 · 1\/2/, /Tareas hoy/, /Aprobar el permiso de struo/, /te espera/, /^ Panel $/, /^ Oficina $/]) {
        expect(await ui.find({ type: 'Text', text: t }), `${surface}: ${t}`).toBeDefined()
      }
      await ui.unmount()
    }

    // Las teclas: o → oficina, a → modo agentes, p → panel.
    const ui = await $.ui.mount({ ...props(89, 46), surface: 'terminal' })
    await ui.press({ key: 'vista-oficina' })
    await ui.unmount()
    const oficina = await $.ui.mount({ ...props(89, 46), surface: 'terminal' })
    expect(await oficina.find({ type: 'Text', text: / oficina/ })).toBeDefined()
    expect(await oficina.find({ type: 'Text', text: /^ Sesiones $/ })).toBeDefined()
    expect(await oficina.find({ type: 'Text', text: /╭─ struo / })).toBeDefined()
    await oficina.press({ key: 'modo-agentes' })
    await oficina.unmount()
    const agentes = await $.ui.mount({ ...props(89, 46), surface: 'desktop' })
    expect(await agentes.find({ type: 'Text', text: /^ Agentes $/ })).toBeDefined()
    expect(await agentes.find({ type: 'Text', text: /STR-lead-01/ })).toBeDefined()
    await agentes.press({ key: 'vista-panel' })
    await agentes.unmount()

    // /oficina sesiones desde el prompt cambia de vista y de modo sin reiniciar nada.
    const r = await $.command.run({ command: 'oficina', args: 'sesiones', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toBe('Oficina · sesiones.')
    const otra = await $.ui.mount({ ...props(89, 46), surface: 'terminal' })
    expect(await otra.find({ type: 'Text', text: /struo·feat-x/ })).toBeDefined()
    await otra.unmount()
    const p = await $.command.run({ command: 'panel', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(p.text).toBe('Panel.')
    const mal = await $.command.run({ command: 'oficina', args: 'todo', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(mal.text).toContain('Uso: /oficina')

    // La disposición ancha también se dibuja sin que el motor la rechace.
    const ancho = await $.ui.mount({ ...props(150, 40), surface: 'terminal' })
    expect(await ancho.find({ type: 'Text', text: /Progreso por proyecto/ })).toBeDefined()
    await ancho.unmount()
  })

  test('/panel fuera de la carpeta de control lo explica', async ($, on) => {
    const s = escenario()
    s.cwd = `${RAIZ}/struo`
    instalarSistema(on, s)
    on('classic.*', () => ({}))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: true })
    const r = await $.command.run({ command: 'panel', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toContain('solo se abre en la carpeta de control')
  })
})
