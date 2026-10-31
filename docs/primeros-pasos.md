# Huddle · primeros pasos

Una guía corta de lo que tienes que hacer tú después de instalar Huddle. Los detalles están en el [README](../README.md).

En los ejemplos, la carpeta de control es `/mnt/d/GitHub/GENERAL` y tus proyectos viven en `/mnt/d/GitHub`. Cámbialas por las tuyas.

## 1. Instalar y crear la carpeta de control

```bash
claude plugin install huddle --marketplace <usuario>/huddle --scope user
mkdir -p /mnt/d/GitHub/GENERAL && cd /mnt/d/GitHub/GENERAL && claude
```

Dentro de Claude Code:

```
/configurar /mnt/d/GitHub
```

## 2. Elegir qué proyectos sigue Huddle

1. Abre `PROYECTOS.md`, en la carpeta de control.
2. Mueve cada carpeta de «Sin clasificar» a la sección que le toque:
   - **Hacer seguimiento**: Huddle verá su git y le hará una ficha.
   - **No hacer seguimiento**: Huddle no la abre nunca.
3. Si quieres, ponle un código corto: `- struo (STR)`. Si no, usa las tres primeras letras.
4. En Claude Code, dentro de la carpeta de control:
   ```
   /proyectos
   /fichas
   /refresh
   ```
   `/fichas` hace que Claude mire cada proyecto, en solo lectura, y rellene en su ficha la fase, el estado, las tareas y los próximos pasos. Tarda unos minutos y te avisa al acabar. Revisa lo que proponga: el progreso por proyecto sale de esas tareas (`- [ ]` pendiente, `- [x]` hecha).

## 3. Uso diario

```
cd /mnt/d/GitHub/GENERAL && claude
/refresh
```

- El panel sale solo, a la derecha. En un terminal de menos de 144 columnas, ábrelo con `/panel`.
- `/oficina` y `/panel` cambian de vista.
- Al acabar el día: `/cierre`.

## 4. Vista web en el navegador

Además del panel en el terminal, puedes ver lo mismo en el navegador, y se actualiza solo.

1. En Claude Code, dentro de la carpeta de control:
   ```
   /huddle web
   ```
2. Se abre `.agentos/web/dashboard.html` en tu navegador (en WSL, en el de Windows), con el Panel y la Oficina como pestañas.
3. Déjala abierta: cada 2 s lee los datos nuevos y se actualiza sin recargar. Si lanzas un subagente en otra sesión, aparece en un par de segundos.

- Para volver a abrirla otro día, vuelve a hacer `/huddle web`, o guarda la página en favoritos.
- Para que solo te diga la ruta, sin abrir el navegador: `HUDDLE_NO_ABRIR=1`.
- Si no usas nunca `/huddle web`, tus sesiones no escriben nada para la web.

## 5. Dónde está activo Huddle

Huddle se instala para todas tus sesiones, porque así ve qué hace cada una. Fuera de la carpeta de control no se nota: no dibuja nada ni añade comandos.

**Que una carpeta no salga en el panel.** Desde esa carpeta:
```bash
claude plugin disable huddle --scope local
```
Para volver a activarla: lo mismo, pero con `enable`.

**Que otro plugin exista solo en una carpeta.** Desde esa carpeta:
```bash
claude plugin install <plugin> --marketplace <origen> --scope local
```
En el resto de carpetas, Claude sigue normal.

**Si instalaste Huddle desde una carpeta local** (`--marketplace /ruta/a/huddle`), tus sesiones usan lo que haya en esa carpeta en cada momento, también si cambias de rama. Para pasar a la versión de GitHub:
```bash
claude plugin uninstall huddle
claude plugin marketplace remove huddle
claude plugin install huddle --marketplace <usuario>/huddle --scope user
```

## 6. Desinstalar

```bash
claude plugin uninstall huddle
```

Tu carpeta de control y tus Markdown se quedan donde están.
