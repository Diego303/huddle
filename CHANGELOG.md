# Changelog

## v0.1.0 · 2026-10-31

Primera versión.

### Panel y Oficina
- Un panel en la carpeta de control (acoplado a la derecha en pantalla completa, encima del prompt si no) con dos vistas que se cambian sin reiniciar: `/panel`, `/oficina [sesiones|agentes]` y las teclas `p` `o` `s` `a`.
- Panel: sesiones vivas, sesiones que te esperan, agentes y subagentes, tareas de hoy, progreso por proyecto, contexto por sesión, alertas, actividad de 7 días (commits y turnos), siguiente acción y uso de 5 h y semanal. Disposición compacta (< 100 columnas) y ancha.
- Oficina: salas por proyecto con empleados animados por estado; en modo agentes, con los IDs (`STR-explore-01`) y el color de cada rol.
- Rex, con sus cuatro estados (alerta, celebrando, trabajando y durmiendo), su racha, su nivel y su disfraz estacional.

### Hooks
- Estado de cada sesión en `.agentos/estado/<session_id>.json`: proyecto (los worktrees cuentan en su repo), rama, `trabajando` · `te_espera` · `en_pausa` (e `inactiva`, calculado por el lector), detalle sin datos privados, subagentes en segundo plano, contexto y uso oficiales.
- Turnos por día (solo los que tecleas tú) y tokens por hora para la estimación sin dato oficial.
- Avisos de escritorio al pasar a «te espera»: toast nativo de Windows desde WSL, `notify-send` u `osascript`.
- Rápidos (≤ 3 ms medidos), con escritura agrupada y atómica, sin git, y sin romper nunca la sesión.

### Comandos
- `/configurar`, `/directorio`, `/proyectos`: carpeta de control, `PROYECTOS.md` y fichas.
- `/refresh`: git de los repos en seguimiento en paralelo (10 repos en `/mnt/d` en ~1 s), `ESTADO.md` con «Hoy» conservado, registro, y la redacción de Claude.
- Aviso de ficha atrasada (tareas pendientes y 3 commits o más desde que se tocó) en las alertas y la siguiente acción; `/cierre` pone al día las fichas de los proyectos tocados hoy.
- `/fichas [proyecto] actualizar`: Claude marca como hechas las tareas ya terminadas (sin desmarcar nada ni tocar su texto) y pone al día el estado que había escrito él.
- `/fichas [proyecto]`: Claude rellena en solo lectura lo que falta en las fichas (fase, estado, tareas, próximos pasos), preguntando a una bifurcación de la sesión del proyecto si está en pausa, o a un `claude -p` en su repo. No toca lo que ya hayas escrito.
- `/proyecto [tests]`, `/preguntar` (solo lectura, con bifurcación de la sesión si se puede), `/abrir` (Windows Terminal), `/registro` y `/cierre`.

### Vista web
- `/huddle web`: el Panel y la Oficina en el navegador, en un único fichero autocontenido que relee `datos.js` cada 2 s.
- Escenas de la Oficina: **Clásica**, **Isométrica** (planta abierta en 2,5D, una sala por proyecto) y **Torre** (edificio en corte, una planta por proyecto, azotea, sótano y ascensor), en canvas 2D. Los personajes salen de los datos reales y caminan según su estado; un subagente que cambia de actividad va a la estantería o al archivo y vuelve.
- Detalle de cada sesión y subagente al hacer clic en un personaje o en el árbol «Ejecutándose ahora».
- Pestaña **Actividad**: atascos (comando en bucle, fichero en bucle y sin progreso, con un aviso por atasco), cronograma de hoy con las métricas de espera, bitácora de cada sesión con buscador de 7 días y uso de 5 h y semanal por proyecto. Datos nuevos en `.agentos/bitacora/` y `.agentos/tramos/`, que se borran a los 7 días; `/huddle ignorar <id>`.

### Alertas
- Contexto ≥ 80 %, sesión esperando más de 5 min, commits sin push, cambios sin commitear más de 3 días, CI en rojo (con `gh`) y carpetas sin clasificar.
