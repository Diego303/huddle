import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { juntar } from '../lib/actividad.ts'
import { argvAbrir } from '../lib/comandos/abrir.ts'
import { desmarcarHoy, PROMPT_CIERRE } from '../lib/comandos/cierre.ts'
import { PROMPT_TESTS } from '../lib/comandos/proyecto.ts'
import { PROMPT_REDACTAR } from '../lib/comandos/refresh.ts'
import { argvPreguntar, interpretarRespuesta, separar } from '../lib/comandos/preguntar.ts'
import { desdeLaUltimaVez, generarEstado, tablaProyectos } from '../lib/estado-md.ts'
import type { GitCache } from '../lib/git.ts'
import { interpretarLog, interpretarStatus, porDia } from '../lib/git.ts'
import { estadoInicial } from '../lib/estado.ts'
import { crearSistema, instalarSistema } from './ayuda/sistema-falso.ts'
import type { SistemaFalso } from './ayuda/sistema-falso.ts'

const STATUS = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head feat-x',
  '# branch.upstream origin/feat-x',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 a b src/a.ts',
  '? nuevo.txt',
  '',
].join('\n')

describe('git', () => {
  test('status v2 con rama, upstream, ahead/behind y cambios', () => {
    expect(interpretarStatus(STATUS)).toEqual({ oid: '1111111111111111111111111111111111111111', rama: 'feat-x', upstream: 'origin/feat-x', ahead: 2, behind: 1, cambios: 2 })
    expect(interpretarStatus('# branch.oid (initial)\n# branch.head main\n')).toMatchObject({ oid: null, rama: 'main', upstream: null })
    expect(interpretarStatus('# branch.oid abc\n# branch.head (detached)\n')).toMatchObject({ rama: null })
  })

  test('log y commits por día local', () => {
    expect(interpretarLog('1793400000\tfeat: algo | raro\n1793300000\tfix\n\n')).toEqual([
      { ts: 1793400000000, asunto: 'feat: algo | raro' },
      { ts: 1793300000000, asunto: 'fix' },
    ])
    expect(porDia([Date.parse('2026-10-30T23:30:00Z'), Date.parse('2026-10-31T10:00:00Z')], 60)).toEqual({ '2026-10-31': 2 })
  })
})

const GIT: GitCache = {
  generado: '',
  repos: {
    struo: { oid: 'b', rama: 'feat-x', upstream: null, ahead: 3, behind: 0, cambios: 2, sucio_desde: null, ultimo_commit: { ts: Date.parse('2026-10-31T00:00:00Z'), asunto: 'feat: panel' }, commits_dia: {}, commits_ts: [Date.parse('2026-10-31T00:00:00Z'), Date.parse('2026-10-29T00:00:00Z')], error: null },
    web: { oid: null, rama: null, upstream: null, ahead: 0, behind: 0, cambios: 0, sucio_desde: null, ultimo_commit: null, commits_dia: {}, commits_ts: [], error: 'no es un repo git' },
  },
}

describe('ESTADO.md', () => {
  const fichas = [{ carpeta: 'struo', codigo: 'STR', fase: '', tareas: { hechas: 2, total: 3 } }]

  test('desde la última vez: commits nuevos, sesiones cerradas y progreso', () => {
    expect(desdeLaUltimaVez(null, GIT, [], fichas).desde[0]).toContain('Primer /refresh')
    const previa = { fecha: '', ms: Date.parse('2026-10-30T00:00:00Z'), oids: { struo: 'a', web: null }, sesiones: ['s1', 's2'], progreso: { struo: 33 } }
    const r = desdeLaUltimaVez(previa, GIT, ['s2'], fichas)
    expect(r.desde).toEqual(['struo: 1 commit nuevo', '1 sesión cerrada', 'struo: 33% → 67%'])
    expect(r.commitsNuevos).toEqual({ struo: 1 })
    const igual = { ...previa, oids: { struo: 'b', web: null }, sesiones: ['s2'], progreso: { struo: 67 } }
    expect(desdeLaUltimaVez(igual, GIT, ['s2'], fichas).desde).toEqual(['Sin cambios desde el último /refresh.'])
  })

  test('tabla de proyectos con n/d donde git no responde', () => {
    const t = tablaProyectos(fichas, ['struo', 'web'], GIT, Date.parse('2026-10-31T02:00:00Z'))
    expect(t[2]).toBe('| struo | 67% (2/3) | feat-x · 2 cambios · 3 sin push · sin upstream | hace 2 h · feat: panel |')
    expect(t[3]).toBe('| web | — | n/d (no es un repo git) | n/d |')
  })

  test('se conserva «Hoy» de la persona y se respetan 60 líneas', () => {
    const previo = '# Estado\n## Hoy\n- [x] hecho\n- [ ] pendiente\n## Siguiente acción\n1. vieja\n'
    const nuevo = generarEstado({ previo, fecha: '2026-10-31 02:00', desde: ['x'], siguiente: ['Push en struo'], tabla: ['| P |', '|---|'] })
    expect(nuevo).toContain('# Estado general · 2026-10-31 02:00')
    expect(nuevo).toContain('## Hoy\n- [x] hecho\n- [ ] pendiente\n')
    expect(nuevo).toContain('## Siguiente acción\n1. Push en struo\n')
    expect(nuevo).not.toContain('vieja')
    const larga = generarEstado({ previo: null, fecha: 'f', desde: [], siguiente: [], tabla: Array.from({ length: 80 }, (_, i) => `| ${i} |`) })
    expect(larga.trimEnd().split('\n').length).toBeLessThanOrEqual(60)
  })

  test('desmarcar «Hoy» no toca otras secciones', () => {
    expect(desmarcarHoy('## Hoy\n- [x] a\n- [X] b\n## Tareas\n- [x] c\n')).toBe('## Hoy\n- [ ] a\n- [ ] b\n## Tareas\n- [x] c\n')
  })

  test('juntar actividad conserva el total aunque se poden días', () => {
    const t = juntar({ dias: { '2026-09-01': { a: 5 } }, total: 5 }, { session_id: 's', proyecto: 'struo', dias: { '2026-10-30': 2, '2026-09-02': 1 } }, '2026-10-01')
    expect(t).toEqual({ dias: { '2026-10-30': { struo: 2 } }, total: 8 })
  })
})

describe('lo que se le pide a Claude', () => {
  // El kit retiene el prompt que encola un comando hasta que la sesión quede
  // libre, así que aquí se comprueba el texto; el envío, en la prueba real.
  test('los prompts acotan qué puede leer y tocar', () => {
    const r = PROMPT_REDACTAR('/g/ESTADO.md')
    expect(r).toContain('/g/ESTADO.md')
    expect(r).toContain('No leas código de los proyectos')
    expect(r).toContain('no toques «## Hoy»')
    const c = PROMPT_CIERRE({ registro: '/g/registro/2026-10.md', fichas: ['/g/proyectos/struo.md'], hoy: ['- [x] a'], dia: '2026-10-31' })
    expect(c).toContain('/g/proyectos/struo.md')
    expect(c).toContain('- [x] a')
    expect(PROMPT_CIERRE({ registro: 'r', fichas: [], hoy: [], dia: 'd' })).toContain('no cambies ninguna ficha')
    expect(PROMPT_TESTS('struo', '/r/struo')).toContain('No modifiques ningún fichero')
  })
})

describe('preguntar y abrir', () => {
  test('el Claude que responde solo puede leer', () => {
    const a = argvPreguntar('¿qué hace auth?', 'sesion-9')
    expect(a.slice(0, 6)).toEqual(['claude', '-p', '--resume', 'sesion-9', '--fork-session', '--no-session-persistence'])
    expect(a).toContain('dontAsk')
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Bash')
    expect(a.some(x => /^(Edit|Write|NotebookEdit)$|^Bash\((rm|find|mv|cp|git (push|commit|reset|checkout))/.test(x))).toBe(false)
    expect(a.slice(-2)).toEqual(['--', '¿qué hace auth?'])
    expect(argvPreguntar('x', null)).not.toContain('--resume')
  })

  test('separar la pregunta e interpretar la respuesta', () => {
    expect(separar('struo "¿por qué falla?"')).toEqual({ proyecto: 'struo', pregunta: '¿por qué falla?' })
    expect(separar('struo')).toEqual({ proyecto: 'struo', pregunta: '' })
    expect(interpretarRespuesta('{"result":" Porque sí. ","is_error":false,"permission_denials":[{}],"total_cost_usd":0.01}')).toEqual({ texto: 'Porque sí.', error: false, denegadas: 1, coste: 0.01 })
    expect(interpretarRespuesta('roto').error).toBe(true)
  })

  test('/abrir en WSL', () => {
    expect(argvAbrir('Ubuntu', 'struo', '/mnt/d/GitHub/struo')).toEqual(['wt.exe', '-w', '0', 'nt', '--title', 'struo', 'wsl.exe', '-d', 'Ubuntu', '--cd', '/mnt/d/GitHub/struo', '--', 'claude'])
  })
})

// ----------------------------------------------------------- de punta a punta

const RAIZ = '/mnt/d/huddle-pruebas'
const GENERAL = `${RAIZ}/GENERAL`
const AG = `${GENERAL}/.agentos`

function escenario(): SistemaFalso {
  const vieja = { ...estadoInicial({ session_id: 'vieja', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: `${RAIZ}/struo`, rama: 'main', ahora: '2026-10-01T00:00:00+02:00' }) }
  const quieta = { ...estadoInicial({ session_id: 'quieta', tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: `${RAIZ}/struo-wt/x`, rama: 'x', ahora: new Date().toISOString() }) }
  const s = crearSistema({
    cwd: GENERAL,
    dirs: [GENERAL, `${RAIZ}/struo`, `${RAIZ}/web`, `${AG}/estado`, `${AG}/actividad`, `${GENERAL}/registro`, `${GENERAL}/proyectos`],
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
    ficheros: {
      '/home/usuario/.config/huddle/config.json': JSON.stringify({ general_dir: GENERAL, raiz_proyectos: RAIZ }),
      [`${GENERAL}/PROYECTOS.md`]: '# Proyectos\n## Hacer seguimiento\n- struo (STR)\n- web\n- borrado\n## No hacer seguimiento\n- GENERAL\n',
      [`${GENERAL}/proyectos/struo.md`]: '---\ncodigo: STR\n---\n## Tareas\n- [x] a\n- [ ] b\n',
      [`${GENERAL}/ESTADO.md`]: '# Estado\n## Hoy\n- [x] Probar refresh\n- [ ] Comer\n',
      [`${AG}/estado/vieja.json`]: JSON.stringify(vieja),
      [`${AG}/estado/quieta.json`]: JSON.stringify(quieta),
      [`${AG}/actividad/vieja.json`]: JSON.stringify({ session_id: 'vieja', proyecto: 'struo', dias: { [new Date().toISOString().slice(0, 10)]: 3 } }),
      [`${AG}/actividad/quieta.json`]: JSON.stringify({ session_id: 'quieta', proyecto: 'struo', dias: { [new Date().toISOString().slice(0, 10)]: 2 } }),
    },
  })
  s.sesion.id = 'torre'
  s.responder = argv => {
    if (argv[0] === 'git' && argv.includes('status')) return argv.includes(`${RAIZ}/struo`) ? { stdout: STATUS } : { exitCode: 128, stderr: 'fatal: not a git repository' }
    if (argv[0] === 'git' && argv.includes('-1')) return { stdout: `${Math.floor(Date.now() / 1000) - 3600}\tfeat: panel\n` }
    if (argv[0] === 'git' && argv.includes('log')) return { stdout: `${Math.floor(Date.now() / 1000) - 3600}\n` }
    if (argv[0] === 'claude') return { stdout: JSON.stringify({ result: 'Lo hace auth.ts.', is_error: false, permission_denials: [], total_cost_usd: 0.002 }) }
    return undefined
  }
  return s
}

async function arrancar($: Engine, on: On, s: SistemaFalso, prompts: string[]): Promise<void> {
  instalarSistema(on, s)
  on('classic.*', () => ({}))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: s.cwd, surface: 'terminal', isInteractive: true })
}

async function correr($: Engine, command: string, args = ''): Promise<string> {
  const r = await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 200 } })
  return r.text ?? ''
}

describe('comandos de la Fase 5', () => {
  test('/refresh: limpia, junta, recoge git, regenera ESTADO.md, apunta y pide la redacción', async ($, on) => {
    const s = escenario()
    const prompts: string[] = []
    await arrancar($, on, s, prompts)
    const r = await correr($, 'refresh')
    expect(r).toContain('2 repos')
    expect(r).toContain('1 estado(s) caducado(s) borrados')
    expect(r).toContain('web: git n/d')
    // Caducada fuera; su actividad, junta en actividad.json; la de la sesión viva, intacta.
    expect(s.ficheros.has(`${AG}/estado/vieja.json`)).toBe(false)
    expect(s.ficheros.has(`${AG}/actividad/vieja.json`)).toBe(false)
    expect(s.ficheros.has(`${AG}/actividad/quieta.json`)).toBe(true)
    expect(JSON.parse(s.ficheros.get(`${AG}/actividad.json`) ?? '{}').total).toBe(3)
    // git: solo en las carpetas en seguimiento que existen, y siempre sin locks.
    const gits = s.procesos.filter(a => a[0] === 'git')
    expect(gits.every(a => a[1] === '--no-optional-locks')).toBe(true)
    expect(gits.some(a => a.includes(`${RAIZ}/borrado`))).toBe(false)
    const cache = JSON.parse(s.ficheros.get(`${AG}/git-cache.json`) ?? '{}') as GitCache
    expect(cache.repos.struo).toMatchObject({ rama: 'feat-x', ahead: 2, cambios: 2, ultimo_commit: { asunto: 'feat: panel' } })
    expect(Object.values(cache.repos.struo?.commits_dia ?? {})).toEqual([1])
    const estado = s.ficheros.get(`${GENERAL}/ESTADO.md`) ?? ''
    expect(estado).toContain('## Hoy\n- [x] Probar refresh\n- [ ] Comer\n')
    expect(estado).toContain('Push en struo (2 commits sin subir)')
    expect(estado).toContain('| struo | 50% (1/2) | feat-x · 2 cambios · 2 sin push · 1 por traer |')
    expect(estado).toContain('Primer /refresh')
    const mes = new Date().toISOString().slice(0, 7)
    expect(s.ficheros.get(`${GENERAL}/registro/${mes}.md`)).toMatch(/^# Registro · \d{4}-\d{2}\n\n- .* · \/refresh · 2 repos/)

    // Segunda vez con el mismo HEAD: no se vuelve a pedir el log, y «sin cambios».
    s.procesos.length = 0
    const otra = await correr($, 'refresh', 'solo-datos')
    expect(otra).toContain('Sin cambios desde el último /refresh.')
    expect(s.procesos.filter(a => a[0] === 'git' && a.includes('log'))).toEqual([])
  })

  test('/preguntar retoma en bifurcación la sesión en pausa, en su cwd, y ofrece guardarlo', async ($, on) => {
    const s = escenario()
    s.respuestaAsk = 'Sí'
    await arrancar($, on, s, [])
    const r = await correr($, 'preguntar', 'struo "¿dónde está auth?"')
    expect(r).toContain('Lo hace auth.ts.')
    expect(r).toContain('solo lectura · bifurcación de la sesión')
    const i = s.procesos.findIndex(a => a[0] === 'claude')
    expect(s.procesos[i]).toContain('--fork-session')
    expect(s.procesos[i]?.[s.procesos[i]!.indexOf('--resume') + 1]).toBe('quieta')
    expect(s.cwds[i]).toBe(`${RAIZ}/struo-wt/x`)
    const mes = new Date().toISOString().slice(0, 7)
    expect(s.ficheros.get(`${GENERAL}/registro/${mes}.md`)).toContain('/preguntar struo: «¿dónde está auth?» → Lo hace auth.ts.')
    expect(await correr($, 'preguntar', 'nada')).toContain('Uso: /preguntar')
  })

  test('/preguntar sin sesión quieta lanza un claude -p nuevo en el repo', async ($, on) => {
    const s = escenario()
    // Sin sesiones en pausa ni inactivas (la «vieja», inactiva, también se podría retomar).
    s.ficheros.delete(`${AG}/estado/quieta.json`)
    s.ficheros.delete(`${AG}/estado/vieja.json`)
    await arrancar($, on, s, [])
    await correr($, 'preguntar', 'STR ¿qué tal?')
    const i = s.procesos.findIndex(a => a[0] === 'claude')
    expect(s.procesos[i]).not.toContain('--resume')
    expect(s.cwds[i]).toBe(`${RAIZ}/struo`)
  })

  test('/abrir lanza Windows Terminal en el repo; /registro apunta', async ($, on) => {
    const s = escenario()
    await arrancar($, on, s, [])
    expect(await correr($, 'abrir', 'str')).toContain('Abriendo struo')
    expect(s.lanzados.at(-1)).toEqual(argvAbrir('Ubuntu', 'struo', `${RAIZ}/struo`))
    expect(await correr($, 'abrir', 'nada')).toContain('En seguimiento: struo (STR), web (WEB), borrado (BOR)')
    expect(await correr($, 'registro', '"Llamé a Ana"')).toContain('Apuntado en')
    const mes = new Date().toISOString().slice(0, 7)
    expect(s.ficheros.get(`${GENERAL}/registro/${mes}.md`)).toMatch(/- \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Llamé a Ana\n$/)
  })

  test('/proyecto muestra ficha, git y sesiones; con «tests» se lo pide a Claude', async ($, on) => {
    const s = escenario()
    const prompts: string[] = []
    await arrancar($, on, s, prompts)
    const r = await correr($, 'proyecto', 'struo tests')
    expect(r).toContain('# struo (STR)')
    expect(r).toContain('git: feat-x · 2 cambio(s) sin commitear · 2 sin push')
    expect(r).toContain('Sesiones: STR-lead-02 x · en_pausa · STR-lead-01 main · inactiva')
    expect(r).toContain('Ahora Claude ejecuta los tests')
  })

  test('/cierre apunta los números, desmarca «Hoy» y pide el resumen', async ($, on) => {
    const s = escenario()
    const prompts: string[] = []
    await arrancar($, on, s, prompts)
    const r = await correr($, 'cierre')
    expect(r).toContain('Hoy 1/2')
    expect(r).toContain('Proyectos tocados: struo')
    expect(s.ficheros.get(`${GENERAL}/ESTADO.md`)).toContain('- [ ] Probar refresh')
    // La ficha de struo (con tareas) se pone al día en segundo plano.
    expect(r).toContain('Pongo al día las fichas de struo (tareas hechas y estado)')
    expect(s.ficheros.has(`${AG}/fichas.en-curso`)).toBe(true)
  })
})
