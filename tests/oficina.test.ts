import { describe, expect, test } from 'claude-code/testing'

import type { EstadoSesion } from '../lib/estado.ts'
import { estadoInicial } from '../lib/estado.ts'
import type { DatosPanel } from '../lib/lector.ts'
import { vistaSesiones } from '../lib/panel-datos.ts'
import { ancho, texto } from '../mod/lienzo.ts'
import { ANCHO_EMPLEADO, colocarSalas, componerOficina, salas, sprite } from '../mod/oficina.ts'

const AHORA = Date.parse('2026-10-31T00:46:00+01:00')

function sesion(id: string, c: Partial<EstadoSesion>): EstadoSesion {
  return {
    ...estadoInicial({ session_id: id, tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: '/r/struo', rama: 'main', ahora: '2026-10-31T00:10:00+01:00' }),
    ultimo_evento: '2026-10-31T00:45:00+01:00',
    ...c,
  }
}

const SESIONES = [
  sesion('a', {
    rama: 'feat-auth',
    estado: 'trabajando',
    detalle: 'editando auth.ts',
    agentes: [
      { tool_use_id: 'u', agent_id: 'x', tipo: 'explore', descripcion: 'usos de token', inicio: '2026-10-31T00:20:00+01:00', estado: 'trabajando', detalle: 'Bash · rg' },
    ],
  }),
  sesion('b', { rama: 'feat-export', estado: 'te_espera', detalle: 'espera GATE#1' }),
  sesion('c', { proyecto: 'proyecto-b', codigo: 'PRB', estado: 'en_pausa', detalle: 'migración v2' }),
  sesion('t', { tipo: 'torre', proyecto: 'GENERAL', codigo: 'GEN', rama: 'torre', estado: 'en_pausa' }),
  sesion('i', { proyecto: 'proyecto-c', codigo: 'PRC', ultimo_evento: '2026-10-30T21:00:00+01:00' }),
]

function datos(sesiones = SESIONES): DatosPanel {
  return {
    generado: AHORA, desfase: 60, general_dir: '/g', raiz: '/r', inactiva_min: 30, sesiones, fichas: [], hoy: null, siguiente: [],
    dias: [], turnosTotales: 0, uso: null, sinClasificar: 0, ultimoRefresh: null, git: {}, usoEstimado: null,
  }
}

describe('oficina', () => {
  test('una sala por proyecto; un empleado por sesión o por agente', () => {
    const v = vistaSesiones(SESIONES, AHORA, 30)
    const porSesion = salas(v, 'sesiones')
    expect(porSesion.map(s => [s.nombre, s.empleados.map(e => e.etiqueta)])).toEqual([
      ['struo', ['struo·feat-export', 'struo·feat-auth']],
      ['proyecto-b', ['proyecto-b·main']],
      ['GENERAL', ['torre']],
      ['proyecto-c', ['proyecto-c·main']],
    ])
    const porAgente = salas(v, 'agentes')
    expect(porAgente[0]?.empleados.map(e => [e.etiqueta, e.camiseta])).toEqual([
      ['STR-lead-02', '#D85A30'],
      ['STR-lead-01', '#D85A30'],
      ['STR-explore-01', '#7F77DD'],
    ])
  })

  test('cada estado tiene su postura y anima', () => {
    const base = { etiqueta: 'x', actividad: 'y', camiseta: '#D85A30' }
    const t = (e: Parameters<typeof sprite>[0], n = 0) => sprite(e, n).map(texto).join('\n')
    expect(t({ ...base, estado: 'te_espera' })).toContain('\\o!')
    expect(t({ ...base, estado: 'te_espera' }, 1)).not.toContain('!')
    expect(t({ ...base, estado: 'trabajando' })).not.toBe(t({ ...base, estado: 'trabajando' }, 1))
    expect(t({ ...base, estado: 'en_pausa' })).toContain('z')
    for (const e of ['trabajando', 'te_espera', 'en_pausa', 'inactiva'] as const) {
      expect(sprite({ ...base, estado: e }, 0)).toHaveLength(3)
    }
  })

  test('las salas caben en el ancho; una de más de 4 empleados ocupa todo', () => {
    const v = vistaSesiones(SESIONES, AHORA, 30)
    for (const w of [89, 140]) {
      for (const l of colocarSalas(salas(v, 'agentes'), w, 0)) expect(ancho(l)).toBe(w)
    }
    const muchas = Array.from({ length: 6 }, (_, i) => sesion(`m${i}`, { rama: `r${i}`, estado: 'trabajando' }))
    const lineas = colocarSalas(salas(vistaSesiones(muchas, AHORA, 30), 'sesiones'), 89, 0).map(texto)
    expect(lineas[0]?.startsWith('┌ struo ')).toBe(true)
    expect(lineas[0]?.trimEnd().endsWith('6 sesiones ┐')).toBe(true)
    expect(lineas[0]?.trimEnd()).toHaveLength(89)
    // 89 columnas: 4 empleados por fila, así que los 6 ocupan dos filas de la sala.
    expect(Math.floor((89 - 4) / ANCHO_EMPLEADO)).toBe(4)
    expect(lineas.filter(l => l.includes('● struo·r'))).toHaveLength(2)
  })

  test('la oficina entera: cabecera con el resumen, salas, leyenda y pie', () => {
    const todo = componerOficina(datos(), 'sesiones', 89, 0, AHORA).map(texto).join('\n')
    for (const t of ['huddle · oficina', '[Sesiones]', '5 sesiones · 1 trabajando · 1 espera · 1 inactiva', '┌ struo', '2 sesiones', '● struo·feat-export', 'espera GATE#1', '┌ GENERAL', 'torre', 'inactiva', 'Estados', '/panel · /oficina agentes']) {
      expect(todo).toContain(t)
    }
    const agentes = componerOficina(datos(), 'agentes', 89, 0, AHORA).map(texto).join('\n')
    expect(agentes).toContain('[Agentes]')
    expect(agentes).toContain('STR-explore-01')
    expect(agentes).toContain('Roles')
    expect(componerOficina(datos([]), 'sesiones', 89, 0, AHORA).map(texto).join('\n')).toContain('La oficina está vacía')
  })
})
