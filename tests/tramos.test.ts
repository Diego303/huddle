import { describe, expect, test } from 'claude-code/testing'

import type { LineaTramo } from '../lib/tramos.ts'
import { interpretarTramos, metricasEspera, segmentosPorSesion, serializarTramo } from '../lib/tramos.ts'

const H = (hm: string) => `2026-10-31T${hm}:00+01:00`
const ms = (hm: string) => Date.parse(H(hm))
const t = (hm: string, session_id: string, estado: LineaTramo['estado'], nombre = `${session_id} · main`): LineaTramo => ({ ts: H(hm), session_id, estado, nombre, proyecto: session_id })

describe('tramos y métricas de espera', () => {
  const lineas = [
    t('09:00', 'a', 'trabajando'),
    t('09:30', 'a', 'te_espera'),
    t('09:32', 'a', 'trabajando'),
    t('10:00', 'a', 'en_pausa'),
    t('10:30', 'a', 'inactiva'),
    t('11:00', 'a', 'trabajando'),
    t('11:10', 'b', 'trabajando', 'b · docs'),
    t('11:20', 'b', 'te_espera', 'b · docs'),
    t('11:30', 'b', 'atascada', 'b · docs'),
    t('11:40', 'b', 'cerrada', 'b · docs'),
  ]

  test('cada sesión con sus tramos; inactiva y cerrada son huecos; la viva llega hasta ahora', () => {
    const filas = segmentosPorSesion(lineas, ms('12:00'), new Set(['a']), 30)
    expect(filas.map(f => f.nombre)).toEqual(['a · main', 'b · docs'])
    const a = filas[0]!.segmentos.map(s => [s.estado, (s.hasta - s.desde) / 60_000, s.abierto])
    expect(a).toEqual([['trabajando', 30, false], ['te_espera', 2, false], ['trabajando', 28, false], ['en_pausa', 30, false], ['trabajando', 60, true]])
    expect(filas[1]!.segmentos.map(s => s.estado)).toEqual(['trabajando', 'te_espera', 'atascada'])
  })

  test('una sesión que ya no está y no dejó «cerrada» no se inventa horas', () => {
    const filas = segmentosPorSesion([t('09:00', 'c', 'trabajando')], ms('15:00'), new Set(), 30)
    expect((filas[0]!.segmentos[0]!.hasta - filas[0]!.segmentos[0]!.desde) / 60_000).toBe(30)
  })

  test('un permiso que tardas 2 minutos en aprobar: 2 minutos de espera; total, media y máxima', () => {
    const filas = segmentosPorSesion(lineas, ms('12:00'), new Set(['a']), 30)
    const m = metricasEspera(filas)
    expect(m).toEqual({ minutos: 12, esperas: 2, media: 6, maxima: { minutos: 10, nombre: 'b · docs' } })
    expect(metricasEspera([])).toEqual({ minutos: 0, esperas: 0, media: null, maxima: null })
  })

  test('el fichero: una línea por cambio, y las rotas se ignoran', () => {
    const texto = lineas.slice(0, 2).map(serializarTramo).join('') + '{"ts":"x","session_id":"a","estado":"trabajando"}\n{"roto'
    expect(interpretarTramos(texto)).toHaveLength(2)
  })
})
