import { describe, expect, test } from 'claude-code/testing'

import type { Detector, Senal, Umbrales } from '../lib/atascos.ts'
import { detectorVacio, estaIgnorado, evaluar, interpretarIgnorados, serializarIgnorados, UMBRALES_POR_DEFECTO } from '../lib/atascos.ts'

const T0 = Date.parse('2026-10-31T20:00:00+01:00')
const min = (n: number) => T0 + n * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

function bash(ms: number, comando: string, ok: boolean, extra: Partial<Extract<Senal, { tipo: 'bash' }>> = {}): Senal {
  return { tipo: 'bash', ms, comando, ok, hash: ok ? null : 'h1', error: ok ? null : "Cannot find module './i18n'", test: false, tests: null, commit: false, soloLectura: false, ...extra }
}
const edit = (ms: number, fichero: string, nuevo = false): Senal => ({ tipo: 'edit', ms, fichero, nuevo })
const estado = (ms: number, e: 'trabajando' | 'te_espera' | 'en_pausa'): Senal => ({ tipo: 'estado', ms, estado: e })

function correr(senales: Senal[], u: Umbrales = UMBRALES_POR_DEFECTO, d: Detector = detectorVacio()): Detector {
  return senales.reduce((acc, s) => evaluar(acc, s, u, iso), d)
}

describe('atascos · comando en bucle', () => {
  test('salta al tercer fallo seguido con el mismo error, y no antes', () => {
    const dos = correr([bash(min(0), 'pnpm build', false), bash(min(1), 'pnpm build', false)])
    expect(dos.atasco).toBeNull()
    const tres = correr([bash(min(2), 'pnpm build', false)], UMBRALES_POR_DEFECTO, dos)
    expect(tres.atasco).toMatchObject({
      regla: 'comando',
      motivo: 'mismo comando falla 3 veces seguidas',
      prueba: { comando: 'pnpm build', error: "Cannot find module './i18n'" },
      desde: iso(min(0)),
    })
    // El cuarto fallo actualiza la cuenta, pero es el mismo atasco (misma clave, mismo «desde»).
    const cuatro = correr([bash(min(3), 'pnpm build', false)], UMBRALES_POR_DEFECTO, tres)
    expect(cuatro.atasco).toMatchObject({ clave: tres.atasco!.clave, motivo: 'mismo comando falla 4 veces seguidas', desde: iso(min(0)) })
  })

  test('un error distinto reinicia la cuenta; mirar ficheros entre medias no la corta', () => {
    const d = correr([
      bash(min(0), 'pnpm build', false),
      bash(min(1), 'pnpm build', false, { hash: 'otro', error: 'otro error' }),
      bash(min(2), 'cat src/i18n.ts', true, { soloLectura: true }),
      bash(min(3), 'pnpm build', false, { hash: 'otro', error: 'otro error' }),
    ])
    expect(d.atasco).toBeNull()
    const e = correr([bash(min(4), 'pnpm build', false, { hash: 'otro', error: 'otro error' })], UMBRALES_POR_DEFECTO, d)
    expect(e.atasco?.regla).toBe('comando')
  })

  test('se limpia si el comando funciona, si otro comando (que no solo mira) funciona o con un commit', () => {
    const atascado = correr([0, 1, 2].map(i => bash(min(i), 'pnpm build', false)))
    expect(atascado.atasco?.regla).toBe('comando')
    expect(correr([bash(min(3), 'pnpm build', true)], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    expect(correr([bash(min(3), 'pnpm add i18n', true)], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    expect(correr([bash(min(3), 'git commit -m x', true, { commit: true })], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    // Un `ls` que funciona no es avance.
    expect(correr([bash(min(3), 'ls src', true, { soloLectura: true })], UMBRALES_POR_DEFECTO, atascado).atasco?.regla).toBe('comando')
    // Tras limpiarse, hacen falta otros tres fallos.
    const limpio = correr([bash(min(3), 'pnpm add i18n', true), bash(min(4), 'pnpm build', false)], UMBRALES_POR_DEFECTO, atascado)
    expect(limpio.atasco).toBeNull()
  })

  test('el umbral se configura', () => {
    const u = { ...UMBRALES_POR_DEFECTO, comando_repeticiones: 2 }
    expect(correr([bash(min(0), 'make', false), bash(min(1), 'make', false)], u).atasco?.regla).toBe('comando')
  })
})

describe('atascos · fichero en bucle', () => {
  test('cinco ediciones del mismo fichero en 30 min sin tests en verde', () => {
    const cuatro = correr([0, 3, 6, 9].map(i => edit(min(i), 'src/api/auth.ts')))
    expect(cuatro.atasco).toBeNull()
    const d = correr(
      [
        bash(min(10), 'pnpm test', false, { test: true, tests: '41/48', hash: 't', error: '7 failed' }),
        bash(min(11), 'pnpm test', false, { test: true, tests: '42/48', hash: 't2', error: '6 failed' }),
        edit(min(12), 'src/api/auth.ts'),
      ],
      UMBRALES_POR_DEFECTO,
      cuatro,
    )
    expect(d.atasco).toMatchObject({
      regla: 'fichero',
      motivo: 'edita el mismo fichero 5 veces sin que pasen los tests',
      prueba: { fichero: 'src/api/auth.ts', tests: ['41/48 ✗', '42/48 ✗'] },
      desde: iso(min(0)),
    })
  })

  test('unos tests en verde entre medias ponen la cuenta a cero', () => {
    const d = correr([
      ...[0, 1, 2].map(i => edit(min(i), 'a.ts')),
      bash(min(3), 'pnpm test', true, { test: true, tests: '48/48' }),
      ...[4, 5, 6, 7].map(i => edit(min(i), 'a.ts')),
    ])
    expect(d.atasco).toBeNull()
  })

  test('las ediciones de hace más de 30 min no cuentan', () => {
    expect(correr([0, 10, 20, 31, 40].map(i => edit(min(i), 'a.ts'))).atasco).toBeNull()
  })

  test('se limpia con tests en verde o con un comando que funciona', () => {
    const atascado = correr([0, 1, 2, 3, 4].map(i => edit(min(i), 'a.ts')))
    expect(atascado.atasco?.regla).toBe('fichero')
    expect(correr([bash(min(5), 'vitest run', true, { test: true })], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    expect(correr([bash(min(5), 'pnpm lint', true)], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    expect(correr([bash(min(5), 'git diff', true, { soloLectura: true })], UMBRALES_POR_DEFECTO, atascado).atasco?.regla).toBe('fichero')
  })
})

describe('atascos · sin progreso', () => {
  test('20 minutos trabajando sin tests en verde, ficheros nuevos ni commits', () => {
    const senales: Senal[] = [estado(min(0), 'trabajando')]
    for (let i = 1; i <= 19; i++) senales.push(edit(min(i), `f${i}.ts`))
    const d = correr(senales)
    expect(d.atasco).toBeNull()
    const e = correr([bash(min(20), 'pnpm build', true)], UMBRALES_POR_DEFECTO, d)
    expect(e.atasco).toMatchObject({ regla: 'progreso', motivo: '20 min trabajando sin tests en verde, ficheros nuevos ni commits', desde: iso(min(0)) })
    expect(e.atasco?.prueba.texto).toBe('19 ediciones y 1 comando desde el último avance')
  })

  test('el tiempo esperándote o en pausa no cuenta', () => {
    const d = correr([
      estado(min(0), 'trabajando'),
      estado(min(10), 'te_espera'),
      estado(min(40), 'trabajando'),
      edit(min(49), 'a.ts'),
    ])
    expect(d.atasco).toBeNull()
    expect(Math.round(d.trabajo.ms / 60_000)).toBe(19)
  })

  test('un fichero nuevo, unos tests en verde o un commit son avance', () => {
    const base = [estado(min(0), 'trabajando'), edit(min(10), 'a.ts')]
    expect(correr([...base, edit(min(15), 'nuevo.ts', true), edit(min(25), 'a.ts')]).atasco).toBeNull()
    expect(correr([...base, bash(min(15), 'pytest', true, { test: true }), edit(min(25), 'a.ts')]).atasco).toBeNull()
    const atascado = correr([...base, edit(min(21), 'b.ts')])
    expect(atascado.atasco?.regla).toBe('progreso')
    expect(correr([bash(min(22), 'git commit -m x', true, { commit: true })], UMBRALES_POR_DEFECTO, atascado).atasco).toBeNull()
    // Un comando cualquiera que funciona no basta para esta regla: mide justo eso.
    expect(correr([bash(min(22), 'pnpm build', true)], UMBRALES_POR_DEFECTO, atascado).atasco?.regla).toBe('progreso')
  })

  test('un bucle de comando tiene prioridad sobre «sin progreso»', () => {
    const atascado = correr([estado(min(0), 'trabajando'), edit(min(21), 'b.ts')])
    const d = correr([0, 1, 2].map(i => bash(min(22 + i), 'cargo build', false)), UMBRALES_POR_DEFECTO, atascado)
    expect(d.atasco?.regla).toBe('comando')
  })
})

describe('atascos ignorados', () => {
  test('valen para esa sesión, ese atasco y esa tarea', () => {
    const lista = interpretarIgnorados(serializarIgnorados([{ session_id: 's1', clave: 'comando:pnpm build:h1', tarea: 2, ts: 'x' }]))
    expect(estaIgnorado(lista, 's1', 'comando:pnpm build:h1', 2)).toBe(true)
    expect(estaIgnorado(lista, 's1', 'comando:pnpm build:h1', 3)).toBe(false)
    expect(estaIgnorado(lista, 's2', 'comando:pnpm build:h1', 2)).toBe(false)
    expect(interpretarIgnorados('roto')).toEqual([])
  })
})
