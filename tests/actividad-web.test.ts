import { describe, expect, test } from 'claude-code/testing'

import type { AtascoSesion } from '../lib/estado.ts'
import type { LecturaActividad } from '../lib/web-actividad.ts'
import { claveDeSesion, modeloActividad, modeloBitacora } from '../lib/web-actividad.ts'
import { modeloWeb } from '../lib/web.ts'
import { datos, sesion, SESIONES } from './ayuda/ejemplo.ts'

/** Sábado 31 de octubre de 2026, 20:41 en Madrid. */
const AHORA = Date.parse('2026-10-31T20:41:00+01:00')
const H = (hm: string, dia = '2026-10-31') => `${dia}T${hm}:00+01:00`

const ATASCO: AtascoSesion = {
  regla: 'comando',
  clave: 'comando:pnpm build:abc',
  desde: H('20:29'),
  motivo: 'mismo comando falla 4 veces seguidas',
  prueba: { comando: 'pnpm build', error: "Cannot find module './i18n'" },
  id: 'a1b2c3d4',
  avisado: true,
  ignorado: false,
}

const LECTURA: LecturaActividad = {
  tramos: [
    { ts: H('23:00', '2026-10-30'), session_id: 'sA', estado: 'trabajando', nombre: 'struo · feat-auth', proyecto: 'struo' },
    { ts: H('09:12'), session_id: 'sA', estado: 'en_pausa', nombre: 'struo · feat-auth', proyecto: 'struo' },
    { ts: H('11:06'), session_id: 'sA', estado: 'trabajando', nombre: 'struo · feat-auth', proyecto: 'struo' },
    { ts: H('11:06'), session_id: 'sA', estado: 'te_espera', nombre: 'struo · feat-auth', proyecto: 'struo' },
    { ts: H('11:08'), session_id: 'sA', estado: 'trabajando', nombre: 'struo · feat-auth', proyecto: 'struo' },
    { ts: H('19:30'), session_id: 'sB', estado: 'trabajando', nombre: 'rimor · main', proyecto: 'rimor' },
    { ts: H('20:20'), session_id: 'sB', estado: 'te_espera', nombre: 'rimor · main', proyecto: 'rimor' },
    { ts: H('20:30'), session_id: 'sB', estado: 'atascada', nombre: 'rimor · main', proyecto: 'rimor' },
  ],
  bitacora: [
    { session_id: 'sA', dia: '2026-10-31', lineas: [{ ts: H('20:38'), tipo: 'edit', resumen: 'src/auth.ts (+3 −4)' }, { ts: H('20:31'), tipo: 'edit', resumen: 'src/auth.ts (+5 −2)' }] },
    { session_id: 'sA', dia: '2026-10-28', lineas: [{ ts: H('10:00', '2026-10-28'), tipo: 'edit', resumen: 'src/viejo.ts (+1 −0)' }] },
    { session_id: 'sB', dia: '2026-10-31', lineas: [{ ts: H('20:18'), tipo: 'sub', resumen: 'explore · «buscar usos» · 2 min' }] },
  ],
}

const vivas = [
  sesion('sA', { rama: 'feat-auth', estado: 'trabajando', ultimo_evento: H('20:40') }),
  sesion('sB', { proyecto: 'rimor', codigo: 'RIM', rama: 'main', estado: 'trabajando', ultimo_evento: H('20:40'), atasco: ATASCO }),
]
const USO = {
  cinco_horas: { pct: 64, reinicia: '2026-10-31T21:00:00.000Z' },
  semana: { pct: 41, reinicia: '2026-11-05T08:00:00.000Z' },
  leido: '',
}
const TOKENS = {
  struo: { '2026-10-31T18': 300, '2026-10-31T10': 999 },
  rimor: { '2026-10-31T19': 100 },
  notas: { '2026-10-31T20': 100 },
}
const base = () => datos({ sesiones: vivas, seguimiento: ['struo', 'rimor'], enSeguimiento: 2, uso: USO, tokensProyecto: TOKENS })

describe('pestaña Actividad · atascos', () => {
  test('cada atasco con su prueba, desde cuándo, una pista y los comandos que copia la web', () => {
    const a = modeloActividad(base(), LECTURA, AHORA, modeloBitacora(base(), LECTURA, AHORA)).atascos
    expect(a.titulo).toBe('1 sesión parece en bucle')
    expect(a.lista).toEqual([
      {
        id: 'a1b2c3d4',
        sesion: 'rimor · main',
        proyecto: 'rimor',
        motivo: 'mismo comando falla 4 veces seguidas',
        prueba: { comando: 'pnpm build', error: "Cannot find module './i18n'" },
        desde: 'hace 12 min',
        pista: 'Repite lo mismo esperando otro resultado. Revisa el error o dale una pista.',
        abrir: '/abrir rimor',
        ignorar: '/huddle ignorar a1b2c3d4',
      },
    ])
  })

  test('ignorado (desde la web o en la sesión) no sale; y la sesión atascada se ve en rojo en la Oficina', () => {
    const ignorado = datos({ ...base(), ignorados: [{ session_id: 'sB', clave: ATASCO.clave, tarea: 0, ts: '' }] })
    expect(modeloActividad(ignorado, LECTURA, AHORA, modeloBitacora(ignorado, LECTURA, AHORA)).atascos.lista).toEqual([])
    const m = modeloWeb(base(), AHORA, 'x', LECTURA)
    expect(m.escenas.sesiones.find(p => p.id === 'rimor · main')?.estado).toBe('x')
    expect(m.arbol.find(r => r.nombre === 'rimor/main')).toMatchObject({ estado: 'x', color: '#E24B4A', detalle: 'atascada · mismo comando falla 4 veces seguidas' })
    expect(m.oficina.resumen.sesiones.atascadas).toBe('1 atascada')
    expect(modeloWeb(ignorado, AHORA, 'x', LECTURA).escenas.sesiones.find(p => p.id === 'rimor · main')?.estado).toBe('w')
  })
})

describe('pestaña Actividad · cronograma', () => {
  test('desde las 9:00 hasta ahora, con lo que se arrastra de ayer, y las métricas de espera', () => {
    const c = modeloActividad(base(), LECTURA, AHORA, modeloBitacora(base(), LECTURA, AHORA)).cronograma
    expect([c.inicio, c.fin, Math.round(c.ahora)]).toEqual([0, 20 * 60 + 41, 20 * 60 + 41])
    const a = c.filas.find(f => f.nombre === 'struo · feat-auth')!
    expect(a.clave).toBe(claveDeSesion('sA'))
    expect(a.tramos.map(t => [t.e, t.desde, Math.round(t.hasta)])).toEqual([
      ['w', 0, 9 * 60 + 12],
      ['p', 9 * 60 + 12, 11 * 60 + 6],
      ['a', 11 * 60 + 6, 11 * 60 + 8],
      ['w', 11 * 60 + 8, 20 * 60 + 41],
    ])
    expect(a.tramos[2]!.texto).toBe('struo · feat-auth · esperándote · 11:06–11:08 (2 min)')
    expect(a.tramos[3]!.texto).toBe('struo · feat-auth · trabajando · 11:08–ahora (573 min)')
    expect(c.filas.find(f => f.nombre === 'rimor · main')!.tramos.map(t => t.e)).toEqual(['w', 'a', 'x'])
    expect(c.espera).toBe('12 min esperándote hoy · media 6 min')
    expect(c.esperaMax).toBe('máx. 10 min (rimor · main)')
  })

  test('sin nada de ayer, el eje empieza a las 9:00 aunque se empezara después', () => {
    const l = { ...LECTURA, tramos: LECTURA.tramos.filter(t => t.ts.startsWith('2026-10-31T1')) }
    const c = modeloActividad(base(), l, AHORA, modeloBitacora(base(), l, AHORA)).cronograma
    expect(c.inicio).toBe(9 * 60)
    expect(c.horas[0]).toEqual({ min: 540, texto: '9h' })
  })
})

describe('pestaña Actividad · uso por proyecto', () => {
  test('con el dato oficial: el % de cada proyecto es su parte de lo usado', () => {
    const u = modeloActividad(base(), LECTURA, AHORA, modeloBitacora(base(), LECTURA, AHORA)).uso
    expect(u.cinco).toMatchObject({ titulo: 'sesión de 5 h', pct: 64, texto: '64 %', pie: 'reinicia en 1 h 19 min' })
    expect(u.cinco.proyectos.map(p => [p.nombre, p.texto, p.parteTexto])).toEqual([
      ['struo', '38 %', '60 % de lo usado'],
      ['rimor', '13 %', '20 % de lo usado'],
      ['otros', '13 %', '20 % de lo usado'],
    ])
    expect(u.cinco.nota).toEqual(['struo se lleva el 60 % de lo usado: más ediciones (2).'])
    // En la semana entran también las 10 h de struo; rimor tuvo un atasco; y la proyección al reinicio.
    expect(u.semana.proyectos[0]).toMatchObject({ nombre: 'struo', texto: '36 %', parteTexto: '87 % de lo usado' })
    expect(u.semana.nota[1]).toMatch(/^A este ritmo llegas al 100 % el mié \d\d:\d\d, antes del reinicio \(jue 09:00\)\.$/)
    expect(u.semana.aviso).toBe(true)
  })

  test('sin dato oficial pero con límites: ≈; sin nada: n/d', () => {
    const est = datos({ ...base(), uso: null, limites: { sesion_5h_tokens: 1000, semana_tokens: 10000, reinicio_semanal: 'jue 09:00' } })
    const u = modeloActividad(est, LECTURA, AHORA, modeloBitacora(est, LECTURA, AHORA)).uso
    expect(u.cinco).toMatchObject({ pct: 50, texto: '≈50 %', pie: 'ventana móvil de 5 h' })
    expect(u.cinco.proyectos[0]).toMatchObject({ nombre: 'struo', texto: '≈30 %' })
    const nada = datos({ ...base(), uso: null })
    expect(modeloActividad(nada, LECTURA, AHORA, modeloBitacora(nada, LECTURA, AHORA)).uso.cinco).toMatchObject({ pct: null, texto: 'n/d' })
  })
})

describe('pestaña Actividad · bitácora', () => {
  test('de más reciente a más antiguo, con hora (o día y hora) y el nombre de cada sesión', () => {
    const b = modeloBitacora(base(), LECTURA, AHORA)
    expect(b.sesiones).toEqual([
      { clave: claveDeSesion('sA'), nombre: 'struo · feat-auth', proyecto: 'struo' },
      { clave: claveDeSesion('sB'), nombre: 'rimor · main', proyecto: 'rimor' },
    ])
    expect(b.eventos).toEqual([
      ['20:38', 'edit', 'src/auth.ts (+3 −4)', 0],
      ['20:31', 'edit', 'src/auth.ts (+5 −2)', 0],
      ['20:18', 'sub', 'explore · «buscar usos» · 2 min', 1],
      ['mié 10:00', 'edit', 'src/viejo.ts (+1 −0)', 0],
    ])
    // La versión solo cambia si cambia el contenido; datos.js la lleva para recargar bitacora.js.
    expect(modeloBitacora(base(), LECTURA, AHORA).version).toBe(b.version)
    expect(modeloWeb(base(), AHORA, 'x', LECTURA).pestanaActividad.bitacora).toEqual({ version: b.version, eventos: 4 })
  })

  test('sin nada: todo vacío y sin atascos', () => {
    const vacio = datos({ sesiones: SESIONES })
    const a = modeloWeb(vacio, AHORA, 'x').pestanaActividad
    expect(a.atascos).toEqual({ titulo: '', lista: [] })
    expect(a.cronograma.filas).toEqual([])
    expect(a.cronograma.espera).toBe('nadie te ha esperado hoy')
    expect(a.bitacora.eventos).toBe(0)
  })
})
