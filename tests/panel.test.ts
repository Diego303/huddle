import { describe, expect, test } from 'claude-code/testing'

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
import { anchoGrande, grande } from '../mod/digitos.ts'
import type { Linea } from '../mod/lienzo.ts'
import { ancho, barraSuave, columnaVertical, FONDO_TARJETA, PISTA, tarjeta, texto } from '../mod/lienzo.ts'
import { cabecera, componerPanel, duracion, fechaCabecera, modoDe, reinicio, semana } from '../mod/panel.ts'
import { adornoDe, comoLineas, fotograma, PALETA, tamano } from '../mod/rex.ts'
import { AHORA, datos, sesion, SESIONES } from './ayuda/ejemplo.ts'

function texto2(lineas: readonly Linea[]): string {
  return lineas.map(texto).join('\n')
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

describe('piezas del lienzo', () => {
  test('1 · tarjeta con esquinas redondeadas, título en el borde y fondo propio', () => {
    const t = tarjeta([[{ t: 'hola' }]], { titulo: 'Rex', derecha: [{ t: 'alerta' }], ancho: 20 })
    expect(t.map(texto)).toEqual(['╭─ Rex ─── alerta ─╮', `│ hola${' '.repeat(12)} │`, `╰${'─'.repeat(18)}╯`])
    for (const l of t) expect(ancho(l)).toBe(20)
    expect(t[0]?.find(x => x.t === 'Rex')?.c).toBe('#F0997B')
    // Todo el interior lleva el fondo de la tarjeta; el borde, el del terminal.
    expect(t[1]?.slice(1, -1).every(x => x.f === FONDO_TARJETA)).toBe(true)
    expect(t[1]?.[0]?.f).toBeUndefined()
  })

  test('2 · dígitos de 3×3 con ▀ █ ▄', () => {
    expect(grande('30', '#fff').map(texto2l => texto2l[0]?.t)).toEqual(['▀▀█ █▀█', ' ▀█ █ █', '▀▀▀ ▀▀▀'])
    expect(anchoGrande('71')).toBe(7)
    expect([...grande('1234567890-', '#fff').map(l => l[0]?.t).join('')].every(c => ' ▀█▄'.includes(c))).toBe(true)
  })

  test('3 · barras suaves en octavos sobre una pista; sin dato, la pista vacía', () => {
    expect(texto(barraSuave(50, 10, '#f00'))).toBe('█████     ')
    expect(texto(barraSuave(56.25, 10, '#f00'))).toBe('█████▋    ')
    expect(texto(barraSuave(100, 4, '#f00'))).toBe('████')
    expect(barraSuave(30, 10, '#f00').every(x => x.f === PISTA)).toBe(true)
    expect(texto(barraSuave(null, 6, '#f00'))).toBe('      ')
    expect(texto(barraSuave(0, 6, '#f00'))).not.toContain('·')
  })

  test('5 · columnas verticales de 4 filas; sin valor, un ▁ apagado', () => {
    expect(columnaVertical(32, 32, 4).map(c => c.ch)).toEqual(['█', '█', '█', '█'])
    expect(columnaVertical(1, 4, 4).map(c => c.ch)).toEqual([' ', ' ', ' ', '█'])
    expect(columnaVertical(3, 8, 4).map(c => c.ch)).toEqual([' ', ' ', '▄', '█'])
    expect(columnaVertical(0, 4, 4)).toEqual([
      { ch: ' ', apagada: true },
      { ch: ' ', apagada: true },
      { ch: ' ', apagada: true },
      { ch: '▁', apagada: true },
    ])
    expect(columnaVertical(null, 4, 4)[3]).toEqual({ ch: '▁', apagada: true })
  })
})

describe('Rex', () => {
  test('4 · a 1× ocupa 14×5 celdas (10 del sprite y 4 para adornos); a 2×, 28×10', () => {
    expect(tamano(1)).toEqual({ columnas: 14, filas: 5 })
    expect(tamano(2)).toEqual({ columnas: 28, filas: 10 })
    for (const e of ['trabajando', 'durmiendo', 'alerta', 'celebrando'] as const) {
      for (const k of [1, 2] as const) {
        const f = fotograma(e, 0, null, k)
        expect(f).toHaveLength(tamano(k).filas)
        for (const fila of f) expect(fila).toHaveLength(tamano(k).columnas)
      }
    }
    const caracteres = (e: Parameters<typeof fotograma>[0], n = 0) => fotograma(e, n).flat().map(c => c.ch).join('')
    expect(caracteres('alerta')).toContain('!')
    expect(caracteres('celebrando')).toContain('✦')
    expect(caracteres('durmiendo')).toContain('━')
    expect(caracteres('durmiendo').toLowerCase()).toContain('z')
    expect(JSON.stringify(fotograma('trabajando', 0))).not.toBe(JSON.stringify(fotograma('trabajando', 1)))
  })

  test('una media celda pintada solo abajo es ▄ (nunca ▀ con el primer plano por defecto)', () => {
    for (const k of [1, 2] as const) {
      for (const fila of fotograma('durmiendo', 0, 'calabaza', k)) {
        for (const c of fila) if (c.ch === '▀') expect(c.fg).not.toBe(0x01000000)
      }
    }
  })

  test('lo transparente toma el fondo de la tarjeta', () => {
    const l = comoLineas(fotograma('durmiendo', 0))
    expect(l.every(fila => fila.every(x => x.f === undefined || x.f.startsWith('#')))).toBe(true)
    const t = tarjeta(l, { ancho: 20 })
    expect(t.slice(1, -1).every(fila => fila.slice(1, -1).every(x => x.f !== undefined))).toBe(true)
  })

  test('capricho estacional: calabaza el 31 de octubre, gorro en diciembre', () => {
    expect(adornoDe(10, 31, true)).toBe('calabaza')
    expect(adornoDe(12, 5, true)).toBe('gorro')
    expect(adornoDe(10, 30, true)).toBeNull()
    expect(adornoDe(10, 31, false)).toBeNull()
    const calabaza = fotograma('durmiendo', 0, 'calabaza', 1)
    expect(calabaza[4]?.slice(11).map(c => c.fg)).toEqual([PALETA.calabaza, PALETA.calabaza, PALETA.calabaza])
    const gorro = fotograma('trabajando', 0, 'gorro', 1)
    expect(gorro[0]?.slice(4, 8).every(c => c.fg === PALETA.rojo)).toBe(true)
  })
})

describe('composición del panel', () => {
  test('6 · compacto en 88: KPIs 4×1, Rex + ejecución, 2 columnas y uso al pie; nada más ancho', () => {
    const l = componerPanel(datos(), 88, 44, 0, AHORA)
    for (const x of l) expect(ancho(x)).toBe(88)
    const t = l.map(texto)
    const fila0 = t[0] ?? ''
    for (const titulo of ['Sesiones', 'Te esperan', 'Agentes', 'Tareas hoy']) expect(fila0).toContain(`╭─ ${titulo} `)
    expect(fila0.match(/╭/g)).toHaveLength(4)
    const conRex = t.find(x => x.includes('╭─ Rex '))
    expect(conRex).toContain('╭─ Ejecutándose ahora ')
    expect(t.find(x => x.includes('╭─ Progreso por proyecto '))).toContain('╭─ Contexto por sesión ')
    expect(t.find(x => x.includes('╭─ Actividad '))).toContain('╭─ Siguiente acción ')
    expect(t.find(x => x.includes('╭─ Sesión 5 h '))).toContain('╭─ Semana ')
    // El orden de las filas.
    const i = (k: string) => t.findIndex(x => x.includes(k))
    expect(i('╭─ Sesiones')).toBeLessThan(i('╭─ Rex'))
    expect(i('╭─ Rex')).toBeLessThan(i('╭─ Progreso'))
    expect(i('╭─ Progreso')).toBeLessThan(i('╭─ Alertas'))
    expect(i('╭─ Alertas')).toBeLessThan(i('╭─ Actividad'))
    expect(i('╭─ Actividad')).toBeLessThan(i('╭─ Sesión 5 h'))
    expect(l.length).toBeLessThanOrEqual(44)
    const todo = t.join('\n')
    for (const k of ['1 trab · 1 pausa', 'feat-export · 8m', '+1 sub', '5/7', '“¡feat-export te', 'racha 6 días · nivel 13', 'STR-explore-01', '3 proyectos en seguimiento', '83%', '▲ feat-export: contexto 83 %, compactar', '1. Aprobar GATE#1 en struo/feat-export', 'reinicia en 3h 10m', 'reinicia jue 09:00', '1 sin clasificar']) {
      expect(todo).toContain(k)
    }
  })

  test('6 · ancho en 196: la misma rejilla con más aire, sin la mitad derecha vacía; Rex a 2× si sobra alto', () => {
    const l = componerPanel(datos(), 196, 60, 0, AHORA)
    for (const x of l) expect(ancho(x)).toBe(196)
    const t = l.map(texto)
    // Ninguna línea con contenido acaba en un tramo vacío de más de media pantalla.
    for (const x of t) expect(/ {98,}$/.test(x)).toBe(false)
    expect(t.filter(x => x.includes('╭─ Rex ')).length).toBe(1)
    const rex = t.findIndex(x => x.includes('╭─ Rex '))
    const fin = t.findIndex((x, j) => j > rex && x.startsWith('╰'))
    expect(fin - rex - 1).toBeGreaterThanOrEqual(10)
    expect(t.join('\n')).toContain('● 1 trabajando')
    // Sin alto para el 2×, Rex se queda a 1×.
    const bajo = componerPanel(datos(), 196, 40, 0, AHORA).map(texto)
    const r = bajo.findIndex(x => x.includes('╭─ Rex '))
    expect(bajo.findIndex((x, j) => j > r && x.startsWith('╰')) - r - 1).toBeLessThan(10)
  })

  test('estrecho (< 70): KPIs 2×2 y una tarjeta por fila', () => {
    expect(modoDe(60)).toBe('estrecho')
    expect(modoDe(88)).toBe('compacto')
    expect(modoDe(91)).toBe('ancho')
    const l = componerPanel(datos(), 60, 80, 0, AHORA)
    for (const x of l) expect(ancho(x)).toBe(60)
    const t = l.map(texto)
    expect(t[0]?.match(/╭/g)).toHaveLength(2)
  })

  test('5 · actividad de lunes a domingo, con hoy resaltado y lo futuro apagado', () => {
    const dias = semana(datos(), AHORA)
    expect(dias.map(x => x.letra).join(' ')).toBe('L M X J V S D')
    expect(dias.map(x => x.dia)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(dias.find(x => x.hoy)?.letra).toBe('S')
    expect(dias[6]).toMatchObject({ turnos: null, commits: null })
    expect(dias[0]).toMatchObject({ turnos: 4, commits: 2 })
    const t = componerPanel(datos(), 88, 44, 0, AHORA).map(texto)
    expect(t.some(x => /L +M +X +J +V +S +D/.test(x))).toBe(true)
  })

  test('7 · sin proyectos en seguimiento: lo dice, sin barras inventadas; eje apagado', () => {
    const vacio = datos({ fichas: [], seguimiento: [], enSeguimiento: 0, sesiones: [], dias: [], hoy: null, siguiente: [], uso: null, git: {} })
    const t = componerPanel(vacio, 88, 44, 0, AHORA).map(texto)
    const todo = t.join('\n')
    expect(todo).toContain('ningún proyecto en seguimiento')
    expect(todo).toContain('edita PROYECTOS.md y luego /proyectos')
    expect(todo).not.toContain('de 37')
    expect(t.some(x => /▁▁ +▁▁ +▁▁ +▁▁ +▁▁ +▁▁ +▁▁/.test(x))).toBe(true)
    expect(todo).toContain('commits n/d')
    expect(todo).toContain('n/d · configúralo en config.json')
    expect(todo).toContain('sin tareas')
    expect(todo).toContain('nadie espera')
    expect(todo).toContain('ninguna sesión abierta')
    expect(componerPanel(null, 88, 44, 0, AHORA).map(texto).join('')).toContain('Leyendo la carpeta de control')
  })

  test('3 · contexto por umbral: azul < 60, ámbar 60–80, rojo ≥ 80', () => {
    const conPct = (p: number) => datos({ sesiones: [sesion('a', { estado: 'trabajando', contexto_pct: p })] })
    const colorDe = (p: number) => {
      const l = componerPanel(conPct(p), 88, 44, 0, AHORA).find(x => texto(x).includes('struo·main') && texto(x).includes(`${p}%`)) ?? []
      const desde = l.findIndex(x => x.t.includes('struo·main'))
      return l.slice(desde).find(x => x.t.includes('█'))?.c
    }
    expect(colorDe(48)).toBe('#378ADD')
    expect(colorDe(70)).toBe('#EF9F27')
    expect(colorDe(85)).toBe('#E24B4A')
  })

  test('proyectos en seguimiento sin ficha: con su nombre y «—», nunca un 0 % inventado', () => {
    const d = datos({ fichas: [], seguimiento: ['avizor', 'rimor', 'struo'], enSeguimiento: 3 })
    const t = componerPanel(d, 88, 44, 0, AHORA).map(texto)
    const filas = t.filter(x => /avizor|rimor|struo  /.test(x) && x.includes('sin ficha'))
    expect(filas).toHaveLength(3)
    for (const f of filas) expect(f).toMatch(/—/)
    expect(t.join('\n')).toContain('3 proyectos en seguimiento')
    expect(t.join('\n')).toContain('3 sin ficha · /proyectos las crea')
    expect(t.filter(x => /\b0%/.test(x) && x.includes('sin ficha'))).toEqual([])
    // Con fichas para unos y no para otros, en el orden de PROYECTOS.md.
    const mixto = datos({ seguimiento: ['proyecto-b', 'nuevo', 'struo'], enSeguimiento: 3 })
    const m = componerPanel(mixto, 88, 44, 0, AHORA).map(texto)
    const i = (k: string) => m.findIndex(x => x.includes(k))
    expect(i('proyecto-b')).toBeLessThan(i('nuevo'))
    expect(i('nuevo')).toBeLessThan(i('struo  '))
    expect(m.join('\n')).toContain('1 sin ficha · /proyectos las crea')
  })

  test('sin «Siguiente acción» en ESTADO.md, sale por reglas', () => {
    const todo = componerPanel(datos({ siguiente: [] }), 88, 44, 0, AHORA).map(texto).join('\n')
    expect(todo).toContain('por reglas')
    expect(todo).toContain('1. Atender struo · feat-export:')
  })

  test('cabecera, fechas y duraciones', () => {
    expect(texto(cabecera(datos(), AHORA, 70))).toContain('huddle · /mnt/d/GitHub')
    expect(texto(cabecera(datos(), AHORA, 70))).toContain('refresh hace 2m')
    expect(ancho(cabecera(datos(), AHORA, 70))).toBe(70)
    expect(fechaCabecera(AHORA, 60)).toBe('sáb 31 oct · 00:46')
    expect(duracion(130)).toBe('2h 10m')
    expect(duracion(0.5)).toBe('ahora')
    expect(reinicio('2026-10-31T02:56:00.000Z', AHORA, 60)).toBe('reinicia en 3h 10m')
    expect(reinicio(null, AHORA, 60)).toBe('reinicio n/d')
  })

  test('el disfraz de Rex depende de la fecha local y de la config', () => {
    const conRex = (rex_estacional: boolean) => texto2(componerPanel(datos({ rex_estacional, sesiones: [] }), 88, 44, 0, AHORA))
    expect(conRex(true)).not.toBe(conRex(false))
  })
})
