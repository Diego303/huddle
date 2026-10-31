import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ModeloWeb } from '../lib/web.ts'
import { argvAbrirNavegador, huella, lineaDatos, modeloWeb } from '../lib/web.ts'
import { AHORA, datos, sesion } from './ayuda/ejemplo.ts'
import { crearSistema, DASHBOARD, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

describe('el modelo de la web (datos.js)', () => {
  const m = modeloWeb(datos(), AHORA, '00:46:00')

  test('KPIs y cabecera, ya formateados', () => {
    expect(m.kpis).toEqual({ vivas: '3', total: '/4', teEsperan: '1', agentes: '1', sub: '+1 sub', tareas: '71%', tareasPct: 71, tareasPie: '5 de 7' })
    expect(m.cabecera).toBe('huddle · /mnt/d/GitHub · sáb 31 oct · 00:46 · refresh hace 2m')
  })

  test('árbol de sesiones y agentes, con estado y color', () => {
    expect(m.arbol.map(r => [r.nombre, r.tipo, r.estado, r.sub])).toEqual([
      ['struo/feat-export', 'sesión', 'a', false],
      ['struo/feat-auth', 'sesión', 'w', false],
      ['STR-explore-01', 'explore', 'w', true],
      ['proyecto-b/main', 'sesión', 'p', false],
      ['proyecto-c/main', 'sesión', 'i', false],
    ])
    expect(m.arbol[0]?.color).toBe('#BA7517')
    expect(m.arbol[2]?.color).toBe('#7F77DD')
    expect(m.arbol[4]?.detalle).toBe('inactiva 3h 46m')
  })

  test('Rex, proyectos, contexto por umbral y alertas', () => {
    expect(m.rex).toMatchObject({ estado: 'alerta', bocadillo: '"¡feat-export te espera!"', racha: 'racha 6 días', nivel: 'nivel 13', adorno: 'calabaza' })
    expect((m.rex.barra + m.rex.resto).length).toBe(8)
    expect(m.proyectos.titulo).toBe('3 de 37')
    expect(m.proyectos.filas.map(f => [f.nombre, f.detalle, f.texto])).toEqual([
      ['struo', 'ola 3 · 5/7', '71%'],
      ['proyecto-b', 'migración · 9/10', '90%'],
      ['proyecto-c', 'MVP', '—'],
    ])
    expect(m.contexto.map(c => [c.nombre, c.texto, c.color])).toEqual([
      ['struo/feat-export', '83%', '#E24B4A'],
      ['struo/feat-auth', '48%', '#378ADD'],
      ['proyecto-b/main', '31%', '#378ADD'],
    ])
    expect(m.alertas[0]).toEqual({ texto: 'feat-export: contexto 83 %, compactar', grave: true })
    expect(m.alertas.some(a => a.texto === 'proyecto-b: 3 commits sin push')).toBe(true)
  })

  test('actividad de lunes a domingo con alturas ya calculadas', () => {
    expect(m.actividad.dias.map(d => d.letra).join('')).toBe('LMXJVSD')
    expect(m.actividad.dias.find(d => d.hoy)?.letra).toBe('S')
    expect(m.actividad.dias[6]).toMatchObject({ vacio: true, altoC: 0, altoT: 0 })
    expect(Math.max(...m.actividad.dias.map(d => Math.max(d.altoC, d.altoT)))).toBe(100)
  })

  test('siguiente acción, uso y oficina en los dos modos', () => {
    expect(m.siguiente).toEqual({ titulo: '', acciones: ['Aprobar GATE#1 en struo/feat-export', 'Compactar esa sesión', 'Push en proyecto-b'] })
    expect(m.uso.map(u => [u.titulo, u.texto, u.pie])).toEqual([
      ['Uso de la sesión de 5 h', '64%', 'reinicia en 3h 10m'],
      ['Uso semanal', '41%', 'reinicia jue 09:00'],
    ])
    expect(m.oficina.sesiones.map(s => [s.nombre, s.contador])).toEqual([
      ['struo', '2 sesiones'],
      ['proyecto-b', '1 sesión'],
      ['proyecto-c', '1 sesión'],
    ])
    expect(m.oficina.agentes[0]?.empleados.map(e => e.etiqueta)).toEqual(['STR-lead-02', 'STR-lead-01', 'STR-explore-01'])
    expect(m.oficina.resumen.sesiones).toEqual({ total: '4 sesiones', trabajando: '1 trabajando', esperan: '1 espera', inactivas: '1 inactiva' })
  })

  test('sin datos, n/d y estados vacíos; nunca números inventados', () => {
    const v = modeloWeb(datos({ sesiones: [], fichas: [], enSeguimiento: 0, uso: null, hoy: null, siguiente: [], dias: [], git: {} }), AHORA, 'x')
    expect(v.kpis.tareas).toBe('—')
    expect(v.proyectos.vacio).toBe('0 de 37 en seguimiento · /proyectos')
    expect(v.uso.map(u => [u.pct, u.texto])).toEqual([
      [null, 'n/d'],
      [null, 'n/d'],
    ])
    expect(v.actividad.nota).toBe('commits n/d (sin /refresh)')
    expect(v.actividad.dias.every(d => d.vacio)).toBe(true)
    expect(v.arbol).toEqual([])
  })

  test('una sola línea `window.HUDDLE = {...}` y una versión que solo cambia con el contenido', () => {
    const l = lineaDatos(m)
    expect(l.startsWith('window.HUDDLE = {')).toBe(true)
    expect(l.trimEnd().split('\n')).toHaveLength(1)
    const vuelta = JSON.parse(l.slice('window.HUDDLE = '.length).trimEnd().replace(/;$/, '')) as ModeloWeb
    expect(vuelta.version).toBe(m.version)
    expect(modeloWeb(datos(), AHORA, '23:59:59').version).toBe(m.version)
    expect(modeloWeb(datos({ sesiones: [sesion('z', { estado: 'trabajando' })] }), AHORA, '00:46:00').version).not.toBe(m.version)
    expect(huella('a')).not.toBe(huella('b'))
  })

  test('cómo se abre el navegador', () => {
    expect(argvAbrirNavegador('wsl', '/g/x.html', 'D:\\g\\x.html', false)).toEqual(['explorer.exe', 'D:\\g\\x.html'])
    expect(argvAbrirNavegador('wsl', '/g/x.html', 'D:\\g\\x.html', true)).toEqual(['wslview', '/g/x.html'])
    expect(argvAbrirNavegador('linux', '/g/x.html', null, false)).toEqual(['xdg-open', '/g/x.html'])
    expect(argvAbrirNavegador('mac', '/g/x.html', null, false)).toEqual(['open', '/g/x.html'])
    expect(argvAbrirNavegador('otra', '/g/x.html', null, false)).toBeNull()
  })
})

// ----------------------------------------------------------- de punta a punta

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const WEBDIR = `${GENERAL}/.agentos/web`

function escenario(cwd: string, web: boolean): SistemaFalso {
  const s = crearSistema({
    cwd,
    dirs: [GENERAL, `${RAIZ}/struo`, `${GENERAL}/.agentos/estado`],
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    ficheros: {
      '/home/usuario/.config/huddle/config.json': JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n',
      ...(web ? { [`${WEBDIR}/dashboard.html`]: DASHBOARD } : {}),
    },
  })
  s.sesion.repo = `${RAIZ}/struo`
  s.responder = argv => {
    if (argv[0] === 'wslpath') return { stdout: 'D:\\huddle-pruebas\\GENERAL\\.agentos\\web\\dashboard.html\n' }
    if (argv[0] === 'which') return { exitCode: 1 }
    return undefined
  }
  return s
}

async function arrancar($: Engine, on: On, s: SistemaFalso) {
  instalarSistema(on, s)
  const reloj = mock.clock(on, { now: Date.now() })
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { isAsync: true, status: 'async_launched', agentId: 'a1' }, text: 'lanzado' }) as never)
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: true })
  await reloj.advance(500)
  return reloj
}

function datosJs(s: SistemaFalso): ModeloWeb | null {
  const t = s.ficheros.get(`${WEBDIR}/datos.js`)
  return t === undefined ? null : (JSON.parse(t.slice('window.HUDDLE = '.length).trimEnd().replace(/;$/, '')) as ModeloWeb)
}

describe('/huddle web y la escritura en vivo', () => {
  test('/huddle web instala la página, escribe datos.js y abre el navegador de Windows', async ($, on) => {
    const s = escenario(GENERAL, false)
    await arrancar($, on, s)
    const r = await $.command.run({ command: 'huddle', args: 'web', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(r.text).toContain(`Vista web: ${WEBDIR}/dashboard.html`)
    expect(r.text).toContain('En Windows: D:\\huddle-pruebas')
    expect(s.ficheros.get(`${WEBDIR}/dashboard.html`)).toBe(DASHBOARD)
    expect(datosJs(s)?.arbol[0]?.nombre).toBe('GENERAL/torre')
    expect(s.lanzados.at(-1)).toEqual(['explorer.exe', 'D:\\huddle-pruebas\\GENERAL\\.agentos\\web\\dashboard.html'])
    const otro = await $.command.run({ command: 'huddle', args: 'otra', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
    expect(otro.text).toContain('Uso: /huddle web')
  })

  test('con la web activa, los hooks de cualquier sesión reescriben datos.js tras cada evento', async ($, on) => {
    const s = escenario(`${RAIZ}/struo`, true)
    const reloj = await arrancar($, on, s)
    await $.turn.start({ turnId: 't', text: '' })
    await reloj.advance(1000)
    const m = datosJs(s)
    expect(m?.arbol[0]).toMatchObject({ nombre: 'struo/n/d', estado: 'w' })
    // Sin cambios no se reescribe más de una vez cada 0,7 s; un evento nuevo llega igual.
    await $.tool.call({ tool: 'Agent', description: 'usos de token', prompt: 'x', subagent_type: 'Explore' } as never)
    await reloj.advance(1000)
    expect(datosJs(s)?.arbol.some(r => r.tipo === 'explore')).toBe(true)
  })

  test('sin /huddle web, nadie escribe datos.js', async ($, on) => {
    const s = escenario(`${RAIZ}/struo`, false)
    const reloj = await arrancar($, on, s)
    await $.turn.start({ turnId: 't', text: '' })
    await reloj.advance(1000)
    expect(s.ficheros.has(`${WEBDIR}/datos.js`)).toBe(false)
  })
})
