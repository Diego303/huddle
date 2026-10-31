import { describe, expect, test } from 'claude-code/testing'

import { dentroDe, mismaRuta, mismoNombre, nombre, normalizar, padre, rutaDeUsuario, unir } from '../lib/rutas.ts'

describe('rutas', () => {
  test('normaliza barras, . y ..', () => {
    expect(normalizar('/mnt/d//GitHub/./x/../GENERAL/')).toBe('/mnt/d/GitHub/GENERAL')
    expect(normalizar('/')).toBe('/')
    expect(unir('/a', 'b', '../c')).toBe('/a/c')
  })

  test('padre y nombre', () => {
    expect(padre('/mnt/d/GitHub/GENERAL')).toBe('/mnt/d/GitHub')
    expect(padre('/x')).toBe('/')
    expect(nombre('/mnt/d/GitHub/GENERAL/')).toBe('GENERAL')
  })

  test('en /mnt/<letra> no distingue mayúsculas; fuera, sí', () => {
    expect(mismaRuta('/mnt/d/Github/GENERAL', '/mnt/d/GitHub/general/')).toBe(true)
    expect(mismaRuta('/home/u/Proyecto', '/home/u/proyecto')).toBe(false)
    expect(dentroDe('/mnt/d/github/struo-wt/feat', '/mnt/d/GitHub')).toBe(true)
    expect(dentroDe('/mnt/d/GitHubX', '/mnt/d/GitHub')).toBe(false)
    expect(mismoNombre('Struo', 'struo', '/mnt/d/GitHub')).toBe(true)
    expect(mismoNombre('Struo', 'struo', '/home/u')).toBe(false)
  })

  test('rutas que escribe la persona', () => {
    expect(rutaDeUsuario('D:\\Github\\', '/home/u', '/x')).toBe('/mnt/d/Github')
    expect(rutaDeUsuario('"~/proyectos"', '/home/u', '/x')).toBe('/home/u/proyectos')
    expect(rutaDeUsuario('../otra', '/home/u', '/mnt/d/GitHub/GENERAL')).toBe('/mnt/d/GitHub/otra')
    expect(rutaDeUsuario(' /mnt/d/GitHub ', '/home/u', '/x')).toBe('/mnt/d/GitHub')
  })
})
