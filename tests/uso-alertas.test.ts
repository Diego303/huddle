import { describe, expect, test } from 'claude-code/testing'

import type { ActividadSesion } from '../lib/actividad.ts'
import { juntar, sumarTokens } from '../lib/actividad.ts'
import { estadoInicial } from '../lib/estado.ts'
import { interpretarCi } from '../lib/git.ts'
import type { DatosPanel } from '../lib/lector.ts'
import { tokensDesde } from '../lib/lector.ts'
import { accionesPorReglas, alertasGit, vistaSesiones } from '../lib/panel-datos.ts'
import { texto } from '../mod/lienzo.ts'
import { componerPanel } from '../mod/panel.ts'
import { horaLocal, ultimoReinicio } from '../lib/tiempo.ts'

const AHORA = Date.parse('2026-10-31T00:46:00+01:00')

function datos(c: Partial<DatosPanel>): DatosPanel {
  return {
    generado: AHORA, desfase: 60, general_dir: '/g', raiz: '/r', inactiva_min: 30, sesiones: [], fichas: [], hoy: null, siguiente: [],
    dias: [], turnosTotales: 0, uso: null, sinClasificar: 0, ultimoRefresh: null, git: {}, usoEstimado: null, rex_estacional: true, ...c,
  }
}

function todo(d: DatosPanel): string {
  return componerPanel(d, 89, 50, 0, AHORA)
    .flatMap(b => (b.tipo === 'lineas' ? b.lineas : b.lado))
    .map(texto)
    .join('\n')
}

describe('alertas de git', () => {
  const git = {
    struo: { ahead: 3, cambios: 0, sucio_desde: null, ci: 'fallo' as const },
    web: { ahead: 0, cambios: 4, sucio_desde: '2026-10-26T10:00:00+01:00' },
    api: { ahead: 0, cambios: 2, sucio_desde: '2026-10-30T10:00:00+01:00', ci: 'ok' as const },
  }

  test('sin push, sucio más de 3 días y CI en rojo; nada más', () => {
    expect(alertasGit(git, AHORA)).toEqual([
      { texto: 'struo: CI en rojo', nivel: 'grave' },
      { texto: 'struo: 3 commits sin push', nivel: 'aviso' },
      { texto: 'web: cambios sin commitear desde hace 4 días', nivel: 'aviso' },
    ])
  })

  test('el panel las enseña y la siguiente acción por reglas añade el push', () => {
    const t = todo(datos({ sinClasificar: 2, git: Object.fromEntries(Object.entries(git).map(([k, v]) => [k, { rama: 'main', error: null, ci: null, ...v }])) }))
    expect(t).toContain('▲ struo: CI en rojo')
    expect(t).toContain('▲ web: cambios sin commitear desde hace 4 días')
    expect(t).toContain('1. Push en struo (3 commits sin subir)')
    const orden = t.split('\n').filter(l => l.startsWith('▲'))
    expect(orden[0]).toBe('▲ struo: CI en rojo'.padEnd(89))
    expect(orden.at(-1)?.trimEnd()).toBe('▲ 2 carpeta(s) sin clasificar en PROYECTOS.md')
  })

  test('orden de las reglas: te espera, contexto alto, push', () => {
    const s = (id: string, c: object) => ({ ...estadoInicial({ session_id: id, tipo: 'proyecto', proyecto: 'p', codigo: 'P', cwd: '/r/p', rama: id, ahora: '2026-10-31T00:40:00+01:00' }), ultimo_evento: '2026-10-31T00:45:00+01:00', ...c })
    const v = vistaSesiones([s('a', { contexto_pct: 91 }), s('b', { estado: 'te_espera', detalle: 'permiso: Bash' })], AHORA, 30)
    expect(accionesPorReglas(v, { struo: { ahead: 1, cambios: 0, sucio_desde: null } })).toEqual([
      'Atender p · b: permiso: Bash',
      'Compactar p · a (91 %)',
      'Push en struo (1 commit sin subir)',
    ])
  })

  test('CI de gh', () => {
    expect(interpretarCi('[{"status":"completed","conclusion":"failure"}]')).toBe('fallo')
    expect(interpretarCi('[{"status":"completed","conclusion":"success"}]')).toBe('ok')
    expect(interpretarCi('[{"status":"in_progress","conclusion":""}]')).toBe('en_curso')
    expect(interpretarCi('[]')).toBeNull()
    expect(interpretarCi('roto')).toBeNull()
  })
})

describe('uso', () => {
  test('el dato oficial manda; sin él y sin límites, n/d', () => {
    expect(todo(datos({}))).toContain('Sesión 5 h n/d · configúralo en config.json')
  })

  test('sin dato oficial pero con límites: ≈, nunca un número sin marcar', () => {
    const t = todo(datos({ usoEstimado: { cinco_horas: 42, semana: null, reinicioSemana: null } }))
    expect(t).toContain('≈42% · ventana móvil de 5 h')
    expect(t).toContain('Semana n/d')
  })

  test('tokens por hora, ventana de 5 h y reinicio semanal', () => {
    let a: ActividadSesion = { session_id: 's', proyecto: 'p', dias: {} }
    a = sumarTokens(a, '2026-10-30T20', 100, '2026-10-23T00')
    a = sumarTokens(a, '2026-10-31T00', 50, '2026-10-23T00')
    a = sumarTokens(a, '2026-10-31T00', 0, '2026-10-23T00')
    expect(a).toEqual({ session_id: 's', proyecto: 'p', dias: {}, tokens: { '2026-10-30T20': 100, '2026-10-31T00': 50 } })
    const horas = new Map(Object.entries(a.tokens ?? {}))
    expect(tokensDesde(horas, horaLocal(AHORA - 5 * 3600_000, 60))).toBe(150)
    expect(tokensDesde(horas, '2026-10-31T00')).toBe(50)
    // Hoy es sábado 31 a las 00:46: el último «jue 09:00» fue el jueves 29.
    expect(new Date(ultimoReinicio(AHORA, 60, 'jue 09:00') ?? 0).toISOString()).toBe('2026-10-29T08:00:00.000Z')
    expect(new Date(ultimoReinicio(AHORA, 60, 'sáb 00:30') ?? 0).toISOString()).toBe('2026-10-30T23:30:00.000Z')
    expect(new Date(ultimoReinicio(AHORA, 60, 'sáb 09:00') ?? 0).toISOString()).toBe('2026-10-24T08:00:00.000Z')
    expect(ultimoReinicio(AHORA, 60, 'cuando sea')).toBeNull()
    const t = juntar({ dias: {}, total: 0, tokens: { '2026-10-20T10': 9 } }, a, '2026-10-01', '2026-10-23T00')
    expect(t.tokens).toEqual({ '2026-10-30T20': 100, '2026-10-31T00': 50 })
  })
})
