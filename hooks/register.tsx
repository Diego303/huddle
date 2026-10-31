// Punto de entrada del mod: registra los comandos y los hooks, y delega en lib/ y mod/.
// Cada hook de estado hace su trabajo en memoria y llama a `next(e)` enseguida;
// si algo falla, su `.catch` deja seguir la cadena como si Huddle no estuviera.

import type { EngineInterface, Register } from 'claude-code'

import { configurar } from '../lib/comandos/configurar.ts'
import { directorio } from '../lib/comandos/directorio.ts'
import { abrir } from '../lib/comandos/abrir.ts'
import { cierre } from '../lib/comandos/cierre.ts'
import { fichas } from '../lib/comandos/fichas.ts'
import { preguntar } from '../lib/comandos/preguntar.ts'
import { proyecto } from '../lib/comandos/proyecto.ts'
import { proyectos } from '../lib/comandos/proyectos.ts'
import { huddle } from '../lib/comandos/web.ts'
import { refresh } from '../lib/comandos/refresh.ts'
import { registro } from '../lib/comandos/registro.ts'
import { esHerramientaDeAgente } from '../lib/detalle.ts'
import {
  anotarOrigen,
  arrancarSesion,
  cambiarDirectorio,
  cerrarSesion,
  contarTokens,
  contarTurno,
  pedirUso,
  registrar,
  situacion,
} from '../lib/sesion.ts'
import { abrirOficina, abrirPanel, esTorre, iniciarTorre, PANEL, pintarPanel } from '../lib/torre.tsx'

/** Un error de un comando se cuenta como su salida, sin romper la sesión. */
function fallo(err: unknown): { text: string } {
  return { text: `Algo falló: ${err instanceof Error ? err.message : String(err)}` }
}

/** Lo que devuelve Agent: el `agentId` si el subagente sigue en segundo plano. */
function lanzamiento(r: unknown): { agenteLanzado?: string; agenteTerminado: boolean } {
  const o = (r ?? {}) as { deny?: unknown; isError?: unknown; result?: { agentId?: unknown; status?: unknown } }
  if (o.deny !== undefined || o.isError === true) return { agenteTerminado: true }
  const id = o.result?.agentId
  const status = String(o.result?.status ?? '')
  if (typeof id === 'string' && status.startsWith('async')) return { agenteLanzado: id, agenteTerminado: false }
  return { agenteTerminado: true }
}

/**
 * Los comandos solo existen donde sirven: todos en la carpeta de control y,
 * mientras Huddle no esté configurado, solo /configurar. En el resto de
 * sesiones Huddle no registra nada: solo anota su estado.
 */
async function registrarComandos($: EngineInterface): Promise<void> {
  const torre = esTorre()
  if (!torre && situacion() !== 'sin_config') return
  await $.command.register({
    name: 'configurar',
    description: 'Huddle: convierte esta carpeta en la carpeta de control',
    argumentHint: '[raíz de proyectos]',
  })
  if (!torre) return
  await $.command.register({
    name: 'directorio',
    description: 'Huddle: cambia el directorio donde viven tus proyectos',
    argumentHint: '<ruta>',
  })
  await $.command.register({
    name: 'proyectos',
    description: 'Huddle: busca carpetas nuevas en tu directorio de proyectos',
  })
  await $.command.register({
    name: 'panel',
    description: 'Huddle: abre el panel de sesiones, agentes y proyectos',
  })
  await $.command.register({
    name: 'oficina',
    description: 'Huddle: tus sesiones o agentes como empleados en sus mesas',
    argumentHint: '[sesiones|agentes]',
  })
  await $.command.register({
    name: 'refresh',
    description: 'Huddle: actualiza git y ESTADO.md, y cuenta qué ha pasado desde la última vez',
    argumentHint: '[solo-datos]',
  })
  await $.command.register({
    name: 'proyecto',
    description: 'Huddle: detalle de un proyecto (ficha, git, sesiones); con «tests», los ejecuta',
    argumentHint: '<nombre> [tests]',
  })
  await $.command.register({
    name: 'preguntar',
    description: 'Huddle: pregunta a la sesión de un proyecto, en solo lectura',
    argumentHint: '<proyecto> "<pregunta>"',
  })
  await $.command.register({
    name: 'fichas',
    description: 'Huddle: Claude rellena lo que falta en las fichas (fase, estado, tareas…), en solo lectura',
    argumentHint: '[proyecto]',
  })
  await $.command.register({
    name: 'abrir',
    description: 'Huddle: abre una pestaña con Claude Code en un proyecto',
    argumentHint: '<proyecto>',
  })
  await $.command.register({
    name: 'registro',
    description: 'Huddle: apunta algo en el diario',
    argumentHint: '"<texto>"',
  })
  await $.command.register({
    name: 'huddle',
    description: 'Huddle: «/huddle web» abre la vista web en vivo en el navegador',
    argumentHint: 'web',
  })
  await $.command.register({
    name: 'cierre',
    description: 'Huddle: resumen del día y próximos pasos',
  })
}

/** Arranca Huddle en la sesión: su estado, sus comandos y, en la carpeta de control, el panel. */
async function prepararSesion($: EngineInterface, interactiva: boolean): Promise<void> {
  await arrancarSesion($, interactiva)
  await registrarComandos($).catch(() => undefined)
  await iniciarTorre($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    void prepararSesion($, e.isInteractive)
    return r
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', ($, e, next) => {
    anotarOrigen($, e)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await cerrarSesion($, e.reason)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'composer' && e.command === undefined && e.isMeta !== true) contarTurno($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    registrar($, e.agentId === undefined ? { tipo: 'turno_inicio' } : { tipo: 'turno_inicio', agentId: e.agentId })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    contarTokens($, e.usage)
    if (e.agentId === undefined) {
      registrar($, { tipo: 'turno_fin' })
      if (e.usage?.model) registrar($, { tipo: 'modelo', modelo: e.usage.model })
      pedirUso($, true)
    } else {
      registrar($, { tipo: 'turno_fin', agentId: e.agentId })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const base = e.agentId === undefined ? {} : { agentId: e.agentId }
    registrar($, { tipo: 'herramienta_inicio', tool, entrada: e as Record<string, unknown>, tool_use_id: e.tool_use_id, ...base })
    const r = await next(e)
    registrar($, {
      tipo: 'herramienta_fin',
      tool,
      tool_use_id: e.tool_use_id,
      ...base,
      ...(esHerramientaDeAgente(tool) ? lanzamiento(r) : {}),
    })
    return r
  }).catch(($, e, next) => next(e))

  on('classic.PermissionRequest', ($, e, next) => {
    registrar(
      $,
      e.agent_id === undefined
        ? { tipo: 'permiso', tool: e.tool_name }
        : { tipo: 'permiso', tool: e.tool_name, agentId: e.agent_id },
    )
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Elicitation', ($, e, next) => {
    registrar($, { tipo: 'permiso', tool: `MCP ${e.mcp_server_name}` })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Notification', ($, e, next) => {
    registrar($, { tipo: 'notificacion', notificacion: e.notification_type })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', ($, e, next) => {
    registrar($, { tipo: 'permiso_resuelto' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStart', ($, e, next) => {
    registrar($, { tipo: 'subagente_inicio', agentId: e.agent_id, agentType: e.agent_type })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', ($, e, next) => {
    registrar($, { tipo: 'subagente_fin', agentId: e.agent_id })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostCompact', ($, e, next) => {
    registrar($, { tipo: 'compactado' })
    pedirUso($, false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.CwdChanged', ($, e, next) => {
    void cambiarDirectorio($, e.new_cwd)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'configurar' }, async ($, e) => {
    try {
      const texto = await configurar($, e.args ?? '')
      // Recién configurado en esta carpeta: la sesión pasa a ser la torre (comandos y panel).
      void prepararSesion($, true)
      return { text: texto }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'directorio' }, async ($, e) => {
    try {
      return { text: await directorio($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'panel' }, async $ => {
    try {
      return { text: await abrirPanel($) }
    } catch (err) {
      return fallo(err)
    }
  })

  on('command.run', { command: 'refresh' }, async ($, e) => {
    try {
      return { text: await refresh($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'proyecto' }, async ($, e) => {
    try {
      return { text: await proyecto($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'preguntar' }, async ($, e) => {
    try {
      return { text: await preguntar($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'fichas' }, async ($, e) => {
    try {
      return { text: await fichas($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'abrir' }, async ($, e) => {
    try {
      return { text: await abrir($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'registro' }, async ($, e) => {
    try {
      return { text: await registro($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'huddle' }, async ($, e) => {
    try {
      return { text: await huddle($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })
  on('command.run', { command: 'cierre' }, async $ => {
    try {
      return { text: await cierre($) }
    } catch (err) {
      return fallo(err)
    }
  })

  on('command.run', { command: 'oficina' }, async ($, e) => {
    try {
      return { text: await abrirOficina($, e.args ?? '') }
    } catch (err) {
      return fallo(err)
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, ($, e) => pintarPanel($, e))

  on('command.run', { command: 'proyectos' }, async $ => {
    try {
      return { text: await proyectos($) }
    } catch (err) {
      return fallo(err)
    }
  })
}
