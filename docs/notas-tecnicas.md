# Huddle: notas técnicas

> Hallazgos de la Fase 0 y decisiones que se apartan del plan (`docs/PLAN.md`).
> Versión verificada: **Claude Code 2.1.314** (compilada el 2026-10-29), WSL2 Ubuntu 22.04, Node 24.21, pnpm 12.6.
> Fecha: 2026-10-31.

## 0. Cómo se ha verificado

1. Lectura de la skill de creación de mods (`plugin-authoring`) y de la declaración de tipos que genera esta versión (`claude-code.d.ts`, unas 23.000 líneas: cada evento, cada método de `$`, cada elemento de dibujo).
2. Un mod de prueba, la **sonda** (`tests/sonda/`), que guarda cada evento redactado en ficheros JSON. Se cargó con `--plugin-dir` en dos sesiones **interactivas reales**, lanzadas en tmux:
   - una en un repo temporal (`proyecto-a`), en la pantalla principal y en modo `auto`;
   - otra en un worktree del mismo repo (`proyecto-a-wt`), en pantalla completa y en modo `manual`.

   En ellas se ejecutó Bash, un subagente `Explore`, un `Write` con petición de permiso (rechazada), un `AskUserQuestion`, `/clear` y `/exit`, y se abrió y redimensionó el panel.
3. Las capturas se anonimizaron (rutas, usuario, IDs de sesión, de herramienta y de agente; los textos libres, redactados) y están en `tests/fixtures/eventos/{classic,nativos}/`: 43 ficheros.
4. `claude --help`, `claude plugin --help`, `claude plugin validate` y `claude plugin test`, más una prueba real de `claude -p --resume … --fork-session` en solo lectura.

## 1. La tabla §1.1 del plan

| Suposición | Resultado | Qué cambia |
|---|---|---|
| Formato de un mod | ✔ Confirmado, con otra forma (ver §2.1) | Hooks **de función** en TypeScript, no scripts que leen el payload por stdin |
| El panel ocupa toda la vista | ✘ **No es posible** | Plan B: un solo panel con dos vistas (Panel ⇄ Oficina) |
| Eventos y payloads | ✔ Confirmado, con matices importantes (§2.3) | `te_espera`, `en_pausa`, los turnos y los subagentes se detectan con otros eventos |
| Nombre de la herramienta de subagentes | ✔ **`Agent`** (`Task` no existe en esta versión) | Se aceptan los dos nombres por compatibilidad |
| Uso del plan (5 h y semanal) | ✔ **Dato oficial** con `$.session.usage()` | Sin estimaciones `≈` ni lectura de transcripts |
| Flags de `claude` | ✔ Todos existen y la bifurcación en solo lectura funciona | — |
| Instalación desde GitHub | ✔ Documentada (marketplace en el propio repo) | No hace falta `scripts/install.sh`; la instalación real se prueba en la Fase 7 |

## 2. Detalle

### 2.1 Formato del mod

```
.claude-plugin/plugin.json    { name, version, description, "types": "./types/index.d.ts" }
hooks/hooks.json              { "modules": ["./register.tsx"] }   ← un único módulo
hooks/register.tsx            export const register: Register = (on, options) => { … }
types/index.d.ts              contrato de los valores de $.state (interface PluginState)
.claude-plugin/marketplace.json  para instalar desde GitHub
```

- **Hooks de función:** `on(evento, filtro?, ($, e, next) => …)`. `e` es el payload (congelado) y `next(e)` deja seguir al resto de plugins y al motor. No hay procesos por evento: el módulo vive dentro de cada sesión.
- **El módulo no tiene Node ni DOM.** Todo se hace con `$`: `$.fs` (leer, escribir, listar, `stat`), `$.process.run` / `$.process.spawn` (comandos del sistema por argv, sin shell), `$.clock` (`now`, `after`, `every`), `$.session` (id, cwd, repo, modelo, uso), `$.agent.list`, `$.ui` (paneles, toasts, `status`, `notify`), `$.command.register`, `$.prompt.submit`, `$.store` y `$.state`.
- **Regla del validador:** `$` solo puede pasarse a funciones declaradas en el nivel superior de un fichero, o importadas de otro fichero del mod. No vale pasarlo a un cierre (*closure*) creado dentro de `register`. Esto condiciona cómo se organiza `lib/`.
- Los ficheros del mod se importan por ruta relativa y **con extensión `.ts`**, y funciona. Solo se puede importar `claude-code` y ficheros propios: nada de `node:*`.
- **Carpetas reservadas de un plugin:** `commands/`, `agents/` y `skills/` las interpreta el motor (Markdown). Por eso los comandos de Huddle no van en `commands/`, sino en código (ver §3).
- **Comandos:** `$.command.register({ name, description, argumentHint })` en `session.start`, más un hook `command.run` que devuelve `{ text, context? }`. Se invocan **sin prefijo** (`/refresh`, no `/huddle:refresh`). Su salida aparece en el transcript como `huddle: …`. He comprobado los 137 comandos de la sesión y ninguno de los 11 de Huddle choca con un integrado. Ojo, existen `/plan`, `/status`, `/usage`, `/context` y `/config`; los nuestros no se llaman así.
- **Un comando no lanza un turno del modelo por sí mismo.** La parte narrativa de `/refresh`, `/cierre` y `/configurar` (lo que redacta Claude) se encolará con `$.prompt.submit`. Pendiente de verificar en la Fase 5.
- **Opciones:** `userConfig` en el manifiesto da filas en `/config`. La config de Huddle sigue en `~/.config/huddle/config.json`, como pide el plan, porque la comparten todas las sesiones y la editan los comandos.

### 2.2 Pantallas: lo que permite un panel

Un panel se abre con `$.ui.open({ id, title, rows?, columns? })` y se dibuja con un hook `ui.render` sobre `{ component: 'Pane' }`. Medidas reales en un terminal de 200 × 50:

| Disposición | Cuándo | Ancho útil | Alto útil |
|---|---|---|---|
| `inline`, encima del prompt | Pantalla principal (por defecto en tmux, o `CLAUDE_CODE_NO_FLICKER=0`) | **196** de 200 columnas | 14 filas por defecto (un tercio); pidiendo `rows: 45` llegó a **37** |
| `dock`, a la derecha del chat | Pantalla completa | **89** (el máximo es el 45 % del ancho) | 44 a 49 filas |

- **No hay modo «vista completa».** El chat y el prompt siempre siguen a la vista.
- Si se abre sin pedirlo (al arrancar), solo aparece con **144 columnas o más**. Por debajo queda en espera hasta que lo pides con un comando (`/panel`). Comprobado: con 200 columnas se abrió solo.
- **Cambiar de contenido sí se puede:** un valor en `$.state` redibuja el panel. Las teclas funcionan como `hotkey` de un botón cuando el panel tiene el foco (`ctrl+x tab`, o un clic). Probado: la `o` pasó de «vista a» a «vista b». `Esc` devuelve el foco al prompt.
- **Dibujo:** `Box`, `Text` (color hexadecimal o del tema), `Button`, `Markdown` y, **solo en el terminal**, `Raster`: una rejilla de celdas con carácter, color de primer plano y color de fondo. Rex dibujado con medios bloques `▀` a 2× se ve bien. **El motor degrada solo el truecolor a 256 colores** (en tmux salió `38;5;167` para `#D85A30`), así que no hace falta implementar la caída.
- En la app de escritorio o en VS Code no existe `Raster`: allí se dibuja con texto (o con `Svg` en escritorio).

### 2.3 Eventos: qué hay y qué pasa de verdad

Eventos nativos usados: `session.start`, `session.end`, `prompt.submit`, `turn.start`, `turn.complete`, `tool.call`, `agent.spawn` y `ui.render`. Eventos clásicos (`classic.<Evento>`, con el mismo payload que recibiría un hook de `settings.json`): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolBatch`, `PermissionRequest`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop`, `MessageDisplay` y `SessionEnd`. Hay más (`CwdChanged`, `PreCompact`, `Elicitation`…).

**Campos:** los clásicos traen `session_id`, `transcript_path`, `cwd`, `permission_mode`, `prompt_id`, `scratchpad_dir` y `effort`. `classic.PreToolUse` **no** trae el payload clásico, sino el mismo «sobre» que `tool.call`: `{ tool, tool_use_id, …argumentos }`, sin `session_id` (que se obtiene con `$.session.id()`). Dentro de un subagente, los eventos llevan `agentId` (nativos) o `agent_id` (clásicos).

Hallazgos que cambian el plan:

1. **Los subagentes van en segundo plano por defecto.** El `PostToolUse` de `Agent` llega en unos 0,5 s con `tool_response.agentId` y un `status` de lanzado, mientras el subagente sigue trabajando. **Cerrar el subagente en su `PostToolUse` sería un error.** Se cierra con `classic.SubagentStop` (`agent_id`) o con `turn.complete` (que lleva `agentId`). `$.agent.list()` da la lista oficial: `{ id, type, description, status }`, con `status` = `running`, `completed`…
2. **Al terminar un subagente, el motor inyecta un prompt oculto** en la sesión principal (`prompt.submit` con `origin.kind: 'peer'` e `isMeta: true`), y eso dispara `UserPromptSubmit`. **Contar turnos con `UserPromptSubmit` daría números inflados.** Se cuentan solo los `prompt.submit` con `origin.kind === 'composer'`, es decir, lo que tecleas tú.
3. **Petición de permiso o pregunta:** `classic.PermissionRequest` llega **en cuanto aparece el diálogo**, tanto para `Write` como para `AskUserQuestion`. `Notification` con `notification_type: 'permission_prompt'` llega **unos 11 s después**. Por tanto, `te_espera` se activa con `PermissionRequest`, y `Notification` queda como respaldo. El texto de la notificación es genérico y en inglés («Claude needs your permission»), así que **se filtra por `notification_type`, no por el mensaje.**
   - Tipos vistos: `permission_prompt` y `plugin_notification` (este último lo provoca `$.ui.notify`; no debe activar `te_espera`).
   - `idle_prompt` no llegó a aparecer en dos minutos de espera dentro de tmux. No se ha podido capturar, pero no hace falta: no cambia el estado.
4. **Si rechazas un permiso no hay `Stop`**, pero sí `turn.complete` (respuesta vacía, `reason: 'answer'`). Por eso `en_pausa` se activa con el `turn.complete` del bucle principal (sin `agentId`), no con `Stop`.
5. **Al resolverse el permiso**, el `tool.call` que estaba esperando termina (con `isError: true` si lo rechazaste), y la sesión vuelve a `trabajando`.
6. **`/clear` cambia el `session_id`:** llegan `classic.SessionEnd` (`reason: 'clear'`) y `session.end` de la sesión vieja, y luego `classic.SessionStart` (`source: 'clear'`) con un id **nuevo**. No se repite el `session.start` nativo. `/exit` da `reason: 'prompt_input_exit'`.
7. `classic.SessionStart` llega **antes** que `session.start`.

### 2.4 Contexto y uso: datos oficiales

`$.session.usage()` devuelve lo mismo que la status line:

```json
{ "startedAt": 1793406095708,
  "context": { "tokens": 35261, "window": 1000000, "percent": 4 },
  "rateLimits": [ { "kind": "five_hour", "percentUsed": 6,  "resetsAt": "2026-10-31T04:30:00.000Z" },
                  { "kind": "seven_day", "percentUsed": 30, "resetsAt": "2026-11-06T06:00:00.000Z" } ],
  "cost": { "usd": 0.0071 } }
```

- `context.percent` es el porcentaje real de la ventana del modelo, y `window` el tamaño real: 1.000.000 en Haiku 5.5. Antes de la primera respuesta solo hay `window`, así que se muestra `n/d`. **No hace falta leer el transcript** ni la clave `ventana_contexto`, que queda solo como respaldo.
- `rateLimits` da los periodos de 5 h y semanal con su hora de reinicio. Sin suscripción viene vacío: entonces se muestra `n/d · configúralo en config.json`, y `limites` queda como plan B para quien no tenga el dato oficial.
- Es barato: entre 1 y 50 ms por llamada.

### 2.5 Proyecto, rama y rendimiento en `/mnt/d`

Medidas de llamadas a `$` dentro de una sesión, en `/tmp`: `fs.write` 1–10 ms, `fs.read` / `fs.stat` 1–3 ms, `fs.list` 2–24 ms, `process.run` 3–17 ms solo de arranque, `session.repo` 9–41 ms y `session.usage` 1–50 ms. El reloj del entorno del mod es poco fino, así que la Fase 2 las medirá con más muestras.

- **git sobre `/mnt/d` es lento desde WSL:** `git rev-parse --git-common-dir --show-toplevel --abbrev-ref HEAD` tarda **unos 300 ms** y `git status --porcelain` unos 380 ms (en `/tmp`, 6 ms). Un hook que ejecutara git **superaría los 100 ms**.
- **Solución verificada:** `$.session.repo().root` ya devuelve **el repo principal también desde un worktree** (en `proyecto-a-wt` devolvió `proyecto-a`), sin ejecutar git y en unos 10 ms. Es lo que hacía `--git-common-dir`. La rama sale de leer `.git/HEAD` (o, en un worktree, el fichero `.git` → `gitdir: …` → `HEAD`): son metadatos de git y solo dos lecturas pequeñas. Se resuelve una vez por sesión y al cambiar de directorio (`classic.CwdChanged`).
- Los hooks ya no leen el transcript ni ejecutan git: solo el payload, `$.session.*` y `.git/HEAD`.

### 2.6 Escritura atómica y borrado

`$.fs` no tiene `rename` ni `delete`, y `$.fs.write` no promete atomicidad. Para la escritura atómica se escribe en `<fichero>.tmp-<id>` y se mueve con `$.process.run(['mv', …])` (5–17 ms), sin hacer esperar al hook. Además, el lector tolera un JSON a medias y conserva el último que leyó bien. Para borrar en `SessionEnd`: `$.process.run(['rm', '-f', …])`. Si falla (por ejemplo, porque se cerró el terminal de golpe), el fichero caduca: el panel lo muestra como `inactiva` y `/refresh` lo elimina pasadas 24 h.

### 2.7 Presupuesto de un hook

El motor da a cada hook 10 s (1 s al `.catch`). `session.end` tiene un tope global corto para que la salida sea rápida. Un hook que falla se salta, y la sesión sigue. Para cumplir los 100 ms de Huddle, el hook actualiza el estado en memoria, llama a `next(e)` y escribe a disco sin esperar.

### 2.8 Avisos de Windows

- `powershell.exe -NoProfile` con la API WinRT de toasts **funciona sin módulos** y tarda **unos 1,5 s**. Se lanza con `$.process.spawn` sin esperar a que termine. Se envió un único aviso de prueba.
- `$.ui.notify` existe, pero usa el canal de notificaciones del usuario: dentro de tmux devolvió `no-channel`. Además dispara `Notification` (`plugin_notification`). Se queda el toast de PowerShell, como dice el plan.
- **`$.process` solo existe en la CLI.** En la pestaña Code de la app de escritorio, Huddle dibujaría el panel pero no tendría git, avisos ni `/abrir`.

### 2.9 Flags de `claude` para `/preguntar`

Existen todos: `-p`, `--resume`, `--fork-session`, `--permission-mode` (`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk` y `plan`), `--allowedTools`, `--tools`, `--disallowedTools`, `--no-session-persistence`, `--max-budget-usd` y `--permission-prompts none`.

Prueba real, en el worktree temporal:

```
claude -p --resume <id> --fork-session --permission-mode dontAsk \
  --tools "Read,Bash" --allowedTools "Read" "Bash(git log:*)" "Bash(git status:*)" "<pregunta>"
```

Respondió en 11 s, con un `session_id` **nuevo** (la bifurcación), y **denegó** el intento de crear un fichero (`permission_denials`). El repo quedó intacto. Sin `--no-session-persistence`, la bifurcación se guarda como una sesión más; con el flag, no.

- Esta versión de Linux no trae las herramientas `Glob` ni `Grep`: la búsqueda va por `Bash` (`grep`, `rg`, `ls`), así que habrá que permitir esos comandos concretos.
- **El `claude -p` hijo también carga Huddle** y ejecutaría sus hooks. La sesión hija se marcará para que no aparezca en el panel, con una variable `HUDDLE_IGNORAR=1` o porque `isInteractive` es `false`.

### 2.10 Instalación

- Hay que añadir el fichero `.claude-plugin/marketplace.json` en la raíz: `{ "name": "huddle", "owner": { "name": "…" }, "plugins": [{ "name": "huddle", "source": "./" }] }`.
- Instalación: `/plugin install huddle --marketplace <usuario>/huddle` en el prompt, o `claude plugin install huddle --marketplace <usuario>/huddle` desde la shell. Con ámbito de usuario, los hooks se ejecutan en todas las sesiones.
- Durante el desarrollo: `claude --plugin-dir /mnt/d/GitHub/huddle` (una sesión) o `CLAUDE_CODE_PLUGIN_DIRS` en el bloque `env` de `~/.claude/settings.json` (todas). La carpeta se vigila y cada cambio recarga el módulo.
- Desinstalar: `/plugin uninstall huddle`.
- El README dice `/plugin marketplace add …` + `/plugin install huddle@huddle`. Se cambiará a la línea de arriba en la Fase 7, después de probar una instalación real.

### 2.11 Rutas en `/mnt/d`

DrvFs no distingue mayúsculas, y `realpath` conserva la grafía con la que se escribe: `/mnt/d/Github` y `/mnt/d/GitHub` son la misma carpeta (la grafía real es `GitHub`). Por eso, una sesión abierta con `cd /mnt/d/github/GENERAL` tendría otro `cwd` en texto. **Las rutas bajo `/mnt/<letra>/` se comparan sin distinguir mayúsculas.**

### 2.12 Tests y herramientas

- `claude plugin test` ejecuta los `*.test.ts` **en el mismo entorno que los hooks**: sin Node, sin fs, sin red y sin procesos. Lo hace con el kit `claude-code/testing`, que simula el motor (`$.fs`, `$.process` y el reloj se responden con hooks de prueba), monta paneles en una superficie concreta, pulsa botones y avanza el reloj. Probado: los tests de funciones puras y de comandos pasan.
- `node:test` **no carga** ahí, y el runner recoge cualquier `*.test.ts`. Usar los dos runners obligaría a esconder unos tests de otros. **Decisión:** un solo runner, `claude plugin test`, que es el estándar del sistema de mods. `pnpm test` lo envuelve; `pnpm lint` = `tsc --noEmit` + `claude plugin validate .`.
- Dependencias: ninguna en tiempo de ejecución. En desarrollo, solo `typescript`, para comprobar tipos. `recoger` deja de ser un script aparte: se hace dentro del mod con `$.process.run(['git', …])` en paralelo.

## 3. Cambios al plan (propuesta)

| # | Plan | Propuesta |
|---|---|---|
| 1 | Dos pantallas a vista completa | **Un panel con dos vistas**, Panel y Oficina. `/panel`, `/oficina [sesiones\|agentes]` y botones con tecla `p` · `o` · `s` · `a` cuando el panel tiene el foco. **Decidido con el usuario (2026-10-31): el diseño principal es el de pantalla completa**, con el chat y el prompt a la izquierda y el panel acoplado a la derecha (`dock`, unas 89 columnas, todo el alto). La disposición ancha (`inline`, ≥ 100 columnas) queda como secundaria |
| 2 | `te_espera` con `Notification`; `en_pausa` con `Stop` | `te_espera` con `classic.PermissionRequest` (+ `Notification` de tipo `permission_prompt` / `elicitation_dialog`); vuelve a `trabajando` cuando termina el `tool.call`; `en_pausa` con el `turn.complete` principal |
| 3 | Subagentes cerrados en `PostToolUse` o `SubagentStop` | Alta en el `tool.call` de `Agent`/`Task`; cierre en `SubagentStop` o en `turn.complete` con `agentId`; reconciliación con `$.agent.list()` |
| 4 | Contexto leyendo el final del transcript | `$.session.usage().context.percent` en cada `turn.complete` |
| 5 | Uso estimado con `≈` | `$.session.usage().rateLimits` (oficial). Cada sesión guarda el último valor con su hora y el panel usa el más reciente; `n/d` si no hay |
| 6 | Turnos con `UserPromptSubmit` | `prompt.submit` con `origin.kind === 'composer'` |
| 7 | `git rev-parse` en los hooks | `$.session.repo().root` + `.git/HEAD`; ningún git en los hooks |
| 8 | Escritura atómica con `rename` | Temporal + `mv` sin esperar; el lector tolera ficheros a medias |
| 9 | `scripts/recoger` y `commands/*` | Todo dentro del mod (`lib/`); comandos registrados en código (`commands/` está reservada por el motor) |
| 10 | Tests con `node:test` | `claude plugin test` (el runner del sistema de mods) vía `pnpm test` |
| 11 | `/mnt/d/Github/GENERAL` | La grafía real es `/mnt/d/GitHub/GENERAL`; las comparaciones no distinguen mayúsculas |
| 12 | Del `tool_input`, solo la ruta del fichero o la descripción del subagente | Igual. En `Bash`, solo el nombre del programa (`git`, `pnpm`…), nunca el comando entero ni su `description` |

Estructura de repo adaptada:

```
huddle/
├─ .claude-plugin/        plugin.json, marketplace.json
├─ hooks/                 hooks.json, register.tsx (registra eventos y comandos; delega)
├─ mod/                   panel.tsx, oficina.tsx, rex.ts, sprites.ts, raster.ts, disposicion.ts
├─ lib/                   config, rutas, proyectos, fichas, estado, sesiones, agentes, uso,
│                         alertas, git, notificar, registro, tiempo, comandos/*.ts
├─ types/index.d.ts       contrato de $.state
├─ templates/GENERAL/     ESTADO.md, PROYECTOS.md, proyectos/_plantilla.md
├─ tests/                 *.test.ts(x), fixtures/eventos/, sonda/
├─ package.json           packageManager pnpm; scripts test, lint
├─ pnpm-lock.yaml, tsconfig.json, LICENSE, CHANGELOG.md, README.md
└─ docs/                  PLAN.md, notas-tecnicas.md
```

## 4. Datos no disponibles o pendientes

- `idle_prompt`: no se pudo capturar (§2.3). No afecta al estado.
- La instalación real desde GitHub se probará en la Fase 7, con el repo publicado.
- Los tiempos en `/mnt/d` con repos reales (`/refresh` sobre 10 repos en menos de 10 s) se medirán en la Fase 5.
- Sesiones que mueren sin `SessionEnd` (terminal cerrado de golpe): se ven como `inactiva` y `/refresh` las limpia. Claude Code guarda un registro propio de sesiones vivas en `~/.claude/sessions/`, pero no está documentado y Huddle no lo usa.

## 5. Decisiones de la Fase 1

- **`HUDDLE_CONFIG`:** si esta variable existe, la config se lee y se escribe ahí, no en `~/.config/huddle/config.json`. Sirve para probar sin tocar la config real. También se respeta `XDG_CONFIG_HOME`.
- **`/configurar [raíz]`:** la carpeta de control es el directorio de la sesión. Si no se da la raíz, se pregunta con el diálogo de Claude Code. Propone la carpeta padre y tu `HOME`, y en «Type something» se puede escribir otra ruta. Sin nadie a quien preguntar (`-p`), usa la carpeta padre. Nunca sobrescribe: si `PROYECTOS.md` ya existe, solo apunta las carpetas nuevas. Si la carpeta de control está dentro de la raíz, entra directamente en «No hacer seguimiento».
- **Rutas que escribe la persona:** `D:\Github` se convierte en `/mnt/d/Github`, `~` se expande y una ruta relativa se resuelve desde el directorio de la sesión.
- **Escaneo de la raíz:** solo se listan los nombres de primer nivel. Se descartan los ocultos (`.x`), los enlaces simbólicos (`$.fs.list` los marca como `other`), `$RECYCLE.BIN` y `System Volume Information`.
- **Fichas:** las crean `/proyectos` (y `/configurar` cuando vuelve a escanear) para cada carpeta en seguimiento que no tenga ficha. El README se lee con `head -n 40`, para no cargar el fichero entero, y solo una vez: si la ficha existe, no se vuelve a abrir. El objetivo propuesto es la primera frase de texto corrido y se marca «(propuesto a partir del README)». Si no hay ninguna, queda «(por definir)». La plantilla de ficha es `GENERAL/proyectos/_plantilla.md`, que puedes editar; si no existe, se usa la del mod.
- **`PROYECTOS.md`:** se edita como texto, añadiendo líneas al final de «Sin clasificar». Si una carpeta aparece en «No hacer seguimiento» y en otra sección, gana «No hacer seguimiento». Se avisa de duplicados y de códigos repetidos. Las carpetas que ya no existen se avisan, pero no se borran.
- **Validador:** las funciones que reciben `$` están en el nivel superior de su fichero (`lib/`). Los hooks de comando capturan cualquier error y lo devuelven como salida del comando.
- **Prueba real (2026-10-31):** con `HUDDLE_CONFIG` temporal, en `/mnt/d/huddle-pruebas` (repos de prueba creados con permiso), `/configurar`, `/proyectos` y `/directorio D:\huddle-pruebas` funcionan en una sesión real. Lo que no tiene que ver con la prueba no se ha tocado.

## 6. Decisiones de la Fase 2

- **Estado como función pura:** `lib/estado.ts` (`aplicar(estado, evento)`). Los hooks (`hooks/register.tsx`) traducen los eventos del motor y llaman a `registrar`, que es síncrono: solo toca memoria. El disco se escribe 100 ms después, agrupado (`$.clock.after`), con temporal + `mv`.
- **Medido en sesiones reales** con `HUDDLE_DIAG=1`, que añade `diag` al JSON: el trabajo de Huddle dentro de un hook tarda **≤ 3 ms**. En una sesión con la carpeta de control rota (`.agentos` era un fichero), Huddle no escribió nada y la sesión funcionó con normalidad. Cada hook tiene un `.catch` que deja seguir la cadena.
- **Fichero de estado:** los campos de §2.6 más `version`, `tipo` (`torre` · `proyecto` · `otros`), `te_espera_desde`, `contexto_tokens`, `ventana` (la real del modelo) y `uso` (`cinco_horas` / `semana`, cada una con `pct` y `reinicia`, más `leido`). Los IDs visibles (`STR-lead-01`, `STR-explore-01`) los calcula el lector en la Fase 3, porque la numeración depende de todas las sesiones del proyecto.
- **Cuándo pasa a `te_espera`:** `classic.PermissionRequest`, el inicio de `AskUserQuestion`, `classic.Elicitation` (MCP) y `Notification` de tipo `permission_prompt` o `elicitation_dialog`. Vuelve a `trabajando` cuando termina la herramienta o con `PermissionDenied`, y pasa a `en_pausa` con el `turn.complete` principal. Un permiso que pide un subagente pone en espera al subagente y a la sesión.
- **Subagentes:** se dan de alta en el `tool.call` de `Agent`/`Task`. Toman el `agentId` del resultado (`status: async_launched`) o de `SubagentStart`, que se empareja por tipo y en orden. Se quitan con `SubagentStop`, o si `$.agent.list()` (que se consulta tras cada turno) los da por `completed`, `failed` o `killed`. Si `Agent` termina sin ir a segundo plano, o falla, se quitan en el momento.
- **Actividad sin carreras:** cada sesión escribe sus turnos en `.agentos/actividad/<session_id>.json` (30 días). Así dos sesiones nunca pisan el mismo contador. `/refresh` (Fase 5) los juntará en `actividad.json`.
- **Hora local:** el entorno del mod no garantiza la zona horaria, así que el desfase se pide una vez con `date +%z` y las fechas se guardan como `2026-10-31T02:12:15+01:00`.
- **Sesiones que no cuentan:** las no interactivas (`claude -p`, SDK) y las que tienen `HUDDLE_IGNORAR=1` (lo usará `/preguntar`). Sin config, o si la carpeta de control no existe, Huddle no hace nada.
- **Avisos:** uno por sesión cada `repetir_min` minutos, al **entrar** en `te_espera`. La torre no se avisa a sí misma. En la prueba real llegó un toast de Windows al pedir permiso `api-pagos`.
- **Cierre:** `session.end` borra el fichero. Tras `/exit` puede tardar unos segundos, lo que tarda Claude Code en cerrar. Se corrigió una carrera: si había una escritura a medias cuando se cerraba la sesión, el `mv` podía recrear el fichero. Ahora se vuelve a borrar, y hay un test que falla sin el arreglo.

## 7. Decisiones de la Fase 3

- **Solo la torre dibuja:** al arrancar en la carpeta de control (sesión de tipo `torre`), Huddle abre el panel (`$.ui.open`, pidiendo 90 columnas y 44 filas). Lee `.agentos/` cada 2 s y avanza un fotograma de animación cada 600 ms. El resto de sesiones no lee nada.
- **Lector (`lib/lector.ts`):** lista los directorios y solo relee un fichero si cambió su `mtime`. Un JSON a medio escribir se ignora y se conserva el último bueno. Solo publica en `$.state` cuando algo cambió.
- **Contrato de `$.state`:** el panel se publica como un JSON en texto (`huddle.datos`, con forma `datos-1`) para que `types/index.d.ts` no dependa de otros ficheros. El validador exige que los átomos estén declarados en el mismo fichero donde se leen; por eso el dibujo del panel vive en `lib/torre.ts`.
- **Composición en texto puro (`mod/panel.ts` + `mod/lienzo.ts`):** el panel son líneas de segmentos con color, y `mod/dibujar.tsx` las convierte en `Box`/`Text`. Rex es un `Raster` en el terminal y texto con fondo por celda en las demás superficies. Así los tests comprueban el contenido y el ancho exacto de cada línea, y el kit monta el panel de verdad en terminal y escritorio.
- **Disposiciones:** por debajo de 100 columnas, compacta en una sola columna; es la principal, el panel acoplado de ~89. Desde 100, ancha: Rex junto a contadores y sesiones, y dos columnas debajo. Si la lista de sesiones no cabe, se corta con «… y N más».
- **IDs visibles:** `<CÓD>-lead-NN` y `<CÓD>-<tipo>-NN`, numerados por proyecto según el orden de inicio, calculados al dibujar.
- **Contadores:** «Agentes N +M sub» cuenta los leads que están trabajando y los subagentes que no están en pausa.
- **Rex:** `alerta` > `celebrando` (una ficha llegó al 100 % y se modificó en las últimas 24 h) > `trabajando` > `durmiendo`. El nivel empieza en 1 y sube uno cada 100 turnos. La racha cuenta los días seguidos con turnos o commits, y si hoy aún no hay nada empieza a contar en ayer. Los commits llegan con `/refresh` (Fase 5); hasta entonces, en la actividad se ven como `·` (n/d).
- **Uso:** el de la propia torre (`$.session.usage()` en cada lectura) o el más reciente que guardó cualquier sesión. Sin dato, `n/d · configúralo en config.json`.
- **Siguiente acción:** la de `ESTADO.md`; si no hay, por reglas, marcada «(por reglas)»: primero lo que te espera y luego el contexto alto. Las de commits sin push llegan con `/refresh`.
- **Prueba real (pantalla completa, 200 × 50):** el panel se acopló con 89 columnas. Al pedir permiso otra sesión, en ≤ 2 s pasó a «Te esperan 1», Rex se puso en alerta («¡feat-x te espera!») y apareció `STR-explore-01`. Tras aprobar, pasó a trabajando y luego a durmiendo, con el contexto real (4 %).

## 8. Decisiones de la Fase 4

- **Una vista más en el mismo panel:** `huddle.vista` (`panel` u `oficina`) y `huddle.modo` (`sesiones` o `agentes`) viven en `$.state`, así que se cambia de vista y de modo sin reiniciar la sesión. Arriba del panel hay botones `[ Panel ] [ Oficina ]`, y en la oficina además `[ Sesiones ] [ Agentes ]`. Sus teclas son `p`, `o`, `s` y `a`, y funcionan cuando el panel tiene el foco. **`ctrl+x tab` alterna** el foco: púlsalo una vez para dárselo al panel; otra vez, o `Esc`, lo devuelve al prompt.
- **Comandos:** `/oficina [sesiones|agentes]` (sin argumento, el último modo) y `/panel`. Fuera de la carpeta de control explican que no hay panel.
- **Salas:** una por proyecto, con la torre en `GENERAL` y lo de fuera de seguimiento en `otros`, ordenadas como la lista del panel: primero lo que te espera. Cada empleado mide 19 columnas, lo justo para `struo·feat-export`, así que en el panel acoplado caben 4 por fila. Una sala con más de 4 empleados ocupa todo el ancho y pasa a varias filas; las pequeñas se colocan una al lado de otra.
- **Empleados:** `trabajando` teclea (el brazo alterna `▀`/`▄`) con el monitor parpadeando en verde y azul. `te_espera` levanta el brazo con un `!` ámbar que parpadea. `en_pausa` e `inactiva` tienen la cabeza en la mesa y una `z` que se mueve. En el modo agentes, la camiseta lleva el color del rol.
- **Prueba real:** `/oficina` y la tecla `a` (con el panel enfocado) en una sesión real en pantalla completa, con otra sesión trabajando (`PAG-lead-01 · Bash · sleep`).
