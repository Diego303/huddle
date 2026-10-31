// Avisos de escritorio cuando una sesión pasa a «te espera» (§5 del plan).
// En WSL, un toast nativo de Windows con PowerShell y WinRT, sin módulos; en
// Linux, notify-send; en macOS, osascript. Se lanzan sin esperar.

import type { EngineInterface } from 'claude-code'

export type Plataforma = 'wsl' | 'linux' | 'mac' | 'otra'

/** Identificador de PowerShell para que Windows acepte el toast sin registrar una app. */
const APP_POWERSHELL = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'

function xml(texto: string): string {
  return texto.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c)
}

/** El script de PowerShell; los textos van dentro de una cadena literal ('…'), con las comillas dobladas. */
export function scriptToast(titulo: string, texto: string): string {
  const literal = (s: string) => `'${xml(s).replaceAll("'", "''")}'`
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml("<toast><visual><binding template='ToastGeneric'><text>" + ${literal(titulo)} + "</text><text>" + ${literal(texto)} + "</text></binding></visual></toast>")`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_POWERSHELL}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join('\n')
}

/** Base64 de UTF-16LE, lo que espera `powershell -EncodedCommand`. */
export function codificarPowershell(script: string): string {
  let binario = ''
  for (let i = 0; i < script.length; i++) {
    const c = script.charCodeAt(i)
    binario += String.fromCharCode(c & 0xff, c >> 8)
  }
  return btoa(binario)
}

export function argvAviso(plataforma: Plataforma, titulo: string, texto: string): string[] | null {
  switch (plataforma) {
    case 'wsl':
      return [
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        codificarPowershell(scriptToast(titulo, texto)),
      ]
    case 'linux':
      return ['notify-send', '--app-name=Huddle', titulo, texto]
    case 'mac': {
      const s = (v: string) => `"${v.replace(/["\\]/g, '\\$&')}"`
      return ['osascript', '-e', `display notification ${s(texto)} with title ${s(titulo)}`]
    }
    case 'otra':
      return null
  }
}

/** Decide la plataforma con `WSL_DISTRO_NAME` y `uname -s`. */
export function plataformaDe(wslDistro: string | undefined, uname: string): Plataforma {
  if (wslDistro) return 'wsl'
  const u = uname.trim()
  if (u === 'Darwin') return 'mac'
  if (u === 'Linux') return 'linux'
  return 'otra'
}

async function vaciar(flujo: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _ of flujo) {
      // solo se espera a que el proceso acabe
    }
  } catch {
    // sin el programa, no hay aviso
  }
}

/** Lanza el aviso en segundo plano: nunca espera ni falla. */
export function avisar($: EngineInterface, plataforma: Plataforma, titulo: string, texto: string): void {
  const argv = argvAviso(plataforma, titulo, texto)
  if (argv === null) return
  try {
    void vaciar($.process.spawn({ argv }))
  } catch {
    // $.process solo existe en la CLI
  }
}
