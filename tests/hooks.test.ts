// Los hooks de estado de principio a fin: el motor del kit dispara los eventos
// en el orden que se vio en las sesiones reales (tests/fixtures/eventos/) y se
// lee lo que Huddle escribe en .agentos/.

import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { EstadoSesion } from '../lib/estado.ts'
import { diaLocal } from '../lib/tiempo.ts'
import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const REPO = `${RAIZ}/struo`
const WT = `${RAIZ}/struo-wt/feat-x`
const CONFIG = '/home/usuario/.config/huddle/config.json'
const ESTADO = `${GENERAL}/.agentos/estado`

/** Un transcript: un mensaje en dos bloques (mismo id, mismo usage) y otro; el segundo sin terminar de escribir. */
const uso = (id: string, n: number, ts = '2026-10-31T00:00:05Z') =>
  `${JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: { input_tokens: n, output_tokens: 0, cache_read_input_tokens: 999, cache_creation_input_tokens: 0 } } })}\n`
const COMPLETO = `${uso('m1', 2)}${uso('m1', 2)}${JSON.stringify({ type: 'user', message: { content: 'secreto' } })}\n${uso('m2', 30)}`
const TRANSCRIPT = `${COMPLETO}{"type":"assistant","timestamp":"2026-10-31T00:00:09Z","message":{"id":"m3","usa`

function escenario(cwd = WT): SistemaFalso {
  const s = crearSistema({
    cwd,
    dirs: [GENERAL, REPO, `${REPO}/.git`, WT, `${GENERAL}/.agentos/estado`],
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    ficheros: {
      [CONFIG]: JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n## No hacer seguimiento\n- GENERAL\n',
      [`${REPO}/.git/HEAD`]: 'ref: refs/heads/main\n',
      [`${WT}/.git`]: `gitdir: ${REPO}/.git/worktrees/feat-x\n`,
      [`${REPO}/.git/worktrees/feat-x/HEAD`]: 'ref: refs/heads/feat-x\n',
      '/t/x.jsonl': TRANSCRIPT,
    },
  })
  s.sesion.repo = REPO
  s.sesion.id = 'sesion-1'
  return s
}

type Reloj = ReturnType<typeof mock.clock>
type Respuesta = (e: { tool: string }) => unknown | Promise<unknown>

async function arrancar(
  $: Engine,
  on: On,
  s: SistemaFalso,
  interactiva = true,
  herramientas: Record<string, Respuesta> = {},
): Promise<Reloj> {
  instalarSistema(on, s)
  const reloj = mock.clock(on, { now: Date.parse('2026-10-31T00:00:00Z') })
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', async (_, e) => {
    const r = herramientas[String(e.tool)]
    return (r ? await r(e) : { result: { ok: true }, text: 'hecho' }) as never
  })
  await $.classic.SessionStart({ source: 'startup', session_id: s.sesion.id, cwd: s.cwd, transcript_path: '/t/x.jsonl' })
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: interactiva })
  await reloj.advance(500)
  return reloj
}

function leerEstado(s: SistemaFalso, id = 'sesion-1'): EstadoSesion | undefined {
  const t = s.ficheros.get(`${ESTADO}/${id}.json`)
  return t === undefined ? undefined : (JSON.parse(t) as EstadoSesion)
}

const turno = { turnId: 't1', text: '' }
const fin = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' as const }

describe('hooks de estado', () => {
  test('una sesión en un worktree cuenta en su repo, con su rama', async ($, on) => {
    const s = escenario()
    await arrancar($, on, s)
    const e = leerEstado(s)
    expect(e).toMatchObject({
      session_id: 'sesion-1',
      tipo: 'proyecto',
      proyecto: 'struo',
      codigo: 'STR',
      cwd: WT,
      rama: 'feat-x',
      estado: 'en_pausa',
      transcript_path: '/t/x.jsonl',
      ventana: 1000000,
      contexto_pct: null,
    })
    expect(e?.inicio).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+01:00$/)
    // Para saber el proyecto y la rama solo se ha leído .git: nada del código.
    expect(s.tocadas.filter(r => r.startsWith(REPO) && !r.includes('/.git'))).toEqual([])
  })

  test('trabajando → te espera → trabajando → en pausa, con un aviso de Windows', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s)

    await $.turn.start(turno)
    await $.tool.call({ tool: 'Edit', file_path: `${WT}/src/auth.ts`, old_string: 'secreto', new_string: 'otro' })
    await reloj.advance(200)
    expect(leerEstado(s)).toMatchObject({ estado: 'trabajando', detalle: 'editando src/auth.ts' })
    expect(JSON.stringify(leerEstado(s))).not.toContain('secreto')

    await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: { file_path: '/x', content: 'privado' } })
    await reloj.advance(200)
    expect(leerEstado(s)).toMatchObject({ estado: 'te_espera', detalle: 'permiso: Write' })
    expect(leerEstado(s)?.te_espera_desde).not.toBeNull()
    expect(s.lanzados).toHaveLength(1)
    expect(s.lanzados[0]?.[0]).toBe('powershell.exe')

    // La notificación llega ~11 s después: no cambia nada ni repite el aviso.
    await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
    await $.classic.Notification({ message: 'x', notification_type: 'idle_prompt' })
    expect(s.lanzados).toHaveLength(1)

    await $.tool.call({ tool: 'Write', file_path: `${WT}/nota.txt`, content: 'privado' })
    await reloj.advance(200)
    expect(leerEstado(s)).toMatchObject({ estado: 'trabajando', te_espera_desde: null })

    s.sesion.uso = {
      startedAt: 0,
      context: { tokens: 480000, window: 1000000, percent: 48 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 64, resetsAt: '2026-10-31T04:30:00.000Z' },
        { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-11-05T08:00:00.000Z' },
      ],
    }
    await $.turn.complete({ ...fin, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } })
    await reloj.advance(200)
    expect(leerEstado(s)).toMatchObject({
      estado: 'en_pausa',
      contexto_pct: 48,
      modelo: 'claude-opus-5-5',
      uso: {
        cinco_horas: { pct: 64, reinicia: '2026-10-31T04:30:00.000Z' },
        semana: { pct: 41, reinicia: '2026-11-05T08:00:00.000Z' },
      },
    })
    expect(JSON.stringify(leerEstado(s))).not.toContain('privado')
    // Los tokens salen del transcript: por hora, sin contar dos veces un mensaje de varios bloques.
    const act = JSON.parse(s.ficheros.get(`${GENERAL}/.agentos/actividad/sesion-1.json`) ?? '{}')
    expect(Object.values(act.tokens ?? {})).toEqual([2 + 30])
    expect(act.transcripts['/t/x.jsonl'].offset).toBe(COMPLETO.length)
  })

  test('un subagente en segundo plano vive hasta SubagentStop, no hasta su PostToolUse', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s, true, {
      Agent: () => ({
        result: { isAsync: true, status: 'async_launched', agentId: 'a1', description: 'usos de token' },
        text: 'lanzado',
      }),
    })

    await $.turn.start(turno)
    await $.tool.call({ tool: 'Agent', description: 'usos de token', prompt: 'busca…', subagent_type: 'Explore' })
    await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'Explore' })
    await $.tool.call({ tool: 'Bash', command: 'cd x && pnpm test --secreto', agentId: 'a1' })
    await reloj.advance(200)
    const e = leerEstado(s)
    expect(e?.agentes).toHaveLength(1)
    expect(e?.agentes[0]).toMatchObject({ agent_id: 'a1', tipo: 'explore', descripcion: 'usos de token', estado: 'trabajando', detalle: 'Bash · pnpm' })
    expect(JSON.stringify(e)).not.toContain('secreto')

    // El turno principal acaba mientras el subagente sigue (lo dice $.agent.list).
    s.sesion.agentes = [{ id: 'a1', type: 'Explore', description: 'usos de token', status: 'running' }]
    await $.turn.complete(fin)
    await reloj.advance(200)
    expect(leerEstado(s)).toMatchObject({ estado: 'en_pausa' })
    expect(leerEstado(s)?.agentes).toHaveLength(1)

    await $.classic.SubagentStop({ agent_id: 'a1', agent_type: 'Explore', stop_hook_active: false, agent_transcript_path: '/t/a1.jsonl' })
    await reloj.advance(200)
    expect(leerEstado(s)?.agentes).toEqual([])
  })

  test('los agentes que el motor da por terminados se quitan al acabar el turno', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s)
    await $.classic.SubagentStart({ agent_id: 'a9', agent_type: 'general-purpose' })
    await reloj.advance(200)
    expect(leerEstado(s)?.agentes[0]).toMatchObject({ agent_id: 'a9', tipo: 'general' })
    s.sesion.agentes = [{ id: 'a9', type: 'general-purpose', description: 'x', status: 'completed' }]
    await $.turn.complete(fin)
    await reloj.advance(200)
    expect(leerEstado(s)?.agentes).toEqual([])
  })

  test('solo cuentan los turnos que teclea la persona', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s)
    await $.prompt.submit({ text: 'hola', wait: false, origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: 'aviso del subagente', wait: false, origin: { kind: 'peer' }, isMeta: true } as never)
    await $.prompt.submit({ text: '/refresh', wait: false, origin: { kind: 'composer' }, command: { name: 'refresh', args: '' } } as never)
    await $.prompt.submit({ text: 'otra', wait: false, origin: { kind: 'composer' } } as never)
    await reloj.advance(200)
    const act = JSON.parse(s.ficheros.get(`${GENERAL}/.agentos/actividad/sesion-1.json`) ?? '{}')
    expect(act).toMatchObject({ session_id: 'sesion-1', proyecto: 'struo', dias: { [diaLocal(Date.now(), 60)]: 2 } })
    expect(s.ficheros.get(`${GENERAL}/.agentos/actividad/sesion-1.json`)).not.toContain('hola')
  })

  test('SessionEnd borra el estado; tras /clear sigue con el id nuevo', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s)
    expect(leerEstado(s)).toBeDefined()

    await $.session.end({ reason: 'clear', sessionId: 'sesion-1', resume: { id: 'sesion-1' } })
    expect(leerEstado(s)).toBeUndefined()
    await $.classic.SessionStart({ source: 'clear', session_id: 'sesion-2', cwd: s.cwd, transcript_path: '/t/y.jsonl' })
    await reloj.advance(500)
    expect(leerEstado(s, 'sesion-2')).toMatchObject({ proyecto: 'struo', transcript_path: '/t/y.jsonl' })

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sesion-2', resume: { id: 'sesion-2' } })
    await $.turn.start(turno)
    await reloj.advance(500)
    expect([...s.ficheros.keys()].filter(f => f.startsWith(ESTADO))).toEqual([])
  })

  test('si la sesión se cierra en mitad de una escritura, el fichero no reaparece', async ($, on) => {
    const s = escenario()
    const reloj = await arrancar($, on, s)
    let soltar: () => void = () => {}
    s.pausa = new Promise<void>(r => {
      soltar = r
    })
    await $.turn.start(turno)
    await reloj.advance(200)
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'sesion-1', resume: { id: 'sesion-1' } })
    s.pausa = null
    soltar()
    await reloj.advance(500)
    expect(leerEstado(s)).toBeUndefined()
  })

  test('la carpeta de control es la torre y lo de fuera de seguimiento va a «otros» sin leer nada', async ($, on) => {
    const torre = escenario(GENERAL)
    torre.sesion.repo = null
    await arrancar($, on, torre)
    expect(leerEstado(torre)).toMatchObject({ tipo: 'torre', proyecto: 'GENERAL', rama: 'torre' })
  })

  test('un repo que no se sigue va a «otros» y no se lee su .git', async ($, on) => {
    const s = escenario(`${RAIZ}/privado/sub`)
    s.dirs.add(`${RAIZ}/privado/sub`)
    s.ficheros.set(`${RAIZ}/privado/.git/HEAD`, 'ref: refs/heads/main\n')
    s.sesion.repo = `${RAIZ}/privado`
    await arrancar($, on, s)
    expect(leerEstado(s)).toMatchObject({ tipo: 'otros', proyecto: 'otros', codigo: 'OTR', rama: null })
    expect(s.tocadas.filter(r => r.startsWith(`${RAIZ}/privado`))).toEqual([])
  })

  test('las sesiones no interactivas (claude -p) no aparecen', async ($, on) => {
    const s = escenario()
    await arrancar($, on, s, false)
    await $.turn.start(turno)
    expect([...s.ficheros.keys()].filter(f => f.startsWith(ESTADO))).toEqual([])
  })

  test('sin config, Huddle no hace nada', async ($, on) => {
    const s = escenario()
    s.ficheros.delete(CONFIG)
    const reloj = await arrancar($, on, s)
    await $.turn.start(turno)
    await reloj.advance(200)
    expect([...s.ficheros.keys()].filter(f => f.includes('.agentos'))).toEqual([])
  })

  test('si el disco falla, la sesión sigue igual', async ($, on) => {
    const s = escenario()
    s.discoRoto = true
    const reloj = await arrancar($, on, s)
    const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(r).toMatchObject({ text: 'hecho' })
    await $.turn.start(turno)
    await reloj.advance(500)
    expect(leerEstado(s)).toBeUndefined()
  })
})
