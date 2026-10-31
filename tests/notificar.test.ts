import { describe, expect, test } from 'claude-code/testing'

import { argvAviso, codificarPowershell, plataformaDe, scriptToast } from '../lib/notificar.ts'
import { desfaseDeTexto, diaLocal, isoLocal, ultimosDias } from '../lib/tiempo.ts'

describe('avisos', () => {
  test('el toast escapa XML y comillas', () => {
    const s = scriptToast("Huddle · <struo>", "it's & \"x\"")
    expect(s).toContain('&lt;struo&gt;')
    expect(s).toContain('it&apos;s &amp; &quot;x&quot;')
    expect(s).not.toContain("it's")
  })

  test('PowerShell recibe el script en Base64 UTF-16LE', () => {
    expect(codificarPowershell('a')).toBe('YQA=')
    expect(codificarPowershell('·')).toBe('twA=')
    const argv = argvAviso('wsl', 't', 'x') ?? []
    expect(argv.slice(0, 2)).toEqual(['powershell.exe', '-NoProfile'])
    expect(argv[argv.length - 2]).toBe('-EncodedCommand')
  })

  test('Linux, macOS y nada', () => {
    expect(argvAviso('linux', 'T', 'x')).toEqual(['notify-send', '--app-name=Huddle', 'T', 'x'])
    expect(argvAviso('mac', 'T', 'di "hola"')?.[2]).toBe('display notification "di \\"hola\\"" with title "T"')
    expect(argvAviso('otra', 'T', 'x')).toBeNull()
    expect(plataformaDe('Ubuntu', 'Linux')).toBe('wsl')
    expect(plataformaDe(undefined, 'Darwin\n')).toBe('mac')
    expect(plataformaDe(undefined, 'FreeBSD')).toBe('otra')
  })
})

describe('tiempo local', () => {
  test('desfase y fechas', () => {
    expect(desfaseDeTexto('+0100\n')).toBe(60)
    expect(desfaseDeTexto('-05:30')).toBe(-330)
    expect(desfaseDeTexto('raro')).toBe(0)
    const ms = Date.parse('2026-10-30T23:30:00Z')
    expect(isoLocal(ms, 60)).toBe('2026-10-31T00:30:00+01:00')
    expect(diaLocal(ms, 60)).toBe('2026-10-31')
    expect(diaLocal(ms, 0)).toBe('2026-10-30')
    expect(ultimosDias(ms, 60, 3)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31'])
  })
})
