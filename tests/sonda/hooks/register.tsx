// Sonda de la Fase 0 de Huddle: guarda cada evento (redactado) en /tmp/huddle-sonda
// para estudiar los payloads reales. No forma parte del mod. Uso:
//   claude --plugin-dir tests/sonda --model haiku
// y luego anonimizar las capturas antes de copiarlas a tests/fixtures/.
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderElement } from 'claude-code'

const OUT = '/tmp/huddle-sonda'

const vista = atom({ plugin: 'huddle-sonda', key: 'vista' } as const, 'a')

// Claves cuyo texto puede ser del usuario o del modelo: nunca se guarda.
const PRIVADAS = new Set([
  'prompt',
  'last_assistant_message',
  'answer',
  'text',
  'custom_instructions',
  'content',
  'message_text',
])

const forma = (v: unknown, d = 0): unknown => {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return `<string:${v.length}>`
  if (typeof v !== 'object') return typeof v
  if (d > 3) return '<…>'
  if (Array.isArray(v)) return v.length ? [forma(v[0], d + 1), `len=${v.length}`] : []
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) o[k] = forma(x, d + 1)
  return o
}

const redactar = (v: unknown, clave = '', d = 0): unknown => {
  if (typeof v === 'string') {
    if (PRIVADAS.has(clave)) return `<redactado:${v.length}>`
    return v.length > 400 ? `${v.slice(0, 400)}…` : v
  }
  if (v === null || typeof v !== 'object') return v
  if (d > 7) return '<…>'
  if (Array.isArray(v)) return v.slice(0, 30).map(x => redactar(x, clave, d + 1))
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    o[k] = k === 'tool_response' || k === 'result' ? forma(x) : redactar(x, k, d + 1)
  }
  return o
}

let seq = 0
let id = 'pre'
let ticks = 0
const renders = new Set<string>()

async function guardar($: EngineInterface, nombre: string, datos: unknown): Promise<void> {
  const n = String(seq++).padStart(4, '0')
  const ahora = Date.now()
  await $.fs.write(
    `${OUT}/${id}/${n}-${nombre}.json`,
    JSON.stringify({ t: ahora, nombre, datos: redactar(datos) }, null, 2),
  )
}

async function medir<T>(f: () => Promise<T>): Promise<{ ms: number; r?: T; error?: string }> {
  const a = Date.now()
  try {
    const r = await f()
    return { ms: Date.now() - a, r }
  } catch (err) {
    return { ms: Date.now() - a, error: String(err) }
  }
}

const REX = [
  '....####..',
  '....#o####',
  '....######',
  '....####..',
  '#..######.',
  '########..',
  '.######...',
  '..#..#....',
  '..#..#....',
  '..........',
]
const COLOR: Record<string, number> = { '#': 0xd85a30, o: 0x4a1b0c, '.': 0x01000000 }

// Rex a 2x con medios bloques: 20 columnas x 5 filas (cada celda = 2 píxeles verticales).
function rasterRex(t: ElementTable<'terminal'>): RenderElement {
  const cols = 20
  const rows = 5
  const words = new Uint32Array(cols * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const arriba = REX[r * 2]?.[Math.floor(c / 2)] ?? '.'
      const abajo = REX[r * 2 + 1]?.[Math.floor(c / 2)] ?? '.'
      const i = (r * cols + c) * 3
      words[i] = 0x2580 // ▀
      words[i + 1] = COLOR[arriba] ?? 0x01000000
      words[i + 2] = COLOR[abajo] ?? 0x01000000
    }
  }
  const bytes = new Uint8Array(words.buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return t.Raster({ key: 'rex', columns: cols, rows, cells: btoa(bin) })
}

export const register: Register = on => {

  on('classic.*', async ($, e, next) => {
    await guardar($, `classic-${String(next.event).replace('classic.', '')}`, e).catch(() => {})
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    id = await $.session.id().catch(() => 'sin-id')
    const info = {
      entrada: e,
      id,
      cwd: await medir(() => $.session.cwd()),
      root: await medir(() => $.session.root()),
      model: await medir(() => $.session.model()),
      repo: await medir(() => $.session.repo()),
      version: await medir(() => $.session.version()),
      surfaces: await medir(() => $.session.surfaces()),
      usage: await medir(() => $.session.usage()),
      pluginRoot: $.plugin.root,
      comandosBuiltin: await medir(async () =>
        (await $.command.list()).filter(c => String((c as { source?: unknown }).source) === 'builtin').map(c => c.name),
      ),
      tiempos: {
        fsWrite: await medir(() => $.fs.write(`${OUT}/${id}/_prueba.tmp`, '{"a":1}')),
        procMv: await medir(() =>
          $.process.run(['mv', `${OUT}/${id}/_prueba.tmp`, `${OUT}/${id}/_prueba.json`]),
        ),
        procTrue: await medir(() => $.process.run(['true'])),
        gitRevParse: await medir(() =>
          $.process.run(['git', 'rev-parse', '--git-common-dir', '--show-toplevel', '--abbrev-ref', 'HEAD']),
        ),
        fsList: await medir(() => $.fs.list(`${OUT}/${id}`)),
        fsRead: await medir(() => $.fs.read(`${OUT}/${id}/_prueba.json`)),
        fsStat: await medir(() => $.fs.stat(`${OUT}/${id}/_prueba.json`)),
        procRm: await medir(() => $.process.run(['rm', '-f', `${OUT}/${id}/_prueba.json`])),
        envHome: await medir(() => $.env.get('HOME')),
        envWsl: await medir(() => $.env.get('WSL_DISTRO_NAME')),
      },
    }
    await guardar($, 'session.start', info).catch(() => {})
    await $.command.register({ name: 'sonda', description: 'Sonda de Huddle: abre el panel de prueba' })
    await $.command.register({ name: 'sonda-cerrar', description: 'Sonda de Huddle: cierra el panel' })
    await $.command.register({ name: 'sonda-alto', description: 'Sonda de Huddle: panel alto' })
    await $.command.register({ name: 'sonda-avisar', description: 'Sonda de Huddle: prueba $.ui.notify' })
    const todos = await $.command.list()
    await $.fs.write(`${OUT}/comandos.json`, JSON.stringify(todos.map(c => [c.name, c.source, c.plugin ?? null])))
    const abierto = await medir(() => $.ui.open({ id: 'sonda', title: 'Sonda' }))
    await guardar($, 'ui.open-sin-pedir', abierto).catch(() => {})
    $.clock.every(2000, () => {
      ticks += 1
      if (ticks <= 3) {
        void medir(() => $.fs.list(OUT)).then(m => guardar($, `tick-${ticks}`, { ms: m.ms, n: m.r?.length }))
      }
    })
    return r
  })

  on('session.end', async ($, e, next) => {
    await guardar($, 'session.end', e).catch(() => {})
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await guardar($, 'prompt.submit', e).catch(() => {})
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await guardar($, 'turn.start', e).catch(() => {})
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await guardar($, 'turn.complete', {
      e,
      usage: await medir(() => $.session.usage()),
      agentes: await medir(() => $.agent.list()),
    }).catch(() => {})
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    await guardar($, 'agent.spawn', e).catch(() => {})
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const a = Date.now()
    await guardar($, `tool.call-${e.tool}`, {
      e,
      agentes: e.tool === 'Agent' ? await medir(() => $.agent.list()) : undefined,
    }).catch(() => {})
    const r = await next(e)
    await guardar($, `tool.result-${e.tool}`, {
      tool_use_id: e.tool_use_id,
      agentId: e.agentId,
      ms: Date.now() - a,
      r,
      agentes: e.tool === 'Agent' ? await medir(() => $.agent.list()) : undefined,
    }).catch(() => {})
    return r
  })

  on('command.run', { command: 'sonda' }, async ($, e) => {
    const abierto = await $.ui.open({ id: 'sonda', title: 'Sonda' })
    await guardar($, 'command.run-sonda', { e, abierto }).catch(() => {})
    return { text: `Sonda: ${JSON.stringify(abierto)}` }
  })

  on('command.run', { command: 'sonda-alto' }, async $ => {
    const abierto = await $.ui.open({ id: 'sonda', title: 'Sonda', rows: 45, columns: 200 })
    return { text: `Sonda alta: ${JSON.stringify(abierto)}` }
  })

  on('command.run', { command: 'sonda-avisar' }, async $ => {
    const r = await medir(() => $.ui.notify('Prueba de aviso de la sonda', { title: 'Huddle' }))
    await guardar($, 'ui.notify', r).catch(() => {})
    return { text: `notify: ${JSON.stringify(r)}` }
  })

  on('command.run', { command: 'sonda-cerrar' }, async $ => {
    await $.ui.close({ id: 'sonda' })
    return { text: 'Sonda cerrada.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'sonda' }, async ($, e) => {
    const v = await read($, vista)
    const clave = `${e.surface}|${e.props.placement}|${e.props.bodyColumns}|${e.viewport?.columns}|${e.props.scroll.bodyRows}`
    if (!renders.has(clave)) {
      renders.add(clave)
      void guardar($, 'ui.render-pane', { surface: e.surface, props: e.props, viewport: e.viewport })
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const rex = e.surface === 'terminal' ? rasterRex($.ui.resolve({ ...e, surface: 'terminal' })) : null
    return (
      <Box flexDirection="column">
        <Text bold color="#D85A30">
          ▄▄▄▄ Sonda · vista {v} · {e.props.placement} · {e.props.bodyColumns} col · {e.props.scroll.bodyRows} filas
        </Text>
        <Text>{'█'.repeat(Math.max(1, e.props.bodyColumns))}</Text>
        <Text dimColor>viewport {JSON.stringify(e.viewport ?? null)}</Text>
        {rex}
        <Box flexDirection="row">
          <Button key="a" label="Panel" hotkey="p" onPress={() => update($, vista, () => 'a')} />
          <Button key="b" label="Oficina" hotkey="o" onPress={() => update($, vista, () => 'b')} />
        </Box>
      </Box>
    )
  })
}
