import { describe, expect, test } from 'claude-code/testing'

import {
  contarCambios,
  diasViejos,
  enmascarar,
  esCommit,
  esSoloLectura,
  esTest,
  hashError,
  interpretarBitacora,
  lineaBash,
  lineaEdicion,
  lineaSubagente,
  normalizarError,
  primeraLineaError,
  resumenTests,
  serializarLinea,
  truncar,
} from '../lib/bitacora.ts'
import { bytesUtf8, dirSubagentes, sumarTrozo } from '../lib/transcripts.ts'

describe('secretos enmascarados', () => {
  test('variables, flags, cabeceras, URLs y cadenas que parecen claves', () => {
    expect(enmascarar('TOKEN=abc123 pnpm deploy')).toBe('TOKEN=*** pnpm deploy')
    expect(enmascarar('GITHUB_TOKEN="ghp x" gh pr list')).toBe('GITHUB_TOKEN=*** gh pr list')
    expect(enmascarar('AWS_SECRET_ACCESS_KEY=abc OPENAI_API_KEY=sk-1 node x.js')).toBe('AWS_SECRET_ACCESS_KEY=*** OPENAI_API_KEY=*** node x.js')
    expect(enmascarar('mysql --password hunter2 -u root')).toBe('mysql --password *** -u root')
    expect(enmascarar('cli login --token=abc --api-key "x y"')).toBe('cli login --token=*** --api-key ***')
    expect(enmascarar('curl -H "Authorization: Bearer eyJhbGciOi.payload" https://api')).toBe('curl -H "Authorization: Bearer ***" https://api')
    expect(enmascarar("curl -H 'authorization: tok123' x")).toBe("curl -H 'authorization: ***' x")
    expect(enmascarar('git clone https://diego:s3cr3t@github.com/x.git')).toBe('git clone https://diego:***@github.com/x.git')
    expect(enmascarar('export K=ghp_aB3dE6fG9hI2jK5lM8nO1pQ4rS7tU0vW3xYz')).toBe('export K=ghp_***')
  })

  test('lo normal no se toca', () => {
    expect(enmascarar('pnpm test --passWithNoTests')).toBe('pnpm test --passWithNoTests')
    expect(enmascarar('git commit -m "fix: auth"')).toBe('git commit -m "fix: auth"')
    expect(enmascarar('ls src/components/very-long-file-name.tsx')).toBe('ls src/components/very-long-file-name.tsx')
  })
})

describe('errores', () => {
  test('la primera línea que cuenta el error, sin «Exit code»', () => {
    expect(primeraLineaError('Exit code 1\n\n> build\nError: Cannot find module \'./i18n\'\n    at x (/home/u/p/a.js:3:9)')).toBe("Error: Cannot find module './i18n'")
    expect(primeraLineaError('Exit code 2\nalgo raro')).toBe('algo raro')
    expect(primeraLineaError('Exit code 1\nfatal: TOKEN=abc no vale')).toBe('fatal: TOKEN=*** no vale')
  })

  test('el hash no cambia con rutas absolutas ni números', () => {
    expect(normalizarError('Error at /home/u/proj/src/a.ts:12:5 (took 34ms)')).toBe('error at <ruta>:<n>:<n> (took <n>ms)')
    expect(hashError("ENOENT: no such file '/tmp/x/123.txt'")).toBe(hashError("ENOENT: no such file '/var/y/456.txt'"))
    expect(hashError('Cannot find module ./i18n')).not.toBe(hashError('Cannot find module ./auth'))
    expect(normalizarError('C:\\Users\\d\\x.ts failed')).toBe('<ruta> failed')
  })
})

describe('qué es cada comando', () => {
  test('tests, commits y comandos de solo mirar', () => {
    for (const c of ['pnpm test', 'pnpm test auth', 'npm t', 'vitest run', 'pytest -x', 'go test ./...', 'cargo test', 'node --test', 'claude plugin test .', 'bun test']) expect(esTest(c)).toBe(true)
    for (const c of ['git commit -m "add test"', 'echo test', 'cat tests/a.ts', 'pnpm build', 'mkdir test']) expect(esTest(c)).toBe(false)
    expect(esCommit('git commit -m x')).toBe(true)
    expect(esCommit('git -C repo commit --amend')).toBe(true)
    expect(esCommit('git status')).toBe(false)
    for (const c of ['ls -la', 'cat a', 'rg foo', 'git status', 'git log -3', 'cd x && grep -r y .']) expect(esSoloLectura(c)).toBe(true)
    for (const c of ['pnpm build', 'git commit -m x', 'rm a', 'git push']) expect(esSoloLectura(c)).toBe(false)
  })

  test('resumen de tests de jest, vitest, pytest y node', () => {
    expect(resumenTests('Tests:       7 failed, 41 passed, 48 total')).toEqual({ pasan: 41, total: 48 })
    expect(resumenTests(' Tests  7 failed | 41 passed (48)')).toEqual({ pasan: 41, total: 48 })
    expect(resumenTests('==== 2 failed, 10 passed in 1.2s ====')).toEqual({ pasan: 10, total: 12 })
    expect(resumenTests(' 129 pass\n 0 fail\n')).toEqual({ pasan: 129, total: 129 })
    expect(resumenTests('todo bien')).toBeNull()
  })
})

describe('líneas de bitácora', () => {
  test('ediciones con +n −m, comandos con su resultado, subagentes con su duración', () => {
    const patch = [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, lines: [' a', '-b', '+c', '+d', ' e'] }]
    expect(contarCambios(patch)).toEqual({ mas: 2, menos: 1 })
    expect(lineaEdicion('2026-10-31T20:38:00+01:00', '/r/p/src/api/auth.ts', '/r/p', { mas: 3, menos: 4 }, true, false)).toEqual({
      ts: '2026-10-31T20:38:00+01:00', tipo: 'edit', resumen: 'src/api/auth.ts (+3 −4)', fichero: 'src/api/auth.ts', mas: 3, menos: 4, ok: true,
    })
    const b = lineaBash('t', 'pnpm build', false, "Cannot find module './i18n'", null)
    expect(b).toMatchObject({ tipo: 'bash', resumen: "pnpm build ✗ Cannot find module './i18n'", ok: false })
    expect(b.error_hash).toBe(hashError("Cannot find module './i18n'"))
    expect(lineaBash('t', 'pnpm test', true, null, { pasan: 30, total: 30 }).resumen).toBe('pnpm test · 30/30 ✓')
    expect(lineaBash('t', 'TOKEN=abc deploy', true, null, null).resumen).toBe('TOKEN=*** deploy ✓')
    expect(lineaSubagente('t', 'explore', 'buscar usos de getUser', 2.4).resumen).toBe('explore · «buscar usos de getUser» · 2 min')
  })

  test('se truncan a 120 caracteres y una línea rota se ignora al leer', () => {
    expect(truncar('x'.repeat(300))).toHaveLength(120)
    const texto = serializarLinea(lineaBash('t', 'ls', true, null, null)) + '{"ts":"t","tipo":"ba' + '\n' + serializarLinea(lineaSubagente('t', 'plan', 'p', null))
    expect(interpretarBitacora(texto).map(l => l.tipo)).toEqual(['bash', 'sub'])
  })

  test('rotación: los días de más de una semana', () => {
    expect(diasViejos(['2026-10-24', '2026-10-25', '2026-10-31', 'otra', '2026-10-20.jsonl'], '2026-10-25')).toEqual(['2026-10-24', '2026-10-20.jsonl'])
  })
})

describe('tokens de los transcripts', () => {
  const linea = (id: string, n: number, ts: string) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: { input_tokens: n, output_tokens: 1, cache_read_input_tokens: 500, cache_creation_input_tokens: 2 } } })

  test('por hora local, un mensaje de varios bloques una sola vez y sin la línea a medias', () => {
    const trozo = [linea('a', 10, '2026-10-31T19:10:00Z'), linea('a', 10, '2026-10-31T19:10:01Z'), '{"type":"user"}', linea('b', 20, '2026-10-31T20:05:00Z'), '{"type":"assis'].join('\n')
    const l = sumarTrozo(trozo, null, 60)
    expect(l.porHora).toEqual({ '2026-10-31T20': 13, '2026-10-31T21': 23 })
    expect(l.ultimo).toBe('b')
    expect(trozo.slice(l.usados)).toBe('{"type":"assis')
    // El mismo mensaje al empezar el siguiente trozo no se vuelve a contar.
    expect(sumarTrozo(`${linea('b', 20, '2026-10-31T20:05:00Z')}\n`, 'b', 60).porHora).toEqual({})
  })

  test('bytes UTF-8 y carpeta de subagentes', () => {
    expect(bytesUtf8('añ€😀')).toBe(1 + 2 + 3 + 4)
    expect(dirSubagentes('/h/.claude/projects/p/abc.jsonl')).toBe('/h/.claude/projects/p/abc/subagents')
  })
})
