# Source Control con Graph para el layout cockpit

Fecha: 2026-11-22 · Estado: borrador para aprobar

## Intención

Mientras los agentes trabajan en Herdr, quiero ver de un vistazo cómo va mi rama de trabajo,
sin salir del panel ni abrir VS Code:

- dónde estoy parado (HEAD);
- cómo avanza mi rama y cómo van los merges;
- de dónde nació mi rama;
- y poder entrar fácil a los commits de mi rama para ver qué tienen y tener su referencia (hash).

La referencia visual es la vista Source Control de VS Code: secciones plegables **Changes** y
**Graph**, con el grafo de carriles de colores, curvas en los merges, chips de ramas e icono de
nube para lo que está en origin. La maqueta aprobada está en
`.superpowers/brainstorm/*/content/panel.html`.

## Objetivos

1. El panel Changes del layout `cockpit` pasa a tener dos secciones plegables, una debajo de otra:
   **Changes** (la lista de archivos de hoy) y **Graph**.
2. Graph muestra la rama actual, su upstream y la **rama base detectada sola**, con:
   - la fila de HEAD resaltada (anillo y chip de la rama actual);
   - carriles de colores, con líneas rectas y curvas en bifurcaciones y merges;
   - chips de ref: la rama actual (relleno de acento), la rama base (borde) y ☁ cuando la ref está en origin;
   - el commit del que nació la rama marcado con «↳ `<rama>` nació aquí»;
   - en la cabecera, `↑N ↓M` respecto al upstream (se oculta si no hay upstream).
3. Al hacer clic en un commit se despliega debajo:
   - una línea con el hash corto, un botón **copiar** (hash completo al portapapeles), el autor y la fecha relativa;
   - la lista de archivos que cambió, con su estado y los conteos `+N` / `−M`.

   Al elegir un archivo, su diff de ese commit aparece en el visor de diff de abajo. Otro clic
   en el commit lo pliega.
4. El visor de diff y la caja de commit siguen como hoy, debajo de las dos secciones.

## No objetivos (v1)

- Acciones de git desde el Graph: fetch, pull, push, checkout, crear rama, cherry-pick o revert.
- Mostrar todas las ramas (`--all`) o un selector Auto/Todas.
- Búsqueda o filtro de commits, o paginación infinita.
- Cambiar el mod `changes` que trae Herdr.

## Anti-objetivos (fracaso aunque funcione)

- Que el panel se vuelva lento o tironee mientras los agentes escriben. El grafo no debe
  recalcularse ni redibujarse entero en cada render.
- Que las lecturas de git dejen escrituras bajo `.git` (locks, index refresh), lo que dispararía
  el `watchFolder` en bucle. Hoy el mod lo evita con `READ`, y debe seguir evitándolo.
- Que la vista se vea ajena al tema cockpit. Los colores salen de `theme()`, no de valores fijos.
- Que un repo sin upstream, sin rama base, con HEAD separado o sin commits muestre un error. En
  esos casos debe degradar con calma.

## Restricciones

- Los mods de Herdr son JavaScript sobre gpui-kit (no hay DOM, CSS ni `setTimeout`). Los archivos
  `~/.config/herdr-app/gpui-kit.d.ts` y `herdr.d.ts` son la referencia de la API.
- El mod `changes` que trae Herdr es de solo lectura: se reemplaza en cada arranque. Se clona con
  `herdr-app do mod.clone '{"name":"changes","as":"cockpit-changes"}'`, y `layouts/cockpit.json`
  pasa a usar `cockpit-changes`. `layouts/main.json` no se toca.
- La API disponible para lo que necesitamos:
  - `PathBuilder` (`move_to`, `line_to`, `cubic_bezier_to`, `stroke(w)`) y `window.paint_path` para dibujar;
  - `v_virtual_list` para filas;
  - `exec` para git (con `on` para máquinas remotas, como ya hace el mod);
  - `write_to_clipboard`;
  - `shared` / `setShared` para estado persistente.
- La validación obligatoria es `herdr-app check mods/cockpit-changes`, más una revisión visual
  en la app con `herdr-app shot`.
- Se trabaja en vivo en `~/.config/herdr-app` y al final se copia al repo `herdr-config`.
- La entrega es una rama nueva en `herdr-config` con:
  - el mod `cockpit-changes`;
  - el cambio en `layouts/cockpit.json`;
  - la fila nueva en la tabla del README;
  - `cockpit-changes` añadido a la lista de archivos propios de la sección License del README
    (`LICENSE` no cambia);
  - este documento.

  Termina con un commit y un pull request contra `main` (decisión del usuario), sin
  atribuciones a Claude.

## Lo decidido

**Alcance del grafo:** HEAD, `@{upstream}` (si existe), la rama base local y `origin/<base>`.
Dentro de ese alcance aparecen también, como carriles propios, las ramas que se mergearon (sus
segundos padres), igual que en la imagen de VS Code.

**Detección de la rama base**, en este orden:
1. `git symbolic-ref --short refs/remotes/origin/HEAD` → `origin/<base>`;
2. si no existe, `main`; luego `master`;
3. si ninguna existe, no hay base: se muestran solo HEAD y su upstream.

Si la rama actual *es* la base, no hay «nació aquí».

**Una sola ref base:** si existe, la base es `origin/<base>` (el paso 1, o `origin/main` /
`origin/master` en los pasos 2 y 3). Solo si no hay remota se usa la rama local. La rama local
`<base>` entra en el alcance, pero en el mismo carril azul, con su propio chip donde apunte. No
recibe un carril ni un color aparte. *Decisión mía:* la local suele estar desactualizada, y
origin es la referencia real de dónde está la base.

**Punto de nacimiento:** el commit desde el que se *creó* la rama, que no siempre es el último
`merge-base`. Si se mergeó la base dentro de la rama, `merge-base` devuelve el commit mergeado y
no el original. El algoritmo:
1. se recorre la cadena de primeros padres de HEAD (`git rev-list --first-parent HEAD`);
2. el primer commit de esa cadena que también es alcanzable desde la base es el punto de
   nacimiento (como en la maqueta).

Los commits anteriores a él en esa cadena son «la rama actual» y van en la columna 0. Si no se
encuentra dentro del límite de commits leídos, no se marca.

**Datos:** un `git log --topo-order -n 300` sobre las refs del alcance, con un formato separado
por caracteres de control: hash, padres, asunto, autor, fecha y `%D` para las refs. Después,
`git rev-list --left-right --count HEAD...@{u}` para `↑↓`. Todo pasa por las banderas `READ`.

**Carriles:** una función pura en `mods/cockpit-changes/graph.js` recibe los commits en orden
topológico. Para cada fila devuelve:
- la columna del nodo;
- su color, que es estable por carril;
- los segmentos que cruzan la fila (rectos o curvos, con columna de entrada y de salida).

La rama actual queda siempre en la columna 0, a la izquierda. Los colores de carril salen de la
paleta `ansi` del tema: el acento para la rama actual y el azul para la base.

**Dibujo:** filas de altura fija.
- Cada fila dibuja solo sus propios segmentos con `paint_path`.
- Los nodos son un círculo relleno; los merges y HEAD llevan un anillo.
- Las filas desplegadas de un commit (meta y archivos) continúan las líneas verticales de los
  carriles que las cruzan.

**Refresco:** el mismo disparador que Changes, es decir, `watchFolder` sobre la raíz y el
temporizador de 10 s. El grafo solo se recalcula si cambió el resultado de
`git rev-parse HEAD @{u} <base>`; si no cambió, se reutilizan las filas ya calculadas. La
cabecera tiene botones de refrescar y de ir a HEAD (desplaza la lista hasta HEAD).

**Plegado y reparto del alto:** el estado abierto o cerrado de cada sección se guarda con
`setShared`, con una clave del mod.
- Changes crece hasta su contenido, con un tope.
- Entre el bloque de secciones (Changes y Graph) y el visor de diff hay un **divisor arrastrable**
  (decisión del usuario). Su posición se guarda con `setShared`, como fracción del alto del panel.
- Si Graph está plegado, Changes y el diff se reparten el alto como hoy.
- Si las dos secciones están plegadas, el diff se queda con todo el espacio.

**Clic en commit:**
- Archivos: `git show --numstat -z --format= <sha>`. En los merges, `git show` no lista nada por
  defecto, así que se usa `git diff --numstat -z <sha>^1 <sha>`.
- Diff de un archivo: `git show --format= --no-color --no-ext-diff <sha> -- <path>`, que entra
  al visor existente (`setLines` y `diffRows`).
- En los merges se usa el diff contra el primer padre (`git diff <sha>^1 <sha> -- <path>`).
  *Decisión mía:* es lo que se espera al revisar qué metió un merge en la rama.
- Solo hay un commit desplegado a la vez. *Decisión mía.*
- Elegir un archivo del Graph deselecciona el archivo elegido en Changes, y al revés: el visor
  de diff muestra una sola cosa.

## Decisiones mías (revisables)

- El límite de 300 commits, sin paginación en la v1.
- Mostrar un máximo de 8 carriles. Si hay más, los carriles extra se dibujan en gris tenue en
  la última columna para no ensanchar la vista.
- El autor va tras el asunto en tono `dim`. La fecha relativa solo aparece en la fila desplegada.
- El chip ☁ aparece cuando el commit tiene una ref `origin/*` que apunta a una rama que también
  existe en local.

## Lo que queda a criterio de quien lo construya

- Las medidas exactas: ancho de columna, radio de los nodos, grosor de las líneas y altura de
  las filas. Deben parecerse a la maqueta.
- Cómo se reparte el código entre `main.js`, `graph.js` y otros módulos.
- El texto exacto de los estados vacíos y de error.
- Si `paint_path` usa coordenadas relativas al elemento o de la ventana. Esto se averigua con una
  prueba corta al empezar, y el dibujo se adapta a lo que resulte.
