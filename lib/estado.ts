// El estado de una sesión (§2.6–2.8 del plan) y cómo cambia con cada evento.
// Es una función pura: los hooks traducen los eventos del motor a `Evento` y
// aplican `aplicar`; los tests hacen lo mismo con los payloads capturados.

import type { Atasco } from './atascos.ts'
import { detalleDeHerramienta, esHerramientaDeAgente, recortar, tipoDeAgente } from './detalle.ts'

export type EstadoNombre = 'trabajando' | 'te_espera' | 'en_pausa'
export type TipoSesion = 'torre' | 'proyecto' | 'otros'

export type Agente = {
  /** El `tool_use_id` de la llamada a Agent, si la hubo. */
  tool_use_id: string | null
  /** El id del motor (`agentId` / `agent_id`), cuando se conoce. */
  agent_id: string | null
  tipo: string
  descripcion: string
  inicio: string
  estado: EstadoNombre
  detalle: string
}

/** El atasco de una sesión, como se guarda en su estado. `id`: corto, para ignorarlo desde la web. */
export type AtascoSesion = Atasco & { id: string; avisado: boolean; ignorado: boolean }

export type VentanaUso = { pct: number; reinicia: string | null }

export type Uso = {
  cinco_horas: VentanaUso | null
  semana: VentanaUso | null
  /** Cuándo se leyó (ISO). */
  leido: string
}

export type EstadoSesion = {
  version: 1
  session_id: string
  tipo: TipoSesion
  proyecto: string
  codigo: string
  cwd: string
  rama: string | null
  estado: EstadoNombre
  detalle: string
  inicio: string
  ultimo_evento: string
  te_espera_desde: string | null
  contexto_pct: number | null
  contexto_tokens: number | null
  ventana: number | null
  modelo: string | null
  transcript_path: string | null
  agentes: Agente[]
  uso: Uso | null
  /** Lo que detecta lib/atascos (null si no hay). */
  atasco?: AtascoSesion | null
  /** Cuántas tareas le has dado (prompts tuyos): un atasco ignorado vale hasta la siguiente. */
  tarea?: number
}

/** Lo que interesa de `$.agent.list()`. */
export type AgenteMotor = { id: string; type: string; description: string; status: string }

/** Lo que interesa de `$.session.usage()`. */
export type UsoMotor = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}

export type Evento =
  | { tipo: 'turno_inicio'; agentId?: string }
  | { tipo: 'turno_fin'; agentId?: string }
  | { tipo: 'herramienta_inicio'; tool: string; entrada: Record<string, unknown>; tool_use_id: string; agentId?: string }
  | {
      tipo: 'herramienta_fin'
      tool: string
      tool_use_id: string
      agentId?: string
      /** El `agentId` que devuelve Agent cuando el subagente sigue en segundo plano. */
      agenteLanzado?: string
      /** Agent terminó (no en segundo plano) o falló. */
      agenteTerminado?: boolean
    }
  | { tipo: 'permiso'; tool: string; agentId?: string }
  | { tipo: 'notificacion'; notificacion: string }
  | { tipo: 'permiso_resuelto' }
  | { tipo: 'subagente_inicio'; agentId: string; agentType: string }
  | { tipo: 'subagente_fin'; agentId: string }
  | { tipo: 'agentes'; lista: readonly AgenteMotor[] }
  | { tipo: 'uso'; uso: UsoMotor; modelo?: string }
  | { tipo: 'compactado' }
  | { tipo: 'modelo'; modelo: string }

/** Las notificaciones que significan que la sesión espera a la persona. */
export const NOTIFICACIONES_DE_ESPERA = new Set(['permission_prompt', 'elicitation_dialog'])

const TERMINADOS = new Set(['completed', 'failed', 'killed'])

export function estadoInicial(base: {
  session_id: string
  tipo: TipoSesion
  proyecto: string
  codigo: string
  cwd: string
  rama: string | null
  ahora: string
  modelo?: string | null
  transcript_path?: string | null
}): EstadoSesion {
  return {
    version: 1,
    session_id: base.session_id,
    tipo: base.tipo,
    proyecto: base.proyecto,
    codigo: base.codigo,
    cwd: base.cwd,
    rama: base.rama,
    estado: 'en_pausa',
    detalle: 'sesión abierta',
    inicio: base.ahora,
    ultimo_evento: base.ahora,
    te_espera_desde: null,
    contexto_pct: null,
    contexto_tokens: null,
    ventana: null,
    modelo: base.modelo ?? null,
    transcript_path: base.transcript_path ?? null,
    agentes: [],
    uso: null,
  }
}

function conAgente(s: EstadoSesion, agentId: string | undefined, f: (a: Agente) => Agente): EstadoSesion {
  if (agentId === undefined) return s
  return { ...s, agentes: s.agentes.map(a => (a.agent_id === agentId ? f(a) : a)) }
}

function pasarA(s: EstadoSesion, estado: EstadoNombre, detalle: string, ahora: string): EstadoSesion {
  return {
    ...s,
    estado,
    detalle,
    te_espera_desde: estado === 'te_espera' ? (s.estado === 'te_espera' ? s.te_espera_desde : ahora) : null,
  }
}

function ventana(uso: UsoMotor, kind: string): VentanaUso | null {
  const v = uso.rateLimits.find(r => r.kind === kind)
  return v ? { pct: v.percentUsed, reinicia: v.resetsAt ?? null } : null
}

/** Los periodos de 5 h y semanal de `$.session.usage()`; null si no hay (sin suscripción). */
export function usoDe(uso: UsoMotor, ahora: string): Uso | null {
  const cinco = ventana(uso, 'five_hour')
  const semana = ventana(uso, 'seven_day')
  return cinco || semana ? { cinco_horas: cinco, semana, leido: ahora } : null
}

export function aplicar(s: EstadoSesion, e: Evento, ahora: string): EstadoSesion {
  const t = { ...s, ultimo_evento: ahora }
  switch (e.tipo) {
    case 'turno_inicio':
      if (e.agentId !== undefined) return conAgente(t, e.agentId, a => ({ ...a, estado: 'trabajando' }))
      return pasarA(t, 'trabajando', 'pensando', ahora)

    case 'turno_fin':
      if (e.agentId !== undefined) return conAgente(t, e.agentId, a => ({ ...a, estado: 'en_pausa', detalle: 'terminado' }))
      return pasarA(t, 'en_pausa', 'turno terminado', ahora)

    case 'herramienta_inicio': {
      const detalle = detalleDeHerramienta(e.tool, e.entrada, s.cwd)
      let u = t
      if (esHerramientaDeAgente(e.tool)) {
        const nuevo: Agente = {
          tool_use_id: e.tool_use_id,
          agent_id: null,
          tipo: tipoDeAgente(typeof e.entrada.subagent_type === 'string' ? e.entrada.subagent_type : undefined),
          descripcion: recortar(typeof e.entrada.description === 'string' ? e.entrada.description : 'subagente'),
          inicio: ahora,
          estado: 'trabajando',
          detalle: 'arrancando',
        }
        u = { ...u, agentes: [...u.agentes.filter(a => a.tool_use_id !== e.tool_use_id), nuevo] }
      }
      if (e.agentId !== undefined) return conAgente(u, e.agentId, a => ({ ...a, estado: 'trabajando', detalle }))
      // Una pregunta del modelo espera a la persona desde que se muestra.
      if (e.tool === 'AskUserQuestion') return pasarA(u, 'te_espera', 'pregunta', ahora)
      return pasarA(u, 'trabajando', detalle, ahora)
    }

    case 'herramienta_fin': {
      let u = t
      if (esHerramientaDeAgente(e.tool)) {
        if (e.agenteLanzado !== undefined && !e.agenteTerminado) {
          const id = e.agenteLanzado
          const ya = u.agentes.some(a => a.agent_id === id)
          u = {
            ...u,
            agentes: ya
              ? u.agentes.filter(a => a.agent_id === id || a.tool_use_id !== e.tool_use_id)
              : u.agentes.map(a => (a.tool_use_id === e.tool_use_id ? { ...a, agent_id: id } : a)),
          }
        } else {
          u = { ...u, agentes: u.agentes.filter(a => a.tool_use_id !== e.tool_use_id) }
        }
      }
      if (e.agentId !== undefined) return conAgente(u, e.agentId, a => ({ ...a, estado: 'trabajando' }))
      return pasarA(u, 'trabajando', s.estado === 'te_espera' ? 'retomando' : u.detalle, ahora)
    }

    case 'permiso': {
      const detalle = e.tool === 'AskUserQuestion' ? 'pregunta' : `permiso: ${recortar(e.tool, 40)}`
      const u = conAgente(t, e.agentId, a => ({ ...a, estado: 'te_espera', detalle }))
      return pasarA(u, 'te_espera', e.agentId !== undefined ? `subagente pide ${detalle}` : detalle, ahora)
    }

    case 'notificacion':
      if (!NOTIFICACIONES_DE_ESPERA.has(e.notificacion)) return s
      return t.estado === 'te_espera' ? t : pasarA(t, 'te_espera', 'te espera', ahora)

    case 'permiso_resuelto':
      return t.estado === 'te_espera' ? pasarA(t, 'trabajando', 'retomando', ahora) : t

    case 'subagente_inicio': {
      if (t.agentes.some(a => a.agent_id === e.agentId)) return t
      const tipo = tipoDeAgente(e.agentType)
      // El primero del mismo tipo que aún no tiene id (orden FIFO).
      const i = t.agentes.findIndex(a => a.agent_id === null && a.tipo === tipo)
      if (i >= 0) return { ...t, agentes: t.agentes.map((a, j) => (j === i ? { ...a, agent_id: e.agentId } : a)) }
      const nuevo: Agente = {
        tool_use_id: null,
        agent_id: e.agentId,
        tipo,
        descripcion: tipo,
        inicio: ahora,
        estado: 'trabajando',
        detalle: 'arrancando',
      }
      return { ...t, agentes: [...t.agentes, nuevo] }
    }

    case 'subagente_fin':
      return { ...t, agentes: t.agentes.filter(a => a.agent_id !== e.agentId) }

    case 'agentes': {
      // Reconciliación con la lista oficial: fuera los terminados; dentro los que faltan.
      const porId = new Map(e.lista.map(a => [a.id, a]))
      const vivos = t.agentes.filter(a => {
        if (a.agent_id === null) return true
        const m = porId.get(a.agent_id)
        return m === undefined ? false : !TERMINADOS.has(m.status)
      })
      const faltan = e.lista
        .filter(a => !TERMINADOS.has(a.status) && !vivos.some(v => v.agent_id === a.id))
        .map(
          (a): Agente => ({
            tool_use_id: null,
            agent_id: a.id,
            tipo: tipoDeAgente(a.type),
            descripcion: recortar(a.description || a.type),
            inicio: ahora,
            estado: a.status === 'idle' || a.status === 'waiting' ? 'en_pausa' : 'trabajando',
            detalle: a.status,
          }),
        )
      return { ...s, agentes: [...vivos, ...faltan] }
    }

    case 'uso': {
      const c = e.uso.context
      const nuevo = usoDe(e.uso, ahora)
      return {
        ...s,
        contexto_pct: c.percent ?? null,
        contexto_tokens: c.tokens ?? null,
        ventana: c.window,
        modelo: e.modelo ?? s.modelo,
        uso: nuevo ?? s.uso,
      }
    }

    case 'compactado':
      return { ...t, contexto_pct: null, contexto_tokens: null }

    case 'modelo':
      return { ...s, modelo: e.modelo }
  }
}
