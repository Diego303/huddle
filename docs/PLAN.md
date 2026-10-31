# Huddle — plan de implementación

> Tu equipo de Claude Code, de un vistazo: proyectos, sesiones y agentes en un solo panel.
> Documento de referencia para implementar el mod. Rama de trabajo: `develop`.

---

## 0. Objetivo y límites

**Qué es:** un mod de Claude Code que convierte una sesión abierta en una carpeta de control (por ejemplo `D:\Github\GENERAL`, en WSL `/mnt/d/Github/GENERAL`) en la "torre de control" de todos tus proyectos. Muestra:

- cuántas sesiones de Claude Code hay vivas, cuáles te esperan y qué agentes y subagentes se están ejecutando;
- el progreso de cada proyecto, el contexto usado por cada sesión, la actividad de la semana y el uso que te queda;
- una segunda pantalla, la **oficina**, donde ves sesiones o agentes como empleados trabajando en sus mesas.

Todo el estado vive en ficheros Markdown y JSON pequeños, legibles y editables a mano.

**Qué no es (no hacer):**
- Sin base de datos, sin servidor web, sin un proceso propio en segundo plano y sin sincronizar con la nube.
- Sin dependencias en tiempo de ejecución. Solo la librería estándar y lo que ya trae el sistema de mods.
- El mod nunca lee el contenido de las carpetas marcadas como "No hacer seguimiento".
- Los hooks no guardan el texto de los prompts ni el de las respuestas.

**Gestor de paquetes:** si el desarrollo usa Node, se usa **pnpm**, nunca npm ni yarn. Eso implica `pnpm-lock.yaml`, el campo `packageManager` en `package.json` y scripts `pnpm test` / `pnpm lint`. Se permiten dependencias de desarrollo si de verdad aportan algo (por ejemplo TypeScript), pero nada que haga falta para ejecutar el mod.

**Lectura mínima de los proyectos.** Huddle no lee el código de tus proyectos. Para cada proyecto en seguimiento solo usa:

| Qué | Cuándo |
|---|---|
| Metadatos de git: `status --porcelain`, `log` acotado, rama, ahead/behind, `rev-parse` | En `/refresh` |
| Su ficha en `GENERAL/proyectos/<proyecto>.md`, que vive en la carpeta de control y no en el repo | Siempre |
| El `README.md` del repo, solo las primeras ~40 líneas | Una sola vez, al crear la ficha, para proponer el objetivo |

- Más allá de esto, solo se profundiza cuando lo pides de forma explícita: `/proyecto <nombre>`, que puede ejecutar los tests si se le pide, o `/preguntar`, que lanza un Claude en solo lectura y lee lo que necesite para responder.
- Los hooks no leen nada del repo: solo el payload del evento, el final del transcript de su propia sesión y `git rev-parse` para saber a qué proyecto pertenece.

**Principios:**
1. Los hooks son rápidos (menos de 100 ms), atómicos y nunca rompen la sesión: ante cualquier error, salen con código 0 sin hacer nada.
2. Los datos deterministas (git, ficheros de estado) los recoge un script; la parte narrativa (resúmenes, siguiente acción) la escribe Claude.
3. Si un dato no está disponible, se muestra `n/d` o `≈` en vez de inventarlo.

---

## 1. Arquitectura

```
 Sesiones de Claude Code (cualquier repo)         Sesión "torre" en GENERAL/
 ┌──────────────────────────────┐                ┌─────────────────────────────────┐
 │ hooks del mod (ámbito global)│──escriben──▶   │ .agentos/estado/<session>.json  │
 │ SessionStart, PreToolUse,    │                │ .agentos/actividad.json         │
 │ PostToolUse, Notification,   │                └───────────────┬─────────────────┘
 │ Stop, SubagentStop, ...      │                                │ lee (polling 2 s)
 └──────────────────────────────┘                ┌───────────────▼─────────────────┐
                                                 │ Mod: pantalla Panel  ⇄  Oficina │
 Repos en seguimiento ──git (en /refresh)──────▶ │ comandos /refresh, /oficina...  │
                                                 │ ESTADO.md, proyectos/*.md       │
                                                 └─────────────────────────────────┘
```

- El mod se instala a **nivel de usuario**, para que sus hooks se ejecuten en *todas* las sesiones, en cualquier repositorio.
- Las **pantallas** solo se muestran en la sesión cuyo `cwd` es la carpeta de control (`general_dir` en la config). En el resto de sesiones el mod se limita a ejecutar los hooks, sin dibujar nada.
- Los hooks localizan la carpeta de control mediante la config global. Si no existe, no hacen nada.

### 1.1 Lo que hay que verificar primero (Fase 0)

Este plan se apoya en suposiciones razonables que hay que **confirmar en la versión instalada de Claude Code** antes de construir nada:

| Suposición | Cómo verificarla | Plan B |
|---|---|---|
| Formato exacto de un mod: manifiesto, panel o pane, comandos, hooks, cómo se instala | Skill de creación de mods de Claude Code y su documentación | Adaptar la estructura de carpetas de §6 |
| Un panel puede ocupar toda la vista o cambiar de contenido | Probar un mod mínimo | Una sola pantalla que alterna su contenido |
| Eventos de hook disponibles y su payload (`session_id`, `cwd`, `transcript_path`, `tool_name`, `tool_input`, `tool_use_id`…) | Hook temporal que guarde los payloads en `/tmp` | Correlacionar subagentes en orden FIFO |
| Nombre de la herramienta de subagentes (`Task` o `Agent`) | Payloads reales | Aceptar ambos nombres |
| Si Claude Code expone el uso del plan (5 h y semanal) al mod o a la status line | Documentación y payload de la status line | Estimación a partir de los transcripts locales, marcada con `≈` |
| Flags de `claude` para consultar otras sesiones (`-p`, `--resume`, `--fork-session`, `--permission-mode`, `--allowedTools`) | `claude --help` | Usar solo `claude -p` nuevo, en el directorio del repo |
| Instalación del mod desde un repo de GitHub (marketplace de plugins o similar) | Documentación | Script `scripts/install.sh` |

El resultado se documenta en `docs/notas-tecnicas.md`. **Cuando termines la Fase 0, para y resume los hallazgos antes de continuar.**

---

## 2. Datos y ficheros

### 2.1 Config global — `~/.config/huddle/config.json`

```json
{
  "general_dir": "/mnt/d/Github/GENERAL",
  "raiz_proyectos": "/mnt/d/Github",
  "ventana_contexto": 200000,
  "notificaciones": { "windows": true, "repetir_min": 5 },
  "limites": { "sesion_5h_tokens": null, "semana_tokens": null, "reinicio_semanal": "jue 09:00" },
  "inactiva_min": 30
}
```

- La crea `/configurar` y la modifica `/directorio`. Es la única fuente de verdad para las rutas.
- `ventana_contexto`: valor por defecto. Si el nombre del modelo indica 1M, se usa 1.000.000.

### 2.2 Carpeta de control (`GENERAL/`)

```
GENERAL/
├─ ESTADO.md              resumen global (≤ 60 líneas), lo regenera /refresh
├─ PROYECTOS.md           qué carpetas se siguen y cuáles no (lo editas tú)
├─ proyectos/
│  ├─ _plantilla.md
│  └─ <proyecto>.md       objetivo, tareas (checklist), bloqueos, próximos pasos
├─ registro/
│  └─ AAAA-MM.md          diario mensual, una línea por evento
└─ .agentos/              (en .gitignore; no se edita a mano)
   ├─ estado/<session_id>.json
   ├─ actividad.json      turnos por día y por proyecto
   ├─ git-cache.json      lo que recoge /refresh
   └─ ultimo-refresh.json para calcular el "desde la última vez"
```

### 2.3 `PROYECTOS.md`

```markdown
# Proyectos
Raíz: /mnt/d/Github

## Hacer seguimiento
- struo (STR)
- proyecto-b (PRB)
- proyecto-c

## No hacer seguimiento
- GENERAL
- apuntes

## Sin clasificar
- carpeta-nueva
```

- Formato de cada línea: `- <carpeta> [(<CÓDIGO>)]`. Si no se indica código, se usan las 3 primeras letras de la carpeta en mayúsculas.
- La línea `Raíz:` es informativa. La escribe `/directorio` y la ruta real se toma de la config.
- `/proyectos` vuelve a escanear la raíz y añade a "Sin clasificar" las carpetas de primer nivel que no estén en ninguna sección. Nunca las mueve de sección.
- Las carpetas de "No hacer seguimiento" **no se abren nunca**: ni git ni lectura de ficheros.
- Las carpetas de "Sin clasificar" solo generan un aviso en el panel.

### 2.4 `proyectos/<proyecto>.md` (plantilla)

```markdown
---
codigo: STR
fase: ola 3
---
# struo
Objetivo: una línea.

## Estado
Dos o tres líneas, como mucho.

## Tareas
- [x] Tarea hecha
- [ ] Tarea pendiente

## Bloqueos
- (ninguno)

## Próximos pasos
1. ...
```

- **Progreso** = casillas marcadas / casillas totales de `## Tareas`. Si no hay casillas, se muestra `—`.
- `fase` aparece como subtítulo en la barra de progreso.

### 2.5 `ESTADO.md`

```markdown
# Estado general · 2026-10-31 00:46

## Desde la última vez
- feat-auth terminó · CI de struo en verde · 12 commits nuevos

## Hoy
- [ ] Aprobar GATE#1 en struo/feat-export
- [x] Push en proyecto-b

## Siguiente acción
1. ...
2. ...
3. ...

## Proyectos
| Proyecto | Progreso | Estado | Último commit |
|---|---|---|---|
```

- **Tareas de hoy (%)** = casillas marcadas / totales de `## Hoy`.
- **Siguiente acción** la lee el panel. La primera versión la escribe Claude en `/refresh`. Si no existe todavía, se calcula por reglas: primero las sesiones que te esperan, luego las de contexto alto y después los commits sin push.

### 2.6 Estado de una sesión — `.agentos/estado/<session_id>.json`

```json
{
  "session_id": "abc123",
  "proyecto": "struo",
  "codigo": "STR",
  "cwd": "/mnt/d/Github/struo-wt/feat-auth",
  "rama": "feat-auth",
  "estado": "trabajando",
  "detalle": "Edit src/auth.ts",
  "inicio": "2026-10-31T00:10:00+01:00",
  "ultimo_evento": "2026-10-31T00:46:12+01:00",
  "contexto_pct": 48,
  "modelo": "opus",
  "transcript_path": "...",
  "agentes": [
    { "id": "STR-explore-01", "tipo": "explore", "descripcion": "usos de token",
      "tool_use_id": "toolu_...", "inicio": "...", "estado": "trabajando" }
  ]
}
```

- **Proyecto de una sesión:** se resuelve el `cwd` con `git rev-parse --git-common-dir`, para que los worktrees cuenten en su repo principal, y se compara con los proyectos en seguimiento. Una sesión en la carpeta de control es `GENERAL · torre`. Si está en una carpeta fuera de seguimiento, se agrupa en `otros`, sin leer nada del repo.
- **Escritura atómica:** se escribe en un fichero temporal y luego se renombra.
- **Contexto %:** a partir del último mensaje del asistente en `transcript_path`, leyendo solo el final del fichero: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, dividido entre `ventana_contexto`.
- **Privacidad:** de `tool_input` solo se guarda la ruta del fichero o la descripción del subagente, recortada a 60 caracteres.

### 2.7 Estados de una sesión

| Estado | Se activa con | Color | Aviso de Windows |
|---|---|---|---|
| `trabajando` | `UserPromptSubmit`, `PreToolUse`, `PostToolUse` | verde | no |
| `te_espera` | `Notification` de permiso o pregunta | ámbar | sí (con límite de repetición) |
| `en_pausa` | `Stop` (el turno terminó) | gris claro | no |
| `inactiva` | sin eventos durante más de `inactiva_min` | gris | no |
| *(se borra)* | `SessionEnd` | — | — |

- Si `Notification` también salta por inactividad, se distingue por el mensaje: solo las de permiso o pregunta pasan a `te_espera`. Hay que verificarlo en la Fase 0.
- El estado `inactiva` lo calcula el lector, no un hook.
- Los ficheros de más de 24 h sin eventos se eliminan en `/refresh`.

### 2.8 Agentes y subagentes

- **Lead:** el agente principal de cada sesión viva. ID `<CÓD>-lead-NN`, numerado por proyecto según el orden de inicio de la sesión.
- **Subagentes:** se registran en el `PreToolUse` de la herramienta de subagentes (`Task` o `Agent`) y se cierran en su `PostToolUse` (correlacionando por `tool_use_id`) o en `SubagentStop`. Tipo = `subagent_type` normalizado (`explore`, `plan`, `general`…). ID `<CÓD>-<tipo>-NN`.
- Colores por rol: lead `#D85A30`, explore `#7F77DD`, plan `#378ADD`, tests o general `#1D9E75`.

### 2.9 Actividad y uso

- **Turnos por día:** un contador en `actividad.json` que se incrementa con cada `UserPromptSubmit`. Se guarda por proyecto y se conservan 30 días.
- **Commits por día:** `git log --since=7.days` en los repos en seguimiento, durante `/refresh`, guardado en `git-cache.json`.
- **Uso de 5 h y semanal:** usar el dato oficial si Claude Code lo expone. Si no, una estimación a partir de los transcripts locales comparada con `limites`, mostrada con `≈`. Si `limites` es `null` y no hay dato oficial, se muestra `n/d · configúralo en config.json`.

---

## 3. Pantallas

Dos pantallas a vista completa. **Al arrancar en la carpeta de control se muestra el Panel.**

- Cambio de pantalla: `/oficina` y `/panel`, o la tecla o botón que permita el sistema de mods (`o` / `p`, o un botón "Oficina" / "Panel").
- Las pantallas leen `.agentos/estado/*.json` cada 2 s (es barato y local) y `git-cache.json` solo cuando cambia. Durante el polling nunca se ejecuta git.
- **Terminal:** caracteres de bloque `█ ░ ▀ ▄ ▁▂▃▄▅▆▇` y colores truecolor, con caída a 256 colores. Si el terminal mide menos de 100 columnas, se usa una disposición compacta en una sola columna.
- Los wireframes son orientativos: importan la disposición y los datos, no los píxeles exactos.

### 3.1 Panel (dashboard + Rex)

```
┌ huddle · /mnt/d/Github ─────────────────────────── sáb 31 oct · 00:46 · refresh hace 2m ┐
│ Sesiones vivas  Te esperan  Agentes      Tareas hoy        │ Rex                          │
│ 3 /5            1           2 +5 sub     71% ███████░░░    │        ▄▄▄▄                  │
├────────────────────────────────────────────────────────────┤        █▀███                 │
│ Ejecutándose ahora                                         │        ▀▀▀▀                  │
│ ● struo · feat-auth    sesión   editando auth.ts     ◐     │     ▄  ██████                │
│   └ STR-explore-01     explore  usos de token        ◐     │     ████████                 │
│   └ STR-tests-01       tests    vitest 212/240       ◐     │      ▀█▀▀█▀                  │
│ ● struo · feat-export  sesión   espera aprobación    ⏸     │ "¡feat-export te espera!"    │
│ ● prb · main           sesión   migración v2         ◐     │ racha 6 días · nivel 12      │
├──────────────────────────────────────┬─────────────────────┴──────────────────────────────┤
│ Progreso por proyecto                │ Contexto por sesión                                │
│ struo  ola 3 · 5/7  ███████░░░  72%  │ struo·feat-auth    █████░░░░░  48%                 │
│ prb    migración    █████████░  90%  │ struo·feat-export  ████████░░  83%                 │
│ prc    MVP          ████░░░░░░  41%  │ prb·main           ███░░░░░░░  31%                 │
│ prd    pausado      ██░░░░░░░░  18%  │ Alertas                                            │
│                                      │ ▲ feat-export: contexto 83 %, compactar            │
│                                      │ ▲ prb: 3 commits sin push                          │
├──────────────────────────────────────┼────────────────────────────────────────────────────┤
│ Actividad 7 días  ■ commits ■ turnos │ Siguiente acción                                   │
│  ▃▅ ▄▆ ▃▃ ▅█ ▄▇ ▆█ ▁▂                │ 1. Aprobar GATE#1 en struo/feat-export             │
│  L  M  X  J  V  S  D                 │ 2. Compactar esa sesión                            │
│                                      │ 3. Push en prb                                     │
├──────────────────────────────────────┴────────────────────────────────────────────────────┤
│ Sesión 5 h ██████░░░░ 64% · reinicia en 2h 10m   Semana ████░░░░░░ 41% · reinicia jue 09:00│
└ /oficina · /refresh · /preguntar · /abrir ───────────────────────────────── 1 sin clasificar┘
```

**Bloques y origen de los datos:**

| Bloque | Origen |
|---|---|
| Sesiones vivas (`N /total`) | Ficheros de estado no `inactiva` / todos |
| Te esperan | Estado `te_espera` |
| Agentes (`leads +sub`) | §2.8 |
| Tareas hoy | `ESTADO.md` → `## Hoy` |
| Ejecutándose ahora | Árbol de sesiones con sus subagentes; spinner `◐◓◑◒` si trabaja, `⏸` si espera |
| Progreso por proyecto | `proyectos/*.md` (§2.4) |
| Contexto por sesión | `contexto_pct`: azul por debajo del 60 %, ámbar del 60 al 80 %, rojo a partir del 80 % |
| Alertas | Contexto ≥ 80 %, sesión esperando más de 5 min, commits sin push, cambios sin commitear durante más de 3 días, CI en rojo (solo si `gh` está instalado), carpetas sin clasificar |
| Actividad 7 días | Dos minibarras por día: commits (`#7F77DD`) y turnos (`#5DCAA5`) |
| Siguiente acción | `ESTADO.md` → `## Siguiente acción` (máximo 3) |
| Uso | §2.9 |

### 3.2 Rex, la mascota

Sprite de 10×10 (`#` = cuerpo, `o` = ojo, `.` = vacío). En el terminal se dibuja a 2× con medios bloques (`▀ ▄ █`): 20 columnas × 10 filas.

```
....####..
....#o####
....######
....####..
#..######.
########..
.######...
..#..#....
..#..#....
..........
```

- Paleta: cuerpo `#D85A30`, detalle `#F0997B`, ojo `#4A1B0C`.

| Estado de Rex | Cuándo | Animación |
|---|---|---|
| trabajando | hay al menos un agente trabajando | se balancea en 2 fotogramas cada 600 ms |
| durmiendo | no hay nada en marcha | ojo convertido en línea, una `z` que sube |
| alerta | alguna sesión te espera (tiene prioridad) | tiembla y muestra `!` en rojo |
| celebrando | un proyecto llegó al 100 % en las últimas 24 h | salta y aparecen `✦` |

- **Bocadillo:** una frase corta según el estado ("¡feat-export te espera!", "zzz…", "3 agentes en marcha", "¡prb al 100 %!").
- **Racha:** días seguidos con commits o turnos. **Nivel:** +1 cada 100 turnos acumulados.
- **Capricho estacional (Fase 7):** el 31 de octubre Rex lleva una calabaza; en diciembre, un gorro. Lo controla `rex.estacional: true`.

### 3.3 Oficina (sesiones y agentes)

```
┌ huddle · oficina ─── [Sesiones]  Agentes ───── 5 sesiones · 3 trabajando · 1 espera · 1 inactiva ┐
│ ┌ struo ───────────────────────────────── 2 sesiones ┐ ┌ proyecto-b ───────────── 1 sesión ┐ │
│ │   o   ▄▄▄       \o!  ▄▄▄                           │ │   o   ▄▄▄                         │ │
│ │  ▐█▀  █▀█        █   █▀█                           │ │  ▐█▀  █▀█                         │ │
│ │ ▀▀▀▀▀▀▀▀▀▀     ▀▀▀▀▀▀▀▀▀▀                          │ │ ▀▀▀▀▀▀▀▀▀▀                        │ │
│ │ ● struo·feat-auth ● struo·feat-export              │ │ ● prb·main                        │ │
│ │   editando auth.ts  espera GATE#1                  │ │   migración v2                    │ │
│ └────────────────────────────────────────────────────┘ └───────────────────────────────────┘ │
│ ┌ GENERAL ──────────── 1 sesión ┐ ┌ proyecto-c ──────── 1 sesión ┐                           │
│ │ ... torre                     │ │ ... z  inactiva 3h           │                           │
└ /panel · /oficina agentes ──────────────────────────────────────────────────────────────────┘
```

- **Dos modos:** `sesiones`, con un empleado por sesión, y `agentes`, con un empleado por lead y por cada subagente. Se cambia con `/oficina sesiones|agentes`, o con `s` / `a` si el sistema de mods lo permite.
- **Salas:** una por proyecto, con nombre y contador. Una sala con más de 4 empleados ocupa todo el ancho.
- **Empleado:** un sprite de unas 10×4 celdas (persona, mesa y monitor), con una etiqueta debajo (`● <id>`) y su actividad.
  - **Modo sesiones:** etiqueta `<proyecto>·<rama>`.
  - **Modo agentes:** etiqueta `<CÓD>-<tipo>-NN`, y la camiseta lleva el color de su rol.
  - **trabajando:** teclea (el brazo alterna entre 2 fotogramas) y el monitor muestra líneas parpadeando.
  - **te_espera:** brazo levantado y un `!` ámbar parpadeando.
  - **en_pausa / inactiva:** cabeza apoyada en la mesa y una `z`.
- Debajo, una leyenda con los colores de estado y de rol.

---

## 4. Comandos

| Comando | Qué hace | Implementación |
|---|---|---|
| `/configurar` | Primer arranque: crea `GENERAL/` (plantillas), pregunta la raíz, genera `PROYECTOS.md` y la config global, y añade `.agentos/` a `.gitignore` | Prompt + script |
| `/refresh` | Limpia estados caducados, ejecuta git en paralelo sobre los repos en seguimiento (en profundidad solo si cambió el `HEAD` o el `mtime`), regenera `ESTADO.md` con "Desde la última vez", "Siguiente acción" y la tabla de proyectos, y añade 1 o 2 líneas a `registro/` | Script `recoger` (JSON) + Claude redacta |
| `/panel` · `/oficina [sesiones\|agentes]` | Cambia de pantalla o de modo | Mod |
| `/proyecto <nombre>` | Detalle de un proyecto: su `.md`, el git log reciente, las sesiones vivas y, si se pide, los tests | Prompt |
| `/preguntar <proyecto> "<pregunta>"` | Si la sesión del proyecto está `en_pausa` o `inactiva`: la retoma en modo no interactivo (si existe `--fork-session`, en una bifurcación) y en solo lectura. Si está `trabajando` o no hay ninguna: lanza un `claude -p` nuevo en el directorio del repo, en solo lectura. Muestra la respuesta y ofrece guardarla en `registro/` | Script + prompt |
| `/abrir <proyecto>` | En WSL: `wt.exe -w 0 nt --title <proyecto> wsl.exe -d $WSL_DISTRO_NAME --cd <ruta> -- claude`. Fuera de WSL, imprime el comando | Script |
| `/proyectos` | Vuelve a escanear la raíz y actualiza "Sin clasificar" | Script |
| `/directorio <ruta>` | Cambia `raiz_proyectos`, actualiza la línea `Raíz:` y vuelve a escanear | Script |
| `/registro "<texto>"` | Añade `- AAAA-MM-DD HH:MM · <texto>` a `registro/AAAA-MM.md` | Script |
| `/cierre` | Resumen del día en `registro/`, actualiza los próximos pasos de cada proyecto tocado hoy y desmarca `## Hoy` para mañana | Prompt |

- Si el sistema de mods añade prefijos de espacio de nombres a los comandos (por ejemplo `/huddle:refresh`), hay que documentarlo en el README.
- **Solo lectura en `/preguntar`:** usar el modo de permisos más restrictivo que exista (por ejemplo `--permission-mode plan`) o `--allowedTools` limitado a lectura, grep y `git log`/`git status`. Verificar los flags reales en la Fase 0.

---

## 5. Avisos de Windows (WSL)

- Cuando una sesión pasa a `te_espera`, se lanza un aviso nativo de Windows con `powershell.exe -NoProfile` y la API de toasts de WinRT, sin módulos externos.
- **Límite:** un aviso por sesión cada `repetir_min` minutos.
- **Fuera de WSL:** `notify-send` en Linux y `osascript` en macOS. Si no hay ninguno, no se avisa.
- El aviso se lanza en segundo plano, sin esperar a que termine, para no frenar el hook.

---

## 6. Estructura del repo (orientativa; adaptar al formato real de los mods)

```
huddle/
├─ README.md
├─ LICENSE                       MIT
├─ CHANGELOG.md
├─ docs/
│  ├─ PLAN.md                    este documento
│  └─ notas-tecnicas.md          hallazgos de la Fase 0
├─ <manifiesto del mod>          según el formato real
├─ mod/                          pantallas: panel, oficina, rex, sprites, render
├─ commands/                     un fichero por comando de §4
├─ hooks/                        punto de entrada único: hooks/evento.<ext> <EVENTO>
├─ lib/                          config, proyectos (parseo de PROYECTOS.md), estado,
│                                contexto, git, uso, alertas, notificar
├─ scripts/
│  ├─ recoger.<ext>              datos deterministas para /refresh → JSON
│  └─ install.sh                 solo si hace falta (plan B)
├─ templates/GENERAL/            ESTADO.md, PROYECTOS.md, proyectos/_plantilla.md
└─ tests/
   ├─ fixtures/                  payloads reales de hooks (anonimizados), transcripts
   └─ *.test.<ext>
```

- **Lenguaje:** el que use el sistema de mods. Para hooks y scripts, el mismo si es posible.
- Sin dependencias en tiempo de ejecución. Los tests se escriben con el runner estándar del lenguaje (`node:test` o `unittest`).
- Si hay Node, se usa pnpm (ver §0): `pnpm install`, `pnpm test`.

---

## 7. Fases

Cada fase termina con los tests en verde y un commit en `develop` (por ejemplo `feat(hooks): estado de sesiones y subagentes`). **Nunca hacer push ni tocar `main`.**

| Fase | Contenido | Hecho cuando… |
|---|---|---|
| **F0 · Investigación** | Verificar la tabla de §1.1, crear un mod mínimo de prueba y capturar payloads reales | Existe `docs/notas-tecnicas.md` y hay un resumen para el usuario. **Parar aquí y esperar su OK.** |
| **F1 · Esqueleto** | Estructura del repo, manifiesto, config global, `lib/proyectos`, plantillas, `/configurar`, `/directorio`, `/proyectos` | En un directorio temporal, `/configurar` crea la carpeta de control y parsea `PROYECTOS.md` con tests |
| **F2 · Hooks** | Eventos de §2.7, subagentes (§2.8), contexto %, actividad, escritura atómica, avisos (§5) | Con dos sesiones reales en repos distintos aparecen sus JSON correctos; los hooks tardan menos de 100 ms; un error en un hook no afecta a la sesión |
| **F3 · Panel + Rex** | Pantalla §3.1 completa con datos reales o `n/d`, los 4 estados de Rex y la disposición compacta | El panel se actualiza solo al cambiar el estado de otra sesión |
| **F4 · Oficina** | Pantalla §3.3, los dos modos, el cambio con `/panel` y `/oficina` (y teclas si se puede) | Se alterna entre pantallas y modos sin reiniciar la sesión |
| **F5 · Comandos** | `/refresh` (script `recoger` + redacción), `/proyecto`, `/preguntar`, `/abrir`, `/registro`, `/cierre` | `/refresh` sobre 10 repos en `/mnt/d` tarda menos de 10 s; `/preguntar` no modifica nada en el repo destino |
| **F6 · Uso y alertas** | §2.9, alertas de §3.1 y siguiente acción por reglas | Se muestran datos reales, `≈` o `n/d`, nunca valores inventados |
| **F7 · Pulido** | README definitivo, CHANGELOG `v0.1.0`, capricho estacional de Rex y capturas para el README | Una instalación limpia siguiendo solo el README funciona |

---

## 8. Riesgos

- **git lento en `/mnt/d`:** se ejecuta en paralelo, en profundidad solo cuando hay cambios, y nunca durante el polling.
- **Retomar una sesión viva:** `/preguntar` solo retoma sesiones `en_pausa` o `inactiva`, y en bifurcación si se puede.
- **Sesiones en Windows nativo y en WSL:** todas escriben en `general_dir`. Si se usan las dos, la ruta tiene que ser válida en ambos lados; se documenta en el README.
- **La API de mods cambia:** todo el render queda aislado en `mod/` y los datos en `lib/`, para que un cambio de API no obligue a tocar el resto.