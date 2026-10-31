import { describe, expect, test } from 'claude-code/testing'

import type { EstadoSesion, Evento } from '../lib/estado.ts'
import { aplicar, estadoInicial } from '../lib/estado.ts'

const T = '2026-10-31T00:46:12+01:00'

function base(): EstadoSesion {
  return estadoInicial({ session_id: 's', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: '/r/struo', rama: 'main', ahora: T })
}

function tras(...eventos: Evento[]): EstadoSesion {
  return eventos.reduce((s, e) => aplicar(s, e, T), base())
}

describe('estado de una sesión', () => {
  test('una pregunta del modelo espera desde que se muestra y sigue al responderla', () => {
    const s = tras({ tipo: 'herramienta_inicio', tool: 'AskUserQuestion', entrada: { questions: [] }, tool_use_id: 'q' })
    expect(s).toMatchObject({ estado: 'te_espera', detalle: 'pregunta', te_espera_desde: T })
    expect(aplicar(s, { tipo: 'herramienta_fin', tool: 'AskUserQuestion', tool_use_id: 'q' }, T)).toMatchObject({ estado: 'trabajando', te_espera_desde: null })
  })

  test('solo las notificaciones de permiso o pregunta ponen en espera', () => {
    for (const n of ['idle_prompt', 'plugin_notification', 'auth_success']) {
      expect(tras({ tipo: 'notificacion', notificacion: n }).estado).toBe('en_pausa')
    }
    expect(tras({ tipo: 'notificacion', notificacion: 'permission_prompt' }).estado).toBe('te_espera')
    expect(tras({ tipo: 'notificacion', notificacion: 'elicitation_dialog' }).estado).toBe('te_espera')
  })

  test('te_espera_desde se conserva mientras dure la espera', () => {
    const s = tras({ tipo: 'permiso', tool: 'Bash' })
    const luego = aplicar(s, { tipo: 'notificacion', notificacion: 'permission_prompt' }, '2026-10-31T00:47:00+01:00')
    expect(luego.te_espera_desde).toBe(T)
  })

  test('un permiso pedido dentro de un subagente pone en espera al subagente y a la sesión', () => {
    const s = tras(
      { tipo: 'herramienta_inicio', tool: 'Agent', entrada: { description: 'tests', subagent_type: 'general-purpose' }, tool_use_id: 'u1' },
      { tipo: 'herramienta_fin', tool: 'Agent', tool_use_id: 'u1', agenteLanzado: 'a1', agenteTerminado: false },
      { tipo: 'permiso', tool: 'Bash', agentId: 'a1' },
    )
    expect(s).toMatchObject({ estado: 'te_espera', detalle: 'subagente pide permiso: Bash' })
    expect(s.agentes[0]).toMatchObject({ agent_id: 'a1', estado: 'te_espera' })
  })

  test('SubagentStart empareja por tipo y en orden con los lanzados sin id', () => {
    const s = tras(
      { tipo: 'herramienta_inicio', tool: 'Agent', entrada: { description: 'uno', subagent_type: 'Explore' }, tool_use_id: 'u1' },
      { tipo: 'herramienta_inicio', tool: 'Task', entrada: { description: 'dos', subagent_type: 'Explore' }, tool_use_id: 'u2' },
      { tipo: 'subagente_inicio', agentId: 'a1', agentType: 'Explore' },
      { tipo: 'subagente_inicio', agentId: 'a2', agentType: 'Explore' },
    )
    expect(s.agentes.map(a => [a.descripcion, a.agent_id])).toEqual([
      ['uno', 'a1'],
      ['dos', 'a2'],
    ])
  })

  test('un Agent que termina (no en segundo plano) o falla se quita', () => {
    const s = tras(
      { tipo: 'herramienta_inicio', tool: 'Agent', entrada: { description: 'x' }, tool_use_id: 'u1' },
      { tipo: 'herramienta_fin', tool: 'Agent', tool_use_id: 'u1', agenteTerminado: true },
    )
    expect(s.agentes).toEqual([])
  })

  test('si SubagentStart llega antes que el resultado de Agent no se duplica', () => {
    const s = tras(
      { tipo: 'herramienta_inicio', tool: 'Agent', entrada: { description: 'x', subagent_type: 'Plan' }, tool_use_id: 'u1' },
      { tipo: 'subagente_inicio', agentId: 'a1', agentType: 'Plan' },
      { tipo: 'herramienta_fin', tool: 'Agent', tool_use_id: 'u1', agenteLanzado: 'a1', agenteTerminado: false },
    )
    expect(s.agentes).toHaveLength(1)
    expect(s.agentes[0]).toMatchObject({ agent_id: 'a1', tipo: 'plan', tool_use_id: 'u1' })
  })

  test('la lista oficial añade los que faltan y quita los terminados', () => {
    const s = tras(
      { tipo: 'subagente_inicio', agentId: 'a1', agentType: 'Explore' },
      {
        tipo: 'agentes',
        lista: [
          { id: 'a1', type: 'Explore', description: 'x', status: 'failed' },
          { id: 'a2', type: 'statusline-setup', description: 'barra de estado', status: 'running' },
          { id: 'a3', type: 'teammate', description: 'compi', status: 'idle' },
        ],
      },
    )
    expect(s.agentes.map(a => [a.agent_id, a.tipo, a.estado])).toEqual([
      ['a2', 'statusline-setup', 'trabajando'],
      ['a3', 'teammate', 'en_pausa'],
    ])
  })

  test('compactar deja el contexto en n/d hasta la siguiente respuesta', () => {
    const s = tras(
      { tipo: 'uso', uso: { context: { tokens: 10, window: 100, percent: 10 }, rateLimits: [] } },
      { tipo: 'compactado' },
    )
    expect(s).toMatchObject({ contexto_pct: null, ventana: 100, uso: null })
  })
})
