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
   /refresh
   ```

## 3. Uso diario

```
cd /mnt/d/GitHub/GENERAL && claude
/refresh
```

- El panel sale solo, a la derecha. En un terminal de menos de 144 columnas, ábrelo con `/panel`.
- `/oficina` y `/panel` cambian de vista.
- Al acabar el día: `/cierre`.

## 4. Dónde está activo Huddle

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

## 5. Desinstalar

```bash
claude plugin uninstall huddle
```

Tu carpeta de control y tus Markdown se quedan donde están.
