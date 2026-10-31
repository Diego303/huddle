import { describe, expect, test } from 'claude-code/testing'

import { detalleDeHerramienta, programaDeBash, recortar, tipoDeAgente } from '../lib/detalle.ts'

describe('detalle sin datos privados', () => {
  test('ficheros: ruta relativa al cwd, o solo el nombre si está fuera', () => {
    expect(detalleDeHerramienta('Edit', { file_path: '/r/struo/src/auth.ts', old_string: 'x' }, '/r/struo')).toBe('editando src/auth.ts')
    expect(detalleDeHerramienta('Read', { file_path: '/etc/hosts' }, '/r/struo')).toBe('leyendo hosts')
    expect(detalleDeHerramienta('Write', {}, '/r')).toBe('editando')
  })

  test('Bash: solo el programa', () => {
    expect(programaDeBash('cd web && FOO=1 pnpm test -- --token=abc')).toBe('pnpm')
    expect(programaDeBash('/usr/bin/git status')).toBe('git')
    expect(programaDeBash('sudo env X=1 docker ps | grep x')).toBe('docker')
    expect(programaDeBash('')).toBe('bash')
    expect(detalleDeHerramienta('Bash', { command: 'git push https://usuario:clave@x', description: 'Sube los cambios' }, '/r')).toBe('Bash · git')
  })

  test('subagentes, preguntas y MCP', () => {
    expect(detalleDeHerramienta('Agent', { description: 'usos de token', subagent_type: 'Explore', prompt: 'secreto' }, '/r')).toBe('explore: usos de token')
    expect(detalleDeHerramienta('AskUserQuestion', { questions: [{ question: 'privada' }] }, '/r')).toBe('pregunta')
    expect(detalleDeHerramienta('mcp__claude_ai_Gmail__search', { q: 'privado' }, '/r')).toBe('mcp claude_ai_Gmail · search')
  })

  test('tipos de subagente', () => {
    expect(tipoDeAgente('Explore')).toBe('explore')
    expect(tipoDeAgente(undefined)).toBe('general')
    expect(tipoDeAgente('general-purpose')).toBe('general')
    expect(tipoDeAgente('huddle:runner')).toBe('runner')
    expect(tipoDeAgente('test-runner')).toBe('tests')
  })

  test('recorta a 60 caracteres', () => {
    expect(recortar('x'.repeat(100))).toHaveLength(60)
    expect(recortar('  a   b  ')).toBe('a b')
  })
})
