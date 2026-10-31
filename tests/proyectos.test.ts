import { describe, expect, test } from 'claude-code/testing'

import {
  anadirSinClasificar,
  cambiarRaiz,
  carpetasDesaparecidas,
  carpetasNuevas,
  codigoPorDefecto,
  generarProyectos,
  interpretarProyectos,
} from '../lib/proyectos.ts'

const EJEMPLO = `# Proyectos
Raíz: /mnt/d/Github

## Hacer seguimiento
- struo (STR)
- proyecto-b (PRB)
- proyecto-c

## No hacer seguimiento
- GENERAL
- apuntes

## Sin clasificar
- carpeta-nueva
`

describe('PROYECTOS.md', () => {
  test('interpreta el ejemplo del plan', () => {
    const doc = interpretarProyectos(EJEMPLO)
    expect(doc.raiz).toBe('/mnt/d/Github')
    expect(doc.seguimiento.map(e => [e.carpeta, e.codigo, e.codigoExplicito])).toEqual([
      ['struo', 'STR', true],
      ['proyecto-b', 'PRB', true],
      ['proyecto-c', 'PRO', false],
    ])
    expect(doc.noSeguimiento.map(e => e.carpeta)).toEqual(['GENERAL', 'apuntes'])
    expect(doc.sinClasificar.map(e => e.carpeta)).toEqual(['carpeta-nueva'])
    expect(doc.avisos).toEqual([])
  })

  test('código por defecto: tres primeras letras o cifras, sin tildes', () => {
    expect(codigoPorDefecto('proyecto-c')).toBe('PRO')
    expect(codigoPorDefecto('árbol')).toBe('ARB')
    expect(codigoPorDefecto('a-1')).toBe('A1')
    expect(codigoPorDefecto('---')).toBe('PRY')
  })

  test('títulos sin tildes ni mayúsculas, comentarios, viñetas y código en minúsculas', () => {
    const doc = interpretarProyectos(
      '# P\n## HACER SEGUIMIENTO\n* `mi web` (web)\n<!--\n- oculto\n-->\n+ otro\n## Notas\n- no cuenta\n## no hacer seguimiento\n- (ninguna)\n',
    )
    expect(doc.seguimiento.map(e => [e.carpeta, e.codigo])).toEqual([
      ['mi web', 'WEB'],
      ['otro', 'OTR'],
    ])
    expect(doc.noSeguimiento).toEqual([])
  })

  test('«No hacer seguimiento» gana si una carpeta está en dos secciones', () => {
    const doc = interpretarProyectos('## Hacer seguimiento\n- privado\n- web\n## No hacer seguimiento\n- privado\n')
    expect(doc.seguimiento.map(e => e.carpeta)).toEqual(['web'])
    expect(doc.avisos[0]).toContain('dos secciones')
  })

  test('avisa de códigos repetidos', () => {
    const doc = interpretarProyectos('## Hacer seguimiento\n- proyecto-b\n- proyecto-c\n')
    expect(doc.avisos.some(a => a.includes('PRO'))).toBe(true)
  })

  test('carpetas nuevas y desaparecidas, sin mayúsculas en DrvFs', () => {
    const doc = interpretarProyectos(EJEMPLO)
    const enDisco = ['Struo', 'proyecto-b', 'GENERAL', 'apuntes', 'carpeta-nueva', 'otra']
    expect(carpetasNuevas(doc, enDisco, '/mnt/d/Github')).toEqual(['otra'])
    expect(carpetasNuevas(doc, enDisco, '/home/u')).toEqual(['Struo', 'otra'])
    expect(carpetasDesaparecidas(doc, enDisco, '/mnt/d/Github')).toEqual(['proyecto-c'])
  })

  test('añade a «Sin clasificar» sin mover nada', () => {
    const nuevo = anadirSinClasificar(EJEMPLO, ['otra', 'mas'])
    expect(nuevo).toBe(EJEMPLO.replace('- carpeta-nueva\n', '- carpeta-nueva\n- otra\n- mas\n'))
    expect(anadirSinClasificar(EJEMPLO, [])).toBe(EJEMPLO)
  })

  test('crea «Sin clasificar» si falta y respeta lo que va detrás', () => {
    expect(anadirSinClasificar('# P\n\n## Hacer seguimiento\n- a\n\n', ['b'])).toBe(
      '# P\n\n## Hacer seguimiento\n- a\n\n## Sin clasificar\n- b\n',
    )
    expect(anadirSinClasificar('## Sin clasificar\n- a\n\n## Hacer seguimiento\n- b\n', ['c'])).toBe(
      '## Sin clasificar\n- a\n- c\n\n## Hacer seguimiento\n- b\n',
    )
  })

  test('cambia la línea Raíz o la añade bajo el título', () => {
    expect(cambiarRaiz(EJEMPLO, '/home/u/p')).toContain('\nRaíz: /home/u/p\n')
    expect(cambiarRaiz('# Proyectos\n\n## Hacer seguimiento\n', '/x')).toBe('# Proyectos\nRaíz: /x\n\n## Hacer seguimiento\n')
  })

  test('genera el fichero inicial a partir de la plantilla', () => {
    const plantilla = '# Proyectos\nRaíz: {{raiz}}\n\n## Hacer seguimiento\n\n## No hacer seguimiento\n\n## Sin clasificar\n'
    const texto = generarProyectos(plantilla, '/mnt/d/GitHub', ['GENERAL', 'huddle', 'struo'], ['general'])
    const doc = interpretarProyectos(texto)
    expect(doc.raiz).toBe('/mnt/d/GitHub')
    expect(doc.noSeguimiento.map(e => e.carpeta)).toEqual(['general'])
    expect(doc.sinClasificar.map(e => e.carpeta)).toEqual(['huddle', 'struo'])
    expect(doc.seguimiento).toEqual([])
  })
})
