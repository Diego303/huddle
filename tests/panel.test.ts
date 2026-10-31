import { describe, expect, test } from 'claude-code/testing'

import type { EstadoSesion } from '../lib/estado.ts'
import { estadoInicial } from '../lib/estado.ts'
import type { DatosPanel } from '../lib/lector.ts'
import {
  bocadillo,
  casillas,
  contadores,
  estadoRex,
  interpretarFicha,
  nivel,
  racha,
  seccion,
  siguienteAccion,
  vistaSesiones,
} from '../lib/panel-datos.ts'
import { ancho, texto } from '../mod/lienzo.ts'
import { componerPanel, duracion, fechaCabecera, reinicio } from '../mod/panel.ts'
import { COLUMNAS, FILAS, fotograma, PALETA } from '../mod/rex.ts'

const AHORA = Date.parse('2026-10-31T00:46:00+01:00')

function sesion(id: string, cambios: Partial<EstadoSesion>): EstadoSesion {
  return {
    ...estadoInicial({ session_id: id, tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: '/r/struo', rama: 'main', ahora: '2026-10-31T00:10:00+01:00' }),
    ultimo_evento: '2026-10-31T00:45:00+01:00',
    ...cambios,
  }
}

const SESIONES: EstadoSesion[] = [
  sesion('a', {
    rama: 'feat-auth',
    estado: 'trabajando',
    detalle: 'editando auth.ts',
    contexto_pct: 48,
    agentes: [
      { tool_use_id: 'u1', agent_id: 'x1', tipo: 'explore', descripcion: 'usos de token', inicio: '2026-10-31T00:20:00+01:00', estado: 'trabajando', detalle: 'Bash · rg' },
    ],
  }),
  sesion('b', { rama: 'feat-export', estado: 'te_espera', detalle: 'permiso: Write', te_espera_desde: '2026-10-31T00:38:00+01:00', contexto_pct: 83, inicio: '2026-10-31T00:20:00+01:00' }),
  sesion('c', { proyecto: 'proyecto-b', codigo: 'PRB', rama: 'main', estado: 'en_pausa', contexto_pct: 31 }),
  sesion('d', { proyecto: 'proyecto-c', codigo: 'PRC', estado: 'en_pausa', ultimo_evento: '2026-10-30T21:00:00+01:00' }),
]

function datos(cambios: Partial<DatosPanel> = {}): DatosPanel {
  return {
    generado: AHORA,
    desfase: 60,
    general_dir: '/r/GENERAL',
    raiz: '/mnt/d/GitHub',
    inactiva_min: 30,
    sesiones: SESIONES,
    fichas: [
      { carpeta: 'struo', codigo: 'STR', fase: 'ola 3', tareas: { hechas: 5, total: 7 }, mtime: 0 },
      { carpeta: 'proyecto-b', codigo: 'PRB', fase: 'migración', tareas: { hechas: 0, total: 0 }, mtime: 0 },
    ],
    hoy: { hechas: 5, total: 7 },
    siguiente: ['Aprobar GATE#1 en struo/feat-export'],
    dias: ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'].map((dia, i) => ({ dia, turnos: i * 3, commits: null })),
    turnosTotales: 1234,
    uso: { cinco_horas: { pct: 64, reinicia: '2026-10-31T02:56:00.000Z' }, semana: { pct: 41, reinicia: '2026-11-05T08:00:00.000Z' }, leido: '' },
    sinClasificar: 1,
    ultimoRefresh: null,
    git: {},
    usoEstimado: null,
    ...cambios,
  }
}

function textoPanel(w: number, h = 48, d: DatosPanel | null = datos()): string[] {
  const out: string[] = []
  for (const b of componerPanel(d, w, h, 0, AHORA)) {
    if (b.tipo === 'lineas') out.push(...b.lineas.map(texto))
    else out.push(...b.lado.map(texto))
  }
  return out
}

describe('datos del panel', () => {
  test('ficha: fase, casillas de Tareas y comentarios fuera', () => {
    const f = interpretarFicha('struo', '---\ncodigo: str\nfase: "ola 3"\n---\n# struo\n## Tareas\n<!-- - [ ] no -->\n- [x] a\n- [ ] b\n- [X] c\n## Bloqueos\n- [ ] no cuenta\n')
    expect(f).toEqual({ carpeta: 'struo', codigo: 'STR', fase: 'ola 3', tareas: { hechas: 2, total: 3 } })
  })

  test('ESTADO.md: Hoy y Siguiente acción (máximo 3)', () => {
    const md = '# Estado\n## Hoy\n- [ ] a\n- [x] b\n## Siguiente acción\n1. uno\n2. dos\n- tres\n4. cuatro\n## Proyectos\n'
    expect(casillas(seccion(md, 'hoy'))).toEqual({ hechas: 1, total: 2 })
    expect(siguienteAccion(md)).toEqual(['uno', 'dos', 'tres'])
    expect(siguienteAccion('## Siguiente acción\n1. ...\n')).toEqual([])
  })

  test('IDs por proyecto en orden de inicio, inactivas y orden de la lista', () => {
    const v = vistaSesiones(SESIONES, AHORA, 30)
    expect(v.map(x => [x.leadId, x.estado])).toEqual([
      ['STR-lead-02', 'te_espera'],
      ['STR-lead-01', 'trabajando'],
      ['PRB-lead-01', 'en_pausa'],
      ['PRC-lead-01', 'inactiva'],
    ])
    expect(v[1]?.agentes[0]?.id).toBe('STR-explore-01')
    expect(v[0]?.esperaMin).toBe(8)
    expect(contadores(v)).toEqual({ vivas: 3, total: 4, teEsperan: 1, leads: 1, subagentes: 1 })
  })

  test('una sesión que te espera no pasa a inactiva', () => {
    const v = vistaSesiones([sesion('x', { estado: 'te_espera', ultimo_evento: '2026-10-30T00:00:00+01:00' })], AHORA, 30)
    expect(v[0]?.estado).toBe('te_espera')
  })

  test('racha, nivel, Rex y su bocadillo', () => {
    const d = (turnos: number[]) => turnos.map((t, i) => ({ dia: `d${i}`, turnos: t, commits: null }))
    expect(racha(d([1, 0, 2, 3, 0]))).toBe(2)
    expect(racha(d([1, 1, 1]))).toBe(3)
    expect(racha(d([0, 0]))).toBe(0)
    expect(nivel(0)).toBe(1)
    expect(nivel(1234)).toBe(13)
    const v = vistaSesiones(SESIONES, AHORA, 30)
    expect(estadoRex(v, [])).toBe('alerta')
    expect(bocadillo('alerta', v, [])).toBe('¡feat-export te espera!')
    const sinEspera = vistaSesiones(SESIONES.filter(s => s.estado !== 'te_espera'), AHORA, 30)
    expect(estadoRex(sinEspera, [{ carpeta: 'web', codigo: 'WEB', fase: '', tareas: { hechas: 2, total: 2 }, pct: 100, completadaHace: 30 }])).toBe('celebrando')
    expect(estadoRex(sinEspera, [])).toBe('trabajando')
    expect(bocadillo('trabajando', sinEspera, [])).toBe('2 agentes en marcha')
    expect(estadoRex([], [])).toBe('durmiendo')
  })
})

describe('Rex', () => {
  test('mide 24×10 y cada estado se distingue', () => {
    for (const e of ['trabajando', 'durmiendo', 'alerta', 'celebrando'] as const) {
      const f = fotograma(e, 0)
      expect(f).toHaveLength(FILAS)
      for (const fila of f) expect(fila).toHaveLength(COLUMNAS)
    }
    const caracteres = (e: Parameters<typeof fotograma>[0], n = 0) => fotograma(e, n).flat().map(c => c.ch).join('')
    expect(caracteres('alerta')).toContain('!')
    expect(caracteres('celebrando')).toContain('✦')
    expect(caracteres('durmiendo')).toContain('━')
    expect(caracteres('durmiendo').toLowerCase()).toContain('z')
    // Despierto, el ojo es un píxel oscuro; dormido, una línea.
    expect(fotograma('trabajando', 0)[1]?.[10]?.bg).toBe(PALETA.ojo)
    // Trabajando se balancea: los dos fotogramas son distintos.
    expect(JSON.stringify(fotograma('trabajando', 0))).not.toBe(JSON.stringify(fotograma('trabajando', 1)))
  })
})

describe('composición del panel', () => {
  test('compacta a 89 columnas (acoplado): todas las secciones, nada más ancho', () => {
    const l = textoPanel(89)
    const todo = l.join('\n')
    for (const t of [
      'huddle · /mnt/d/GitHub',
      'sáb 31 oct · 00:46 · sin /refresh',
      'Sesiones 3/4 · Te esperan 1 · Agentes 1 +1 sub',
      'Tareas hoy 71%',
      '“¡feat-export te espera!”',
      'racha 6 días · nivel 13',
      'Ejecutándose ahora',
      'STR-explore-01',
      'struo · feat-export',
      'permiso: Write',
      'inactiva',
      'Progreso por proyecto',
      'ola 3 · 5/7',
      '71%',
      'Contexto por sesión',
      '83%',
      '▲ feat-export: contexto 83 %, compactar',
      '▲ feat-export: te espera desde hace 8 min',
      'Actividad 7 días',
      'L  M  X  J  V  S  D'.split(' ').filter(Boolean)[0]!,
      '1. Aprobar GATE#1 en struo/feat-export',
      'Sesión 5 h',
      '64% · reinicia en 3h 10m',
      '41% · reinicia jue 09:00',
      '1 sin clasificar',
    ]) {
      expect(todo).toContain(t)
    }
    const conRex = componerPanel(datos(), 89, 48, 0, AHORA)
    for (const b of conRex) {
      if (b.tipo === 'lineas') for (const x of b.lineas) expect(ancho(x)).toBe(89)
      else for (const x of b.lado) expect(ancho(x)).toBeLessThanOrEqual(b.ladoAncho)
    }
  })

  test('sin datos de uso ni ficheros muestra n/d, no inventa', () => {
    const todo = textoPanel(89, 48, datos({ uso: null, hoy: null, siguiente: [], fichas: [], sesiones: [] })).join('\n')
    expect(todo).toContain('Sesión 5 h n/d · configúralo en config.json')
    expect(todo).toContain('Tareas hoy —')
    expect(todo).toContain('(ninguna sesión abierta)')
    expect(todo).toContain('nada pendiente')
    expect(textoPanel(89, 48, null).join('\n')).toContain('Leyendo la carpeta de control')
  })

  test('sin «Siguiente acción» en ESTADO.md, sale por reglas', () => {
    const todo = textoPanel(89, 48, datos({ siguiente: [] })).join('\n')
    expect(todo).toContain('(por reglas)')
    expect(todo).toContain('1. Atender struo · feat-export: permiso: Write')
  })

  test('ancha (≥ 100 columnas): dos columnas, sin pasarse de ancho', () => {
    const bloques = componerPanel(datos(), 140, 50, 0, AHORA)
    for (const b of bloques) if (b.tipo === 'lineas') for (const x of b.lineas) expect(ancho(x)).toBe(140)
    const todo = textoPanel(140, 50).join('\n')
    expect(todo).toContain('│')
    expect(todo).toContain('Progreso por proyecto')
  })

  test('formatos de fecha y duración', () => {
    expect(fechaCabecera(AHORA, 60)).toBe('sáb 31 oct · 00:46')
    expect(duracion(130)).toBe('2h 10m')
    expect(duracion(0.5)).toBe('ahora')
    expect(reinicio('2026-10-31T02:56:00.000Z', AHORA, 60)).toBe('reinicia en 3h 10m')
    expect(reinicio(null, AHORA, 60)).toBe('reinicio n/d')
  })
})
