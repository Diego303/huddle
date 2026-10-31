import { describe, expect, test } from 'claude-code/testing'

import { ficheroFicha, objetivoDeReadme, rellenar } from '../lib/fichas.ts'

describe('fichas', () => {
  test('objetivo: la primera frase de texto corrido del README', () => {
    const readme = [
      '<p align="center"><img src="logo.png"></p>',
      '# Struo',
      '[![CI](https://x/badge.svg)](https://x)',
      '',
      '> Una cita',
      '',
      'Struo es un **motor** de [olas](docs/olas.md) para features en paralelo. Tiene más cosas.',
    ].join('\n')
    expect(objetivoDeReadme(readme)).toBe('Struo es un motor de olas para features en paralelo.')
  })

  test('sin texto corrido no inventa nada', () => {
    expect(objetivoDeReadme('# Título\n\n- lista\n```\ncódigo largo de verdad\n```\n')).toBeNull()
    expect(objetivoDeReadme('')).toBeNull()
  })

  test('salta el front matter y recorta las frases largas', () => {
    const largo = `${'palabra '.repeat(40)}fin`
    const r = objetivoDeReadme(`---\ntitle: x\n---\n${largo}`)
    expect(r?.endsWith('…')).toBe(true)
    expect((r ?? '').length).toBeLessThanOrEqual(140)
  })

  test('no mira más allá de las 40 primeras líneas', () => {
    expect(objetivoDeReadme(`${'# t\n'.repeat(45)}Un párrafo que llega demasiado tarde.`)).toBeNull()
  })

  test('rellena la plantilla y nombra el fichero', () => {
    expect(rellenar('{{nombre}} · {{codigo}} · {{otro}}', { nombre: 'struo', codigo: 'STR' })).toBe('struo · STR · {{otro}}')
    expect(ficheroFicha('mi:web')).toBe('mi_web.md')
  })
})
