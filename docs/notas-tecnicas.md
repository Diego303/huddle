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

## 9. Decisiones de la Fase 5

- **`$.prompt.submit` no se puede llamar desde un hook `command.run`**: el host lo rechaza, porque esperaría al turno que ese mismo hook retiene, y propone hacerlo desde un evento posterior. La parte narrativa de `/refresh`, `/cierre` y `/proyecto … tests` se encola con un temporizador de 50 ms (`lib/encolar.ts`): sale cuando el comando ya contestó y se convierte en un turno en cuanto la sesión queda libre. El kit de tests retiene ese prompt, así que ahí se comprueba el texto y el envío se verificó en real.
- **`/refresh`** (y `/refresh solo-datos`, sin redacción):
  1. Borra los estados con más de 24 h sin eventos.
  2. Junta en `.agentos/actividad.json` la actividad de las sesiones cerradas: por día y proyecto (30 días) más un `total` que no se poda, que es el que usa el nivel de Rex.
  3. Recoge git de las carpetas en seguimiento que existen, todas en paralelo.
  4. Regenera `ESTADO.md` conservando «Hoy», en ≤ 60 líneas.
  5. Apunta una línea en `registro/AAAA-MM.md` y guarda `.agentos/ultimo-refresh.json` para el próximo «desde la última vez».
- **git:** `git --no-optional-locks -C <repo> status --porcelain=v2 --branch` siempre, que da oid, rama, upstream, ahead/behind y cambios en una sola llamada. `git log` (la ventana de 8 días y el último commit) solo si cambió el HEAD. `sucio_desde` recuerda desde cuándo hay cambios sin commitear, para la alerta de más de 3 días. **Medido: 10 repos en `/mnt/d` en 1,0–1,1 s.**
- **`/preguntar <proyecto> "<pregunta>"`:** si hay una sesión del proyecto `en_pausa` o `inactiva`, la más reciente, la retoma en su `cwd` con `--resume <id> --fork-session --no-session-persistence`. Si no, lanza `claude -p` nuevo en el repo. Siempre con `--permission-mode dontAsk`, `--tools Read,Bash` y una lista de comandos de solo lectura (`git log/status/diff/show`, `ls`, `grep`, `rg`, `cat`, `head`, `wc`). El `claude -p` hijo no es interactivo, así que Huddle no lo cuenta como sesión. **Prueba real:** la huella del repo (`sha1sum` de todos los ficheros más `git status`) es idéntica antes y después; pedirle que creara un fichero no tuvo efecto, y la bifurcación recordó lo hablado en la sesión original sin dejar un transcript nuevo. Después pregunta si se guarda en el registro.
- **`/abrir <proyecto>`:** busca por carpeta, por código o por prefijo entre los proyectos en seguimiento. En WSL lanza `wt.exe -w 0 nt --title <proyecto> wsl.exe -d $WSL_DISTRO_NAME --cd <ruta> -- claude` sin esperar; fuera de WSL, devuelve el comando. Probado con tests; no se ha abierto una pestaña real para no dejarte ventanas abiertas.
- **`/proyecto <nombre> [tests]`:** la ficha, `git status` y los 10 últimos commits, y las sesiones del proyecto. Con `tests`, Claude los ejecuta sin modificar nada.
- **`/cierre`:** apunta los números del día (turnos, commits y «Hoy») en el registro, desmarca «Hoy» y le pide a Claude el resumen y los «Próximos pasos» de las fichas de los proyectos tocados hoy, que salen de los turnos y commits de hoy.
- **`/registro "<texto>"`:** añade `- AAAA-MM-DD HH:MM · texto` al diario del mes (lo crea con su título si no existe).

## 10. Decisiones de la Fase 6

- **Uso, de mejor a peor dato:**
  1. El oficial, de `$.session.usage().rateLimits`, de la torre o el más reciente que haya guardado alguna sesión.
  2. Sin dato oficial pero con `limites` en la config, una **estimación marcada con `≈`**: cada sesión suma los tokens de cada turno (`input + output + cache_creation`, también de subagentes) en franjas de una hora dentro de su fichero de actividad. El panel suma las últimas 5 h (con franjas de una hora, la ventana es aproximada) y lo que va de semana desde el último `reinicio_semanal` (por ejemplo `jue 09:00`, hora local).
  3. Si no hay ni lo uno ni lo otro, `n/d · configúralo en config.json`.

  Nunca se muestra un porcentaje sin su origen.
- **Alertas (§3.1):** primero las graves (contexto ≥ 80 % y CI en rojo), después los avisos (sesión esperando más de 5 min, commits sin push, cambios sin commitear desde hace más de 3 días) y al final las carpetas sin clasificar. Se ven 5 como mucho, más «… y N más».
- **CI:** `/refresh` lo consulta solo si `gh` está instalado (`gh --version`) y el repo tiene upstream, con `gh run list --limit 1 --branch <rama> --json status,conclusion`, en paralelo y con 10 s de tope por repo. En esta máquina `gh` no está instalado, así que no hay dato ni alerta; lo cubren los tests.
- **Siguiente acción por reglas (§2.5):** primero las sesiones que te esperan, luego las de contexto alto y después los commits sin push. Como mucho 3, y solo si `ESTADO.md` no tiene las suyas.
- **Prueba real:** con un remoto local y un commit sin subir en `struo`, `/refresh` detectó «1 commit nuevo», y el panel mostró «▲ struo: 1 commit sin push», la regla «Push en struo» y la barra de commits del día.

## 11. Decisiones de la Fase 7

- **Capricho estacional:** `rex.estacional` (por defecto `true`). El 31 de octubre, una calabaza junto a las patas de Rex; en diciembre, un gorro rojo con borla, para lo que Rex baja media celda (la última fila del sprite está vacía). La fecha es la local.
- **README:** instalación con `/plugin install huddle --marketplace <usuario>/huddle`, que es la línea que documenta el sistema de mods, y comandos sin prefijo. Las capturas son reales (de tmux, en pantalla completa a 200 × 50) y se muestran sin color, como bloques de texto. Las de la vista web (`docs/capturas/`) son imágenes de las pruebas con Playwright en Edge, con los datos de ejemplo de los tests (nunca de tus proyectos ni de la prueba en vivo, que llevaba rutas de tu usuario), reducidas a 1000 px de ancho. Todas salen del mismo escenario de prueba (cuatro sesiones, una con subagentes, dos atascos, fichas con progreso y una bitácora de 7 días), generado con `modeloWeb` y capturado en una pasada.
- **Instalación real (2026-10-31, con permiso):** `claude plugin install huddle --marketplace /mnt/d/GitHub/huddle --scope user` añadió el marketplace en la config de usuario e instaló `huddle@huddle`, que se lee de la propia carpeta del repo (`Read from: /mnt/d/GitHub/huddle`). Cuidado: lo que cambies en la carpeta, o la rama que tengas activa, es lo que ejecutan tus sesiones tras `/reload-plugins` o al abrir una nueva. Después, en una sesión normal dentro de `/mnt/d/GitHub/GENERAL`, `/configurar /mnt/d/GitHub` creó la carpeta de control y `~/.config/huddle/config.json`, dejó 37 carpetas en «Sin clasificar» (solo nombres) y abrió el panel en ese momento. En otra sesión (`/mnt/d/GitHub/huddle`) no aparecía ningún comando de Huddle y la torre la veía como `otros · huddle`. Al salir no quedó ningún estado.
- **Pendiente tuyo:** publicar el repo y, si quieres, reinstalar desde GitHub con la línea del README. Para cambiar de origen: `claude plugin uninstall huddle` y luego `claude plugin marketplace remove huddle`. Y clasificar las carpetas en `PROYECTOS.md`.
- `/mnt/d/huddle-pruebas` se borró al terminar.
- **Comandos solo donde sirven** (pedido por el usuario el 2026-10-31): en la carpeta de control, los 11; sin configurar, solo `/configurar`; en cualquier otra sesión, ninguno, de modo que es Claude normal más un hook que anota el estado. El registro espera a saber si la sesión es la torre (`situacion()` de `lib/sesion.ts`). Tras un `/configurar` que funciona, la sesión pasa a ser la torre en el momento: registra los comandos y abre el panel.
- **Alcances de instalación** (según `claude plugin install|enable|disable --help`): `user`, `project` y `local`, y se activa o desactiva por alcance. Están en la sección «Dónde se activa» del README.

## 12. Pase visual del panel (2026-10-31)

Se acercó el panel a la maqueta con lo que permite el terminal. Lo que hay y cómo se ha hecho:

1. **Tarjetas:** `tarjeta()` en `mod/lienzo.ts` las dibuja como texto: `╭─ Título ──╮`, el título en coral claro (`#F0997B`), el contenido con fondo `#21211f` en todas sus celdas y `╰──╯` debajo. El motor no pone títulos dentro del borde de un `Box`, y así cada línea mide exactamente su ancho y se puede volcar como texto.
2. **KPIs:** cuatro tarjetas iguales con números de 3×3 (una fuente de 3×5 píxeles en medios bloques `▀ █ ▄`, `mod/digitos.ts`), el sufijo pequeño al lado y una línea de detalle con alternativas más cortas si no cabe. En ancho, el detalle va en tres líneas a la derecha de los dígitos.
3. **Barras suaves:** `barraSuave()`, en octavos `▏▎▍▌▋▊▉█` sobre una pista `#30302d`. Sin dato, la pista vacía, sin relleno punteado. Contexto y uso, por umbral: azul < 60, ámbar 60–80, rojo ≥ 80.
4. **Rex a 1×:** un lienzo de 14×10 píxeles (los 10 del sprite y 4 para `!`, `z`, `✦` y la calabaza) en 14×5 celdas, dentro de su tarjeta con el bocadillo y la racha debajo. A 2× (28×10) solo en ancho y si sobran filas. Deja de usarse `Raster`: Rex son celdas de texto, para poder meterlo en la tarjeta y que salga en el volcado. **Corregido un fallo que ya existía:** una celda con color solo en la mitad de abajo se dibujaba `▀` con el primer plano por defecto, así que salía media celda blanca encima; ahora es `▄`.
5. **Actividad:** de lunes a domingo de la semana en curso; los días futuros, apagados. Commits y turnos en pares por día, con barras verticales de 4 filas (`▁…█`, resolución de 1/8). Sin valor, un `▁` apagado en la base. Hoy, resaltado. En ancho, cada barra mide 2 columnas.
6. **Rejilla:** tres modos según el ancho.
   - **compacto (70–90):** KPIs 4×1; Rex con «Ejecutándose ahora»; progreso junto a contexto y alertas; actividad junto a siguiente acción; uso (5 h y semana) al pie. Las tarjetas de una fila se igualan en alto.
   - **ancho (> 90):** la misma rejilla con más aire.
   - **estrecho (< 70):** KPIs 2×2 y una tarjeta por fila.
7. **Estados vacíos y progreso:** la tarjeta lista solo los proyectos de «Hacer seguimiento», sin contar el resto de carpetas (pueden no ser proyectos): «8 proyectos en seguimiento». Un proyecto sin ficha sale con su nombre, «sin ficha» y «—», nunca con un 0 % inventado, y debajo «N sin ficha · /proyectos las crea». Sin ninguno en seguimiento: «ningún proyecto en seguimiento». `DatosPanel` trae `seguimiento` (los nombres) y `enSeguimiento`. Sin actividad, el eje con sus `▁` apagados; sin commits, «commits n/d».
8. **Pestañas como píldoras:** botones `plain` con un `Text` de fondo dentro: la activa en coral con el texto oscuro, el resto en gris. Con tecla asignada, el motor antepone `p:` en el color de acento (`p:  Panel  o:  Oficina`), lo que además indica la tecla.
9. **Oficina:** cada empleado es un sprite de 14×10 píxeles (persona, mesa, monitor y teclado) en 14×5 celdas. El monitor lleva el color del estado: verde con parpadeo si trabaja, ámbar si espera, gris en pausa y apagado si está inactivo. Las salas son tarjetas en rejilla que reparten todo el ancho, con varias mesas por fila, centradas.

**Color:** el motor baja solo a 256 o 16 colores según el terminal. En tmux sin `COLORTERM` bajó a 16, y ahí `#21211f` y `#30302d` se convierten en negro, así que el fondo de las tarjetas no se distingue. En Windows Terminal, que tiene truecolor, se ven los colores exactos; con `COLORTERM=truecolor`, tmux los guarda en 256 (fondo 235, píldora 173).

**Rendimiento:** el panel se redibuja cada 600 ms. Los tramos contiguos con el mismo estilo se juntan en un solo `Text` (`compactar`).

## 13. Vista web en vivo (`/huddle web`)

- **Qué hace:** `/huddle web`, desde la carpeta de control, copia `web/dashboard.html` del mod a `.agentos/web/dashboard.html`, escribe `.agentos/web/datos.js` y abre la página. En WSL usa `wslview` si está instalado y, si no, `explorer.exe` con la ruta de `wslpath -w`; en Linux, `xdg-open`; en macOS, `open`. Con `HUDDLE_NO_ABRIR=1` solo dice la ruta.
- **La página no calcula:** `lib/web.ts` (`modeloWeb`) prepara todo lo que se pinta: IDs, estados, colores, textos («reinicia en 2h 10m»), alturas de las barras de actividad (0–100), el texto de la barra de nivel y las dos variantes de la oficina. `datos.js` es una sola línea, `window.HUDDLE = {...}`, con una `version` (FNV-1a del contenido, sin la hora de generación) para que la página no repinte si no ha cambiado nada.
- **Quién escribe `datos.js`, siempre de forma atómica:**
  - **Las sesiones,** tras volcar su estado, como mucho una vez cada 0,7 s y con una escritura final si siguen llegando eventos. Se hace en el temporizador del volcado, nunca dentro de un hook, así que los hooks siguen en ≤ 3 ms. También al cerrarse, para que la web deje de mostrarlas.
  - **La torre,** cuando cambia algo y, aunque no cambie nada, cada 30 s, para que las horas relativas y las sesiones que pasan a inactivas no se queden viejas.
  - **`/refresh`,** al terminar.

  Solo se escribe si existe `.agentos/web/dashboard.html`: quien no use la web no paga nada. Las sesiones vuelven a comprobarlo cada 30 s.
- **Uso en vivo para todos los escritores:** en la prueba real, `datos.js` cambiaba de versión cada 2 s sin que cambiara nada. La torre leía el uso en vivo y las demás sesiones usaban el último guardado, así que cada escritor dejaba un uso distinto. Ahora todos lo leen en vivo con `$.session.usage()`.
- **En vivo sin recargar:** cada 2 s la página inserta `<script src="datos.js?t=…">`, que funciona con `file://`. Repinta solo los bloques cuyo JSON ha cambiado. La pestaña y el modo de la oficina viven en variables (y en el `#hash`, así que sobreviven a recargar), y el scroll no se toca porque solo se reemplaza el interior de los bloques.
- **Autocontenido:** `scripts/comprobar-web.mjs`, dentro de `pnpm lint`, falla si `web/dashboard.html` tiene URLs http(s), `<link>`, `@import`, `fetch`, APIs de red o cualquier `src` que no sea `datos.js`. Pesa unos 21 KB.
- **Diseño:** el de `docs/maquetas/panel.html` y `oficina.html`: sus variables de color en claro y oscuro (según el sistema), sus tarjetas, el árbol de agentes, el Rex en SVG (que ahora además duerme, se balancea, salta y se disfraza) y la función `worker()` de la oficina, más una variante «en pausa». Se comprobó con capturas de Edge sin ventana, en claro y en oscuro, junto a las de las maquetas.
- **Prueba en vivo (≤ 3 s):** página abierta en Edge sin ventana con `?depurar`, que escribe en la consola lo que repinta, y una sesión real lanzando un subagente. **Cuidado al medir:** el reloj de WSL2 iba unos 7 s por detrás del de Windows, así que las primeras medidas parecían de 7–8 s. Comparando los dos relojes con el desfase corregido, el subagente aparece en la página entre 0 y 0,4 s después de estar en el fichero de estado; `datos.js` lo incluye unos 0,1–0,5 s después. La comprobación se hizo en `/mnt/d` (borrado después).
- **Sin probar en real:** que `/huddle web` abra tu navegador. No lo abrí para no dejarte ventanas; el comando que lanza está cubierto por tests.
- **Las maquetas** (`docs/maquetas/`) entraron sin querer en el commit `ab80f0a`, por un `git add -A`.

## 14. `/fichas`: Claude rellena las fichas (2026-10-31)

- **Por qué:** con las fichas recién creadas, el progreso por proyecto sale «sin tareas»: el porcentaje solo puede salir de casillas que alguien haya escrito. `/fichas` se las pide a Claude en vez de inventarlas.
- **Cómo pregunta:** igual que `/preguntar` (§9), con la misma función `sesionQuieta`. Si la sesión del proyecto está en pausa o inactiva, pregunta a una bifurcación suya (`--resume --fork-session --no-session-persistence`), que sabe lo hablado sin molestarla; si está trabajando o no hay ninguna, a un `claude -p` nuevo en el repo. Siempre en solo lectura, con las mismas herramientas.
- **Qué pide:** solo un objeto JSON (`fase`, `objetivo`, `estado`, `tareas[{texto, hecha}]`, `bloqueos`, `proximos`), con la ficha actual en el prompt. Una tarea va como hecha solo si el código o el git lo muestran. Se valida y se limpia: una línea por elemento, sin viñetas ni casillas, como mucho 15 tareas, 3 líneas de estado y 3 próximos pasos. Si la respuesta no trae JSON válido, la ficha no se toca y sale «con error».
- **Qué escribe:** solo lo que sigue como en la plantilla (`fase:` vacía, «Objetivo: (por definir)», «Dos o tres líneas, como mucho.», `## Tareas` sin casillas, «- (ninguno)», «1. …»). Lo que hayas escrito no se toca nunca, y la ficha se vuelve a leer justo antes de escribir, por si la has editado mientras tanto. El estado y las tareas llevan «propuesto por Claude el AAAA-MM-DD», y el objetivo «(propuesto por Claude)». Para rehacer una sección, vacíala y repite `/fichas <proyecto>`.
- **Bloqueos:** «- (ninguno)» es también una respuesta válida, así que no basta por sí solo para volver a preguntar; se rellena cuando ya se pregunta por otra cosa.
- **Selección:** sin argumento, todos los proyectos en seguimiento cuya carpeta existe; los que no tienen ficha se crean antes, como haría `/proyectos`. Los que ya están completos se saltan, así que repetir `/fichas` no gasta nada.
- **En segundo plano:** el comando contesta enseguida y el trabajo sigue en un temporizador (como `encolarPrompt`), tres consultas a la vez y con 5 min de límite cada una. Un cerrojo en `.agentos/fichas.en-curso` evita lanzarlo dos veces; si se queda colgado, caduca a los 20 min. Cada ficha aparece en el panel en cuanto se escribe (el panel relee las fichas por `mtime` cada 2 s). Al acabar, un toast y una línea en el registro con lo rellenado, los errores y el coste sumado (`total_cost_usd`).
- **Privacidad:** lo único que se guarda es lo que Claude propone para la ficha, en tu carpeta de control. Es lo que pides con el comando, como `/preguntar` cuando eliges guardar la respuesta.
- **Coste:** una consulta por ficha incompleta. La bifurcación de una sesión larga cuesta más que un `claude -p` nuevo, porque arrastra su contexto, aunque casi todo va en caché.

## 15. Escenas de la Oficina en la web (2026-10-31)

- **Qué hay:** tres escenas en la Oficina de la web, con un selector en su cabecera: Clásica (la de siempre, sin cambios), Isométrica y Torre, según `docs/maquetas/oficina-escenas.html`. Solo en la web: el panel del terminal no cambia.
- **Datos, no simulación:** `modeloWeb` añade a `datos.js` `escenas` (las salas y los personajes de los dos modos) y `detalles`. Las salas son los proyectos en seguimiento, en el orden de `PROYECTOS.md` y con su % de la ficha, más GENERAL y, solo si alguien está fuera de seguimiento, «otros». Cada personaje lleva una **clave estable** (FNV-1a del `session_id`, y del `tool_use_id` o `agent_id` en los subagentes): los IDs como `STR-lead-02` se renumeran cuando se cierra una sesión, y la página no puede confundir eso con un personaje nuevo. El botón y la lógica de «simular eventos» de la maqueta no existen.
- **Qué mueve a los personajes:** solo los cambios de `datos.js`. Un cambio de estado o de sala lleva al personaje a su sitio nuevo. Un subagente que sigue trabajando y cuya actividad cambia (otra herramienta u otro fichero: es el `detalle` que ya guardan los hooks) hace el viaje a la estantería o al archivo y vuelve; si cambia otra vez durante el viaje, no se encadena otro. Los únicos movimientos sin un evento detrás son los paseos de quien está en pausa, que es lo que pide la tabla. Un subagente nuevo sale de donde está su sesión; una sesión nueva entra por la puerta de su sala o por el ascensor de su planta. En la primera carga, al cambiar de escena y al cambiar de modo, cada uno aparece ya en su sitio.
- **Puestos:** cada sala tiene tantas mesas como personajes, con un mínimo de 2, y cada personaje conserva su mesa mientras puede. En la Isométrica van de 3 en 3 por fila y la sala crece en fondo; en la Torre, en una fila, y se juntan si hay muchas. Quien te espera se pone en la cola de su puerta o de su ascensor por orden de puesto: el primero, justo delante.
- **Isométrica:** rejilla de 2 columnas; la cafetería ocupa la celda que sobra, o una fila entera si no sobra ninguna (y entonces se abre al pasillo de detrás). Las rutas van por los pasillos: se sale por la puerta (marcada con un felpudo), se cambia de fila por la calle central y se entra por la otra puerta. La escena se ajusta al ancho; las baldosas no pasan de 64 px. Los rótulos de sala van al final, como píldoras: en isométrica, la esquina de atrás de una sala toca la de delante de otra, y un rótulo sin fondo se perdía entre las mesas de al lado.
- **Torre:** una planta por sala (proyectos, GENERAL, «otros»), azotea arriba, sótano abajo, ascensor a la derecha, más lento que andar. Con más de 5 proyectos el lienzo tiene un alto máximo (el de 5 proyectos) y se hace scroll.
- **Lienzo:** coordenadas lógicas de 860 de ancho, escaladas al ancho real y multiplicadas por `devicePixelRatio` (hasta 3) para que se vea nítido; se recalcula con un `ResizeObserver`. Paletas clara y oscura de la maqueta, que siguen al sistema en vivo. El paso de tiempo va de 0 a 50 ms. El bucle (`requestAnimationFrame`) solo corre con la pestaña visible, la Oficina a la vista y una escena de lienzo.
- **Detalle:** un `<dialog>` común. Se abre al hacer clic en un personaje o en una fila de «Ejecutándose ahora» (que antes no hacía nada), se actualiza en vivo y, si la sesión se cierra, dice «Ya no está en marcha». Sesión: actividad, proyecto, rama, contexto, modelo, cuándo se abrió, último evento, subagentes y carpeta. Subagente: tarea, actividad, sesión, proyecto y desde cuándo.
- **Persistencia:** escena, modo y etiquetas en `localStorage` (`huddle.oficina`), con `try/catch`. El modo también va en el `#` de la URL, como antes; si el `#` lo dice, manda el `#`.
- **Pruebas con Playwright:** `playwright-core` en una carpeta temporal, fuera del repo, con el Edge de Windows (canal `msedge`). El Chromium de Playwright para Linux no arranca en este WSL: le faltan `libnspr4` y `libnss3`, y para instalarlas haría falta `sudo`. Con `datos.js` generados por el `modeloWeb` real (el ejemplo de los tests, 30 personajes, la oficina vacía y 10 proyectos), en claro y en oscuro, a 2× (38 comprobaciones): las tres escenas se cambian sin recargar y se recuerdan al recargar; cada estado deja al personaje en su sitio (pasillo, cafetería, sala, planta junto al ascensor, azotea); el tooltip y el clic, en el personaje y en el árbol, abren el mismo detalle; la animación se para en el Panel y en la Clásica; con 30 personajes, 127 fps y unos 1,5 ms por fotograma en la Isométrica y 1 ms en la Torre; la consola, sin errores; y la Clásica, igual que antes.
- **Prueba en vivo:** dos sesiones reales de Claude Code (Haiku), en una carpeta de control de prueba con su propio `HUDDLE_CONFIG`, en el temporal de Windows. Tiempos medidos con el reloj de Windows, en ficheros y página a la vez, para no depender del desfase de WSL. El subagente aparece en la página entre 0,4 y 1,9 s después de estar en el fichero de estado, y hace su viaje al cambiar de actividad. La petición de permiso lo lleva al pasillo o junto al ascensor con «!» entre 0,9 y 1,9 s después. Al terminar el turno se va a la cafetería o sube a la azotea.
- **Fallo encontrado en la prueba en vivo:** al abrir la página con una escena de lienzo ya recordada, el primer fotograma podía llegar antes que `datos.js`, sin nada maquetado; el error cortaba el bucle para siempre. Ahora el siguiente fotograma se pide antes de dibujar y no se mueve ni se dibuja nada hasta tener la escena maquetada. Hay una prueba con Playwright que lo reproduce: con el bucle anterior, 0 fotogramas y el error; con el nuevo, anima.

## 16. Pestaña Actividad en la web (2026-10-31)

- **Qué hay:** una tercera pestaña en la web (`#actividad`) con cuatro bloques, según `docs/maquetas/actividad.html`: atascos, cronograma de hoy, bitácora con buscador y uso por proyecto. El panel del terminal no cambia: el estado «atascada» solo existe en la web.
- **Datos nuevos, siempre del código y nunca de Claude:**
  - **Bitácora:** `.agentos/bitacora/<AAAA-MM-DD>/<session_id>.jsonl`, una línea `{ts, tipo, resumen, fichero?, mas?, menos?, ok?, error_hash?}` por evento: ediciones (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, con `+n −m` sacados del `structuredPatch` del resultado), Bash (el comando y, al terminar, `✓` o `✗` con la primera línea del error y su hash), subagentes (al `SubagentStop`, con tipo, descripción y duración), permisos y preguntas (el `message` de `Notification`, más lo que pedía el `PermissionRequest`), y el inicio y el fin de la sesión. Lo de los subagentes lleva delante su tipo (`explore · …`). Las lecturas (`Read`, `Grep`…) no tienen línea, para que la bitácora se pueda leer.
  - **Tramos:** `.agentos/tramos/<AAAA-MM-DD>.jsonl`, `{ts, session_id, estado, nombre, proyecto}` en cada cambio del estado visible (trabajando, te espera, en pausa, inactiva, atascada y, al cerrar, cerrada). `nombre` y `proyecto` van en cada línea para poder dibujar las sesiones ya cerradas. «inactiva» la escribe la propia sesión con un temporizador de `inactiva_min` que se reinicia en cada evento.
  - **Escritura:** los hooks solo anotan en memoria; el volcado (el mismo temporizador de 100 ms del estado) añade las líneas con `sh -c 'cat >> "$1"'`, porque `$.fs` no tiene `append`. Varias sesiones escriben a la vez en el fichero de tramos del día: son líneas cortas en modo `O_APPEND`. Si una escritura falla, sus líneas vuelven a la cola.
  - **Rotación:** al arrancar cada sesión se borran las carpetas de bitácora y los ficheros de tramos de hace más de 7 días.
- **Privacidad:** el estado de la sesión sigue igual, pero la bitácora guarda ahora el comando de Bash, como pide la pestaña. Antes de guardarlo, y también la línea del error, se enmascaran los secretos: `Authorization: …`, credenciales en URLs (`//usuario:***@`), las flags `--password`, `--token`, `--api-key`, `--secret`… (solo esas: `--passWithNoTests` no se toca), las variables cuyo nombre lleva TOKEN, SECRET, PASSWORD, KEY, AUTH o CREDENTIAL, y cualquier tira de más de 24 caracteres alfanuméricos (que también tapa un SHA largo: se prefiere de más a de menos). Todo se trunca a 120 caracteres. Nunca se guarda el texto de un prompt: las preguntas de `AskUserQuestion` quedan como «Claude te hace una pregunta».
- **Error y su hash:** la primera línea que diga error (`error`, `fail`, `cannot`, `not found`…), saltando «Exit code N». El hash (FNV-1a, en `lib/huella.ts`) se calcula sobre esa línea en minúsculas, sin rutas absolutas ni números, para que el mismo error en otra ruta u otra línea cuente igual. Un comando que rechazas, que se interrumpe o que va en segundo plano no cuenta como fallo.
- **Detector de atascos (`lib/atascos.ts`):** puro, por sesión; cada edición, cada comando y cada cambio de estado es una señal. Umbrales en `config.json → atascos` (3 fallos, 5 ediciones en 30 min, 20 min).
  - *Comando en bucle:* el mismo comando (ya enmascarado) falla N veces seguidas con el mismo hash; un error distinto reinicia la cuenta, y mirar ficheros entre medias (`cat`, `ls`, `git status`…) no la corta.
  - *Fichero en bucle:* N ediciones del mismo fichero dentro de la ventana, sin un comando de tests en verde entre medias. La prueba es la evolución de los tests (`41/48 ✗ → 42/48 ✗`), leída de la salida (jest, vitest, pytest, node, bun…).
  - *Sin progreso:* minutos en estado «trabajando» (las esperas y las pausas no cuentan; un hueco de más de 10 min entre eventos cuenta como 10) sin tests en verde, fichero nuevo (`Write` con `type: create`) ni commit (`gitOperation.commit` del resultado o `git commit`).
  - *Limpieza:* tests en verde, un commit o un comando que funciona y no es de solo mirar limpian los bucles de comando y de fichero, y ponen sus cuentas a cero. «Sin progreso» se limpia con lo que mide: tests en verde, un fichero nuevo o un commit; si bastara con un comando cualquiera, no saltaría nunca.
  - Si salta uno más importante (comando > fichero > sin progreso), lo sustituye. Un atasco se identifica por su regla y su clave (comando y hash, o fichero): mientras dure no vuelve a avisar.
  - Qué cuenta como test, como commit y como «solo mirar» está en `lib/bitacora.ts` (`esTest`, `esCommit`, `esSoloLectura`).
- **Atascada:** el atasco va en el estado de la sesión (`atasco`, con un `id` corto). En la web, una sesión con atasco activo que no te espera sale como `x`: en rojo con «↻» en el árbol, en la Oficina clásica, en las escenas (con el monitor en rojo) y en el resumen. En el cronograma, el tramo «atascada».
- **Un aviso por atasco:** por `avisar()`, la misma vía que «te espera», respetando `notificaciones.windows`, pero sin el «repetir_min»: cada atasco nuevo avisa una vez.
- **Ignorar desde la web:** la página es un fichero local y no puede escribir en disco. El botón «ignorar» esconde la tarjeta en ese navegador (`localStorage`) y copia `/huddle ignorar <id>`. Ese comando, en la carpeta de control, guarda `{session_id, clave, tarea}` en `.agentos/atascos-ignorados.json`. La sesión atascada lo ve en su siguiente volcado: solo mira la fecha del fichero y lo relee si cambió. Desde entonces deja de verse en rojo, en la web y en el cronograma. `tarea` cuenta tus prompts en esa sesión: cuando le escribes otra cosa, lo ignorado deja de valer y, si sigue atascada, vuelve a salir (sin volver a avisar).
- **Uso por proyecto:** cada sesión suma los tokens de su transcript y de los de sus subagentes (`<transcript>/subagents/*.jsonl`) por hora local. Lee solo lo nuevo, con `tail -c +N | head -c 4 MB`, y guarda por dónde va en su fichero de actividad. Un mensaje que ocupa varias líneas (mismo `message.id`) cuenta una vez. Se suman `input + output + cache_creation`, como antes con `turn.complete`, que ahora solo queda de respaldo si no hay transcript. Un transcript de más de 4 MB que se ve por primera vez se empieza a leer por el final, para no leer de golpe el historial de una sesión larga. `/refresh` conserva los tokens por proyecto al juntar las sesiones cerradas.
  - El porcentaje de cada proyecto es su parte de los tokens de la ventana multiplicada por el porcentaje oficial: el API da el porcentaje usado, no el límite en tokens. Sin dato oficial, se usan los tokens dividido entre `limites` de `config.json`, con `≈`; sin ninguno de los dos, `n/d`.
  - Las ventanas: la de 5 h y la semanal acaban en su `resetsAt` oficial. Sin él, son las últimas 5 h y la semana desde `reinicio_semanal`.
  - La nota sale por reglas. Primero, el proyecto que más gasta y su motivo: un atasco en la ventana, o lo que más destaca entre sus subagentes y sus ediciones, contados en la bitácora. En la semana, además, la proyección lineal al reinicio: el margen con que llegas, o cuándo llegarías al 100 %.
  - Los selectores dicen «5 h» y «semana», no «hoy» como en la maqueta: la ventana de 5 h no es el día.
- **bitacora.js:** la bitácora de 7 días va aparte (`window.HUDDLE_BITACORA`) y solo se reescribe cuando cambia su versión. `datos.js` lleva esa versión y la página recarga `bitacora.js` cuando cambia, sin perder lo cargado ni el scroll. Los eventos van ya ordenados, con la hora (o el día y la hora, si no son de hoy) y el índice de su sesión. `scripts/comprobar-web.mjs` admite ahora `bitacora.js` además de `datos.js`.
- **Cronograma:** de la primera actividad del día, o de las 9:00 si fue después, hasta ahora. Lo que cada sesión hacía a medianoche (el último tramo de ayer) se arrastra. Una sesión que ya no está y no dejó «cerrada» se corta a los `inactiva_min` minutos, para no inventarse horas de trabajo. Las métricas de espera (total, media por espera y la más larga, con su sesión) salen de los tramos de «te espera».
- **Pruebas:** tests de `lib/atascos` (las tres reglas, su limpieza, los umbrales y lo ignorado), del enmascarado de secretos (también lo que no debe tocar), del hash de errores, de los tramos y las métricas de espera, de la lectura de transcripts, del modelo de la pestaña y, de punta a punta por los hooks, un atasco con su aviso único, su limpieza, un permiso y `/huddle ignorar`. Con Playwright y el Edge de Windows, en claro y en oscuro (28 comprobaciones): atascos e «ignorar», tooltip y clic del cronograma, bitácora de 200 en 200, el buscador con una edición de hace 3 días, el uso por proyecto, «Todo fluye», las atascadas en la Oficina y la consola sin errores.
- **Prueba en vivo:** dos sesiones reales (Haiku) en una carpeta de control de prueba, con su propio `HUDDLE_CONFIG`, y un `powershell.exe` envoltorio delante en el `PATH` para contar los avisos.
  - *Atasco:* `node build.js` fallando tres veces con «Cannot find module './i18n'». El atasco estaba en el estado al tercer fallo y la tarjeta en la página 1,4 s después. Hubo un solo aviso (el cuarto fallo no repitió). Al crear `i18n.js` y volver a ejecutarlo, el atasco desapareció y la página pasó a «Todo fluye». Otra llamada a `powershell.exe`, al arrancar, resultó ser del propio Claude Code (`$env:USERPROFILE`): lo comprobé con una sesión con Huddle desactivado.
  - *Espera de 2 minutos:* aprobé un permiso (`git tag`) 120,5 s después, medidos con el reloj de Windows. El tramo quedó de 23:03:23 a 23:05:24 (121 s) y el cronograma lo dibuja como «23:03–23:05 (2 min)».
  - *Reloj de WSL:* el reloj de la máquina virtual de WSL2 no va al compás del de Windows. En otra prueba, un `sleep 120` de WSL duró 115 s de Windows y 109 s del reloj de pared de WSL. Los tramos usan el reloj de la sesión, y aun así coincidieron al segundo con lo que midió Windows (115 s y 115 s). En modo `acceptEdits`, Claude Code no pide permiso para un `echo > fichero`; por eso el permiso de la prueba fue un `git tag`.
  - *Buscador y uso:* el buscador encontró la edición sembrada de hace 3 días, y el uso por proyecto salió de los tokens reales del transcript.
  - *Fallo encontrado y corregido:* la sesión miraba si habías ignorado su atasco cada 2 s de reloj. Ahora mira la fecha del fichero en cada volcado, que es más barato y no depende del reloj.

## 17. `/fichas actualizar` (2026-11-01)

- **Por qué:** `/fichas` solo rellena lo vacío, así que una ficha con tareas no volvía a mirarse aunque el proyecto avanzara, y el porcentaje se quedaba quieto. `/refresh` no toca las fichas.
- **Qué hace:** `/fichas actualizar` (todas las fichas con tareas) o `/fichas <proyecto> actualizar` (en cualquier orden). Hace la misma consulta en solo lectura que `/fichas` (una bifurcación de la sesión si está quieta, o `claude -p` en el repo), con las tareas numeradas y su marca actual. Claude responde `{"hechas":[…],"fase":"…","estado":"…"}`.
- **Qué escribe:** pasa a `[x]` las tareas cuyo número viene en `hechas`. Nunca desmarca una tarea (si tú la marcaste y Claude no la nombra, sigue hecha) ni cambia su texto. El estado se reescribe solo si está vacío o es de Claude (la línea «_(propuesto/actualizado por Claude el …)_»), y deja la marca «actualizado por Claude» con la fecha; la fase, solo si está vacía. Números fuera de rango o repetidos se descartan. La ficha se vuelve a leer justo antes de escribir.
- Comparte con `/fichas` el segundo plano, el cerrojo, el aviso y la línea del registro (`/fichas actualizar · al día: struo (2 tareas hechas, estado)`).
- **Aviso de ficha atrasada:** `fichasAtrasadas` (en `lib/panel-datos.ts`) compara la fecha de modificación de cada ficha con los commits de la última semana que guarda `/refresh` en `git-cache.json` (`commits_ts`, ahora también en `DatosPanel.git`). Si a la ficha le quedan tareas pendientes y hay `COMMITS_FICHA_ATRASADA` (3) commits o más posteriores, sale una alerta de aviso, en el terminal y en la web, y una acción sugerida («Poner al día la ficha de struo: /fichas struo actualizar»). Sin `/refresh` no hay commits y no se avisa. Se usa la fecha del fichero, así que tocar la ficha a mano (marcar una tarea) también cuenta como ponerla al día.
- **`/cierre`:** después del resumen, `actualizarTocados` lanza en segundo plano `/fichas actualizar` para los proyectos tocados hoy (con turnos o commits) que tienen tareas en su ficha. Si ya había una actualización en marcha, lo dice y no lanza otra. Mientras, el Claude de la torre reescribe los «Próximos pasos» de esas fichas: las dos cosas tocan secciones distintas, y la actualización vuelve a leer la ficha justo antes de escribir.

