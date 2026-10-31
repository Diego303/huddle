# Huddle

**Tu equipo de Claude Code, de un vistazo: proyectos, sesiones y agentes en un solo panel.**

Huddle es un mod de Claude Code para organizar tus proyectos de un vistazo. Abres una sesión en una carpeta de control y ves todas tus sesiones, agentes y proyectos: quién está trabajando, quién te espera, cómo va cada proyecto, cuánto contexto ha usado cada sesión y cuánto uso te queda. Todo el estado se guarda en Markdown sencillo, editable a mano.

<!-- TODO: captura del panel y de la oficina -->

## Qué incluye

- **Panel**: sesiones vivas, sesiones que te esperan, agentes y subagentes en ejecución, progreso por proyecto, contexto por sesión, alertas, actividad de los últimos 7 días, siguiente acción sugerida y uso del periodo de 5 h y de la semana.
- **Oficina**: tus sesiones o tus agentes como empleados en sus mesas, agrupados por proyecto.
- **Un compañero en el panel**: Rex, un pequeño dinosaurio de píxeles que duerme, trabaja, se pone en alerta o celebra según el estado real de tus sesiones.
- **Carpeta de control en Markdown**: `ESTADO.md`, una ficha por proyecto y un diario mensual. Sin base de datos.
- **Avisos de escritorio** cuando una sesión necesita tu aprobación, también en Windows desde WSL.
- **Consultas a otras sesiones** con `/preguntar`, en modo solo lectura.

## Requisitos

- Claude Code con soporte de mods, en la terminal o en la pestaña Code de la app de escritorio.
- git.
- Linux, macOS o Windows con WSL.
- Opcional: [`gh`](https://cli.github.com/), para ver el estado del CI en las alertas.

## Instalación

<!-- Claude Code: confirma estos pasos en la Fase 0 y ajústalos al mecanismo real de instalación de mods -->

1. Instala el mod a nivel de usuario, para que funcione en todas tus sesiones:
   ```
   /plugin marketplace add <tu-usuario>/huddle
   /plugin install huddle@huddle
   ```
2. Crea tu carpeta de control y abre Claude Code en ella:
   ```bash
   mkdir -p /mnt/d/Github/GENERAL && cd /mnt/d/Github/GENERAL && claude
   ```
3. Ejecuta `/configurar` e indica dónde viven tus proyectos (por ejemplo `/mnt/d/Github`).
4. Abre `PROYECTOS.md` y mueve cada carpeta a **Hacer seguimiento** o **No hacer seguimiento**.

Listo. A partir de ahora, cada vez que abras Claude Code en esa carpeta verás el panel.

## Uso diario

```
cd /mnt/d/Github/GENERAL && claude
/refresh
```

| Comando | Para qué |
|---|---|
| `/refresh` | Actualiza todo y te cuenta qué ha pasado desde la última vez |
| `/panel` · `/oficina [sesiones\|agentes]` | Cambia entre el panel y la oficina |
| `/proyecto <nombre>` | Detalle de un proyecto |
| `/preguntar <proyecto> "<pregunta>"` | Pregunta a la sesión de un proyecto (solo lectura) |
| `/abrir <proyecto>` | Abre una pestaña nueva de terminal con Claude Code en ese proyecto |
| `/registro "<texto>"` | Apunta algo en el diario |
| `/cierre` | Resumen del día y próximos pasos |
| `/proyectos` | Busca carpetas nuevas en tu directorio de proyectos |
| `/directorio <ruta>` | Cambia el directorio donde viven tus proyectos |
| `/configurar` | Configuración inicial |

## La carpeta de control

```
GENERAL/
├─ ESTADO.md          resumen global (lo regenera /refresh)
├─ PROYECTOS.md       qué carpetas se siguen y cuáles no
├─ proyectos/         una ficha por proyecto: tareas, bloqueos y próximos pasos
├─ registro/          diario mensual
└─ .agentos/          estado interno (no lo edites; está en .gitignore)
```

**`PROYECTOS.md`:**

```markdown
## Hacer seguimiento
- struo (STR)
- mi-web

## No hacer seguimiento
- apuntes
- descargas
```

- Huddle no abre ni lee nada de las carpetas marcadas como **No hacer seguimiento**.
- El código entre paréntesis (`STR`) se usa en los IDs de los agentes, como `STR-explore-01`. Si no lo pones, se generan las tres primeras letras del nombre.
- **Progreso de un proyecto** = casillas marcadas en la sección `## Tareas` de su ficha.

## Cómo funciona

Los hooks del mod se ejecutan en cada sesión de Claude Code y anotan su estado (proyecto, rama, actividad, contexto y subagentes) en pequeños ficheros JSON dentro de tu carpeta de control. El panel lee esos ficheros cada pocos segundos. `/refresh` añade la información de git y le pide a Claude que redacte el resumen.

**Privacidad:** no se guarda el texto de tus prompts ni de las respuestas. Todo se queda en tu máquina.

**Qué lee de tus proyectos:** solo los metadatos de git (rama, cambios pendientes, commits recientes) y, una sola vez, el principio del README para crear la ficha del proyecto. No lee tu código salvo que se lo pidas con `/proyecto` o `/preguntar`.

## Desarrollo

```bash
pnpm install
pnpm test     # claude plugin test .
pnpm lint     # tsc + claude plugin validate .
```

Usa pnpm, no npm ni yarn. Los tipos del sistema de mods los escribe Claude Code en `.claude-plugin/types/` la primera vez que cargas el mod desde la carpeta (`claude --plugin-dir .`); sin ellos, `tsc` no encuentra `claude-code`.

Para probar sin tocar tu config real, usa `HUDDLE_CONFIG=/tmp/huddle/config.json claude --plugin-dir .`.

## Notas para WSL

- Usa rutas de WSL (`/mnt/d/Github`), no rutas de Windows (`D:\Github`).
- git sobre `/mnt/d` es más lento. `/refresh` lo compensa revisando los repos en paralelo y entrando a fondo solo en los que han cambiado. Si un repositorio se mueve mucho, tenerlo dentro de WSL (`~/`) lo acelera bastante.
- Los avisos de escritorio aparecen como notificaciones nativas de Windows.
- `/abrir` usa Windows Terminal (`wt.exe`).

## Configuración

`~/.config/huddle/config.json`:

| Clave | Por defecto | Qué controla |
|---|---|---|
| `general_dir` | — | Tu carpeta de control |
| `raiz_proyectos` | — | Dónde viven tus proyectos (se cambia con `/directorio`) |
| `ventana_contexto` | `200000` | Tamaño de contexto para calcular el porcentaje |
| `notificaciones.windows` | `true` | Avisos de escritorio |
| `limites.*` | `null` | Límites de uso, si Claude Code no los proporciona |
| `inactiva_min` | `30` | Minutos sin actividad para considerar una sesión inactiva |

## Desinstalar

```
/plugin uninstall huddle
```

Tu carpeta de control y tus Markdown se quedan donde están.

## Licencia

MIT