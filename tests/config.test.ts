import { describe, expect, test } from 'claude-code/testing'

import { CONFIG_POR_DEFECTO, estaConfigurada, interpretarConfig, serializarConfig } from '../lib/config.ts'

describe('config', () => {
  test('los valores que faltan salen de los de por defecto', () => {
    const { config, avisos } = interpretarConfig('{"general_dir": "/mnt/d/GitHub/GENERAL/", "inactiva_min": 10}')
    expect(avisos).toEqual([])
    expect(config.general_dir).toBe('/mnt/d/GitHub/GENERAL')
    expect(config.inactiva_min).toBe(10)
    expect(config.notificaciones).toEqual(CONFIG_POR_DEFECTO.notificaciones)
    expect(estaConfigurada(config)).toBe(false)
  })

  test('lo que no encaja se ignora', () => {
    const { config } = interpretarConfig(
      '{"inactiva_min": -3, "ventana_contexto": "mucho", "limites": {"semana_tokens": 5000, "sesion_5h_tokens": null}}',
    )
    expect(config.inactiva_min).toBe(30)
    expect(config.ventana_contexto).toBe(200000)
    expect(config.limites.semana_tokens).toBe(5000)
    expect(config.limites.sesion_5h_tokens).toBeNull()
  })

  test('un JSON roto da los valores por defecto y un aviso', () => {
    const { config, avisos } = interpretarConfig('{roto')
    expect(config).toEqual(CONFIG_POR_DEFECTO)
    expect(avisos).toHaveLength(1)
  })

  test('ida y vuelta', () => {
    const c = { ...CONFIG_POR_DEFECTO, general_dir: '/g', raiz_proyectos: '/r' }
    expect(interpretarConfig(serializarConfig(c)).config).toEqual(c)
    expect(estaConfigurada(c)).toBe(true)
  })
})
