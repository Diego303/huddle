// La pestaña Actividad desde los hooks: bitácora, tramos y atascos de una
// sesión de verdad (con el motor del kit), y /huddle ignorar.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { interpretarBitacora } from '../lib/bitacora.ts'
import type { EstadoSesion } from '../lib/estado.ts'
import { diaLocal } from '../lib/tiempo.ts'
import { interpretarTramos } from '../lib/tramos.ts'
import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const REPO = `${RAIZ}/struo`
const AG = `${GENERAL}/.agentos`

function escenario(cwd = REPO): SistemaFalso {
  const s = crearSistema({
    cwd,
    dirs: [GENERAL, REPO, `${REPO}/.git`, `${AG}/estado`],
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    ficheros: {
      '/home/usuario/.config/huddle/config.json': JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n## No hacer seguimiento\n- GENERAL\n',
      [`${REPO}/.git/HEAD`]: 'ref: refs/heads/main\n',
    },
  })
  s.sesion.repo = cwd === REPO ? REPO : null
  s.sesion.id = 'sesion-1'
  return s
}

const FALLO = { result: { stdout: '', stderr: "Error: Cannot find module './i18n'", interrupted: false }, text: "Exit code 1\nError: Cannot find module './i18n'\n    at /home/u/x.js:1:1", isError: true }
const BIEN = { result: { stdout: 'built in 2s', stderr: '', interrupted: false }, text: 'built in 2s' }

async function arrancar($: Engine, on: On, s: SistemaFalso, bash: () => unknown) {
  instalarSistema(on, s)
  const reloj = mock.clock(on, { now: Date.now() })
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', async (_, e) => (String(e.tool) === 'Bash' ? bash() : { result: { type: 'update', structuredPatch: [{ lines: ['+a', '-b', '+c'] }] }, text: 'ok' }) as never)
  await $.classic.SessionStart({ source: 'startup', session_id: 'sesion-1', cwd: s.cwd, transcript_path: '/t/x.jsonl' })
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: true })
  await reloj.advance(500)
  return reloj
}

const estado = (s: SistemaFalso) => JSON.parse(s.ficheros.get(`${AG}/estado/sesion-1.json`) ?? 'null') as EstadoSesion | null
const hoy = () => diaLocal(Date.now(), 60)
const bitacora = (s: SistemaFalso) => interpretarBitacora(s.ficheros.get(`${AG}/bitacora/${hoy()}/sesion-1.jsonl`) ?? '')
const tramos = (s: SistemaFalso) => interpretarTramos(s.ficheros.get(`${AG}/tramos/${hoy()}.jsonl`) ?? '').map(t => t.estado)

describe('pestaña Actividad · desde los hooks', () => {
  test('un comando que falla 3 veces con el mismo error: atasco, un solo aviso, y se limpia al arreglarlo', async ($, on) => {
    const s = escenario()
    let respuesta: unknown = FALLO
    const reloj = await arrancar($, on, s, () => respuesta)
    await $.turn.start({ turnId: 't', text: '' })
    await $.tool.call({ tool: 'Edit', file_path: `${REPO}/src/i18n.ts`, old_string: 'a', new_string: 'b' })
    for (let i = 0; i < 2; i++) await $.tool.call({ tool: 'Bash', command: 'pnpm build' })
    await reloj.advance(200)
    expect(estado(s)?.atasco ?? null).toBeNull()
    const avisosAntes = s.lanzados.length

    await $.tool.call({ tool: 'Bash', command: 'pnpm build' })
    await reloj.advance(200)
    expect(estado(s)?.atasco).toMatchObject({ regla: 'comando', motivo: 'mismo comando falla 3 veces seguidas', prueba: { comando: 'pnpm build', error: "Error: Cannot find module './i18n'" }, avisado: true, ignorado: false })
    expect(s.lanzados.length).toBe(avisosAntes + 1)
    expect(s.lanzados.at(-1)?.[0]).toBe('powershell.exe')

    // El cuarto fallo no vuelve a avisar.
    await $.tool.call({ tool: 'Bash', command: 'pnpm build' })
    await reloj.advance(200)
    expect(s.lanzados.length).toBe(avisosAntes + 1)

    // La bitácora: inicio, la edición con +n −m y cada comando con su error; los tramos, en rojo.
    const b = bitacora(s)
    expect(b.map(l => l.tipo)).toEqual(['start', 'edit', 'bash', 'bash', 'bash', 'bash'])
    expect(b[1]).toMatchObject({ resumen: 'src/i18n.ts (+2 −1)', fichero: 'src/i18n.ts', mas: 2, menos: 1 })
    expect(b[2]).toMatchObject({ resumen: "pnpm build ✗ Error: Cannot find module './i18n'", ok: false })
    expect(new Set(b.slice(2).map(l => l.error_hash)).size).toBe(1)
    expect(tramos(s)).toEqual(['en_pausa', 'trabajando', 'atascada'])

    // Arreglado: el comando funciona y el atasco desaparece solo.
    respuesta = BIEN
    await $.tool.call({ tool: 'Bash', command: 'pnpm build' })
    await reloj.advance(200)
    expect(estado(s)?.atasco ?? null).toBeNull()
    expect(tramos(s)).toEqual(['en_pausa', 'trabajando', 'atascada', 'trabajando'])
    expect(bitacora(s).at(-1)?.resumen).toBe('pnpm build ✓')
  })

  test('un permiso: su línea con el comando (sin secretos) y su tramo de espera', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s, () => BIEN)
    await $.turn.start({ turnId: 't', text: '' })
    await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'TOKEN=abc pnpm deploy' } })
    await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
    await reloj.advance(200)
    expect(bitacora(s).at(-1)).toMatchObject({ tipo: 'perm', resumen: 'Claude needs your permission to use Bash · TOKEN=*** pnpm deploy' })
    expect(tramos(s)).toEqual(['en_pausa', 'trabajando', 'te_espera'])
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sesion-1', resume: { id: 'sesion-1' } })
    expect(bitacora(s).at(-1)?.tipo).toBe('end')
    expect(tramos(s).at(-1)).toBe('cerrada')
    expect(JSON.stringify([...s.ficheros.values()])).not.toContain('abc pnpm')
  })

  test('/huddle ignorar guarda el atasco hasta la siguiente tarea, y la sesión atascada lo recoge', async ($, on) => {
    const torre = escenario(GENERAL)
    const otra = { version: 1, session_id: 'otra', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: REPO, rama: 'main', estado: 'trabajando', detalle: '', inicio: '', ultimo_evento: new Date().toISOString(), te_espera_desde: null, contexto_pct: null, contexto_tokens: null, ventana: null, modelo: null, transcript_path: null, agentes: [], uso: null, tarea: 3, atasco: { regla: 'comando', clave: 'comando:pnpm build:h', desde: '', motivo: 'mismo comando falla 3 veces seguidas', prueba: {}, id: 'abc123', avisado: true, ignorado: false } }
    torre.ficheros.set(`${AG}/estado/otra.json`, JSON.stringify(otra))
    await arrancar($, on, torre, () => BIEN)
    const r = await $.command.run({ command: 'huddle', args: 'ignorar abc123', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toContain('Ignorado en struo · main: mismo comando falla 3 veces seguidas')
    expect(JSON.parse(torre.ficheros.get(`${AG}/atascos-ignorados.json`) ?? '{}').ignorados).toMatchObject([{ session_id: 'otra', clave: 'comando:pnpm build:h', tarea: 3 }])
    const no = await $.command.run({ command: 'huddle', args: 'ignorar nada', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(no.text).toContain('No encuentro el atasco «nada»')
  })

  test('la sesión atascada ve que la ignoraste y vuelve a su color', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s, () => FALLO)
    await $.turn.start({ turnId: 't', text: '' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'pnpm build' })
    await reloj.advance(200)
    const a = estado(s)!.atasco!
    s.ficheros.set(`${AG}/atascos-ignorados.json`, JSON.stringify({ ignorados: [{ session_id: 'sesion-1', clave: a.clave, tarea: 0, ts: '' }] }))
    s.mtimes.set(`${AG}/atascos-ignorados.json`, 123)
    await $.tool.call({ tool: 'Edit', file_path: `${REPO}/a.ts`, old_string: 'a', new_string: 'b' })
    await reloj.advance(200)
    expect(estado(s)?.atasco).toMatchObject({ clave: a.clave, ignorado: true })
    expect(tramos(s).at(-1)).toBe('trabajando')
  })
})
