// Datos de ejemplo para los tests del panel y de la oficina: los del wireframe.

import type { EstadoSesion } from '../../lib/estado.ts'
import { estadoInicial } from '../../lib/estado.ts'
import type { DatosPanel } from '../../lib/lector.ts'

/** Sábado 31 de octubre de 2026, 00:46 en Madrid. */
export const AHORA = Date.parse('2026-10-31T00:46:00+01:00')

export function sesion(id: string, cambios: Partial<EstadoSesion>): EstadoSesion {
  return {
    ...estadoInicial({ session_id: id, tipo: 'proyecto', proyecto: 'struo', codigo: 'STR', cwd: '/r/struo', rama: 'main', ahora: '2026-10-31T00:10:00+01:00' }),
    ultimo_evento: '2026-10-31T00:45:00+01:00',
    ...cambios,
  }
}

export const SESIONES: EstadoSesion[] = [
  sesion('a', {
    rama: 'feat-auth',
    estado: 'trabajando',
    detalle: 'editando auth.ts',
    contexto_pct: 48,
    agentes: [
      { tool_use_id: 'u1', agent_id: 'x1', tipo: 'explore', descripcion: 'usos de token', inicio: '2026-10-31T00:20:00+01:00', estado: 'trabajando', detalle: 'Bash · rg' },
    ],
  }),
  sesion('b', { rama: 'feat-export', estado: 'te_espera', detalle: 'permiso: Write', te_espera_desde: '2026-10-31T00:38:00+01:00', contexto_pct: 83, inicio: '2026-10-31T00:20:00+01:00' }),
  sesion('c', { proyecto: 'proyecto-b', codigo: 'PRB', rama: 'main', estado: 'en_pausa', detalle: 'migración v2', contexto_pct: 31 }),
  sesion('d', { proyecto: 'proyecto-c', codigo: 'PRC', estado: 'en_pausa', ultimo_evento: '2026-10-30T21:00:00+01:00' }),
]

export function datos(cambios: Partial<DatosPanel> = {}): DatosPanel {
  return {
    generado: AHORA,
    desfase: 60,
    general_dir: '/r/GENERAL',
    raiz: '/mnt/d/GitHub',
    inactiva_min: 30,
    sesiones: SESIONES,
    fichas: [
      { carpeta: 'struo', codigo: 'STR', fase: 'ola 3', tareas: { hechas: 5, total: 7 }, mtime: 0 },
      { carpeta: 'proyecto-b', codigo: 'PRB', fase: 'migración', tareas: { hechas: 9, total: 10 }, mtime: 0 },
      { carpeta: 'proyecto-c', codigo: 'PRC', fase: 'MVP', tareas: { hechas: 0, total: 0 }, mtime: 0 },
    ],
    hoy: { hechas: 5, total: 7 },
    siguiente: ['Aprobar GATE#1 en struo/feat-export', 'Compactar esa sesión', 'Push en proyecto-b'],
    dias: ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'].map((dia, i) => ({ dia, turnos: [0, 4, 9, 6, 12, 7, 3][i]!, commits: [0, 2, 5, 1, 7, 3, 0][i]! })),
    turnosTotales: 1234,
    uso: { cinco_horas: { pct: 64, reinicia: '2026-10-31T02:56:00.000Z' }, semana: { pct: 41, reinicia: '2026-11-05T08:00:00.000Z' }, leido: '' },
    sinClasificar: 1,
    ultimoRefresh: AHORA - 120_000,
    git: { 'proyecto-b': { rama: 'main', ahead: 3, cambios: 0, sucio_desde: null, error: null, ci: null } },
    usoEstimado: null,
    rex_estacional: true,
    seguimiento: ['struo', 'proyecto-b', 'proyecto-c'],
    enSeguimiento: 3,
    ...cambios,
  }
}
