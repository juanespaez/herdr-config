# Source Control Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clonar el panel Changes de Herdr como `cockpit-changes` y convertirlo en un Source Control
con dos secciones plegables, **Changes** y **Graph**. El Graph dibuja el grafo de la rama actual,
su upstream y la rama base detectada. Al hacer clic en un commit se despliegan sus archivos, y al
elegir uno su diff aparece en el visor de abajo.

**Architecture:** La lógica de git y de carriles va en módulos puros, sin imports de `herdr` ni
de `gpui-kit`. Se prueban con `node --test` contra repos temporales reales. El mod solo pinta:
`main.js` arma el panel, y `draw.js` convierte la fila de carriles en `paint_path`.

**Tech Stack:** JavaScript ESM de mods de Herdr (gpui-kit / gpui-base / herdr), git CLI,
`node:test` (Node 26), y la CLI de Herdr en `/Applications/Herdr.app/Contents/MacOS/Herdr`
(en el plan, `$HERDR`).

**Spec:** `docs/superpowers/specs/2026-11-22-source-control-graph-design.md`

## Global Constraints

- El mod `changes` que trae Herdr no se toca. Todo va en `mods/cockpit-changes`, y solo
  `layouts/cockpit.json` cambia `"mod": "changes"` → `"mod": "cockpit-changes"`.
- Toda lectura de git usa las banderas `READ` del mod original:
  `["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"]`.
- Se leen como máximo 300 commits, y la v1 no tiene paginación.
- Se muestran como máximo 8 carriles (columnas 0–7). Las columnas ≥ 7 se dibujan en la 7 con
  color `dim`.
- Los colores salen de `theme()`: la rama actual usa `accent`, la base `ansi[4]` y el resto
  rota `ansi[3], ansi[5], ansi[6], ansi[2], ansi[1]`. No hay hex fijos en el mod.
- `git` siempre se ejecuta con `exec(..., { cwd: root, on })`, para que funcione en máquinas
  remotas como hoy.
- Los commits no llevan atribución a Claude (ni `Co-Authored-By` ni nada similar), y el PR
  tampoco.
- Un mod no está terminado sin `$HERDR check mods/cockpit-changes` pasando y sin revisarlo en
  la app con `$HERDR shot`.

## Review Focus

1. **HEAD separado** (`git checkout <sha>`): el Graph se dibuja sin chip de rama, sin `↑↓` y
   sin error. → Las pruebas están en las tareas 3 y 4.
2. **Repo sin commits** (`git init` recién hecho): Changes funciona como hoy, y Graph dice
   "No commits yet". → Las pruebas están en la tarea 4.
3. **La rama actual es la base** (estás en `main`): hay un solo carril y no aparece
   «nació aquí». → Las pruebas están en las tareas 3 y 4.
4. **Cambio de espacio mientras carga:** un resultado de git de otro `key()` nunca debe pisar el
   panel actual (el mismo patrón `key() !== context` del mod). → El paso de verificación está en
   la tarea 6.
5. **Asuntos con caracteres raros** (unicode, tabuladores, `|`, emojis): el parseo no se rompe,
   porque los separadores son `\x1f` y `\x1e`. → Las pruebas están en la tarea 2.

---

### Task 1: Clon del mod, repo de trabajo y prueba de `paint_path`

**Files:**
- Create: `~/herdr-config` (clon de trabajo), rama `feat/source-control-graph`
- Create: `mods/cockpit-changes/` (copia de `~/.config/herdr-app/mods/changes`, sin `gpui-kit.d.ts` ni `jsconfig.json`)
- Modify: `layouts/cockpit.json` (`"mod": "changes"` → `"cockpit-changes"`)
- Modify: `install.sh` (añadir `tests` a la lista del `case` que no se instala)
- Create: `tests/cockpit-changes/helpers.mjs`

**Interfaces:**
- Produces: `tests/cockpit-changes/helpers.mjs` exporta
  - `makeRepo(): { dir: string, sh(cmd: string): string, git(args: string[]): Promise<{code:number, stdout:string, stderr:string}> }`,
    con `user.name` y `user.email` configurados;
  - `makeRemote(repo): string`, que crea un bare en otro dir temporal, hace `remote add origin`
    y `push -u origin HEAD`, y ejecuta `git remote set-head origin -a`.
- Produces: la forma de sincronizar con la app. Cada tarea que toca el mod termina con
  `rsync -a --delete mods/cockpit-changes/ ~/.config/herdr-app/mods/cockpit-changes/` más
  `rsync -a layouts/cockpit.json ~/.config/herdr-app/layouts/`.

- [ ] **Step 1:** `git clone https://github.com/juanespaez/herdr-config.git ~/herdr-config && cd ~/herdr-config && git switch -c feat/source-control-graph`
- [ ] **Step 2:** `$HERDR do mod.clone '{"name":"changes","as":"cockpit-changes"}'`. Copiar
  `~/.config/herdr-app/mods/cockpit-changes/{main.js,mod.json,changes.svg}` al repo.
- [ ] **Step 3:** Cambiar el layout, añadir `tests` al `case` de `install.sh` y sincronizar.
  `$HERDR status` debe salir sin errores, y en la app el panel Changes se ve idéntico al de antes.
- [ ] **Step 4:** Escribir `helpers.mjs` y una prueba mínima, `tests/cockpit-changes/helpers.test.mjs`
  (`makeRepo` crea un commit y `git(["log","--oneline"])` devuelve 1 línea). Correr
  `node --test tests/` → PASS.
- [ ] **Step 5 (prueba de `paint_path`, desechable):** crear `~/.config/herdr-app/mods/probe-path`
  con una fila de 28 px y un `paint_path` que dibuje una curva de (12,14) a (28,28). Montarlo
  en un overlay o un split de pane, y con `$HERDR shot` ver si las coordenadas son relativas al
  elemento o a la ventana. Anotar el resultado en la sección "Notas de ejecución" al final de
  este plan, y después borrar `probe-path`.
- [ ] **Step 6:** commit `Clone changes as cockpit-changes for the cockpit layout`.

### Task 2: Parseo del log y punto de nacimiento (`graph.js`)

**Files:**
- Create: `mods/cockpit-changes/graph.js`
- Test: `tests/cockpit-changes/graph.test.mjs`

**Interfaces:**
- Produces:
  - `LOG_FORMAT = "%H%x1f%P%x1f%s%x1f%an%x1f%at%x1f%D%x1e"`
  - `parseLog(stdout: string): Commit[]`, con
    `Commit = { sha, parents: string[], subject, author, time: number, refs: string[] }`.
    En `refs`, `"HEAD -> x"` se convierte en `"x"` y el `HEAD` suelto se omite.
  - `findForkPoint(firstParents: string[], inBase: Set<string>): string | null` devuelve el
    primer sha de `firstParents` que está en `inBase`.

- [ ] **Step 1:** Escribir las pruebas:
  - `parseLog` con dos registros, uno cuyo asunto lleva `\t`, `|` y `ñ🚀` → los asuntos se
    conservan intactos;
  - `refs` de `"HEAD -> feat/x, origin/feat/x, tag: v1"` → `["feat/x","origin/feat/x","tag: v1"]`;
  - un commit raíz → `parents: []`;
  - un stdout vacío → `[]`;
  - `findForkPoint(["c7","c6","c5","c4","m1","m0"], new Set(["m3","m2","m1","m0"]))` → `"m1"`.
    Es el caso de la maqueta: el merge de main metió `m2`, pero la cadena de primeros padres
    llega a `m1`;
  - sin coincidencia → `null`.
- [ ] **Step 2:** `node --test tests/` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar en `graph.js`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** commit `Parse git log and find where the branch was born`.

### Task 3: Asignación de carriles (`layoutGraph`)

**Files:**
- Modify: `mods/cockpit-changes/graph.js`
- Test: `tests/cockpit-changes/graph.test.mjs`

**Interfaces:**
- Consumes: `Commit` (tarea 2).
- Produces: `layoutGraph(commits: Commit[], opts: { head: string|null, branch: Set<string>, base: string|null, fork: string|null }): Row[]`
  - `branch`: los shas de la cadena de primeros padres de HEAD que van antes de `fork`.
  - `Row = { commit, col: number, color: Color, node: "head"|"merge"|"commit", fork: boolean, top: Seg[], bottom: Seg[] }`
  - `Seg = { from: number, to: number, color: Color }`. En `top` va de la columna en el borde
    superior de la fila a la columna del nodo (o recto); en `bottom`, del nodo o de una columna
    que pasa al borde inferior.
  - `Color = "branch" | "base" | "overflow" | number` (un índice de rotación).
  - `through(row: Row): Seg[]` devuelve los segmentos rectos de `bottom` que siguen debajo de la
    fila. Lo usan las filas desplegadas.

Reglas del algoritmo (no las determinan las pruebas por sí solas):
- Se mantiene `active[c] = { sha esperado, color }`, y `active[0]` empieza en `head` con color
  `"branch"`.
- Un commit va en la primera columna que lo espera. Si **no** está en `branch` y también lo
  espera otra columna distinta de 0, va en esa otra columna. Así el commit donde nació la rama
  cae en el carril de la base, y el carril 0 hace la curva hacia él.
- Las demás columnas que esperaban el mismo sha cierran con un `top` curvo hacia el nodo y
  quedan libres.
- `parents[0]` hereda la columna y el color del nodo. Cada padre extra reutiliza la columna que
  ya lo espera, o toma la primera libre; en ambos casos hay un `bottom` curvo del nodo a esa
  columna. Una columna nueva recibe el color `"base"` si su primer commit es el de la base y,
  si no, el siguiente índice de rotación.
- Las columnas ≥ 7 se colapsan en la 7 con `color: "overflow"`.

- [ ] **Step 1:** Escribir las pruebas con commits fabricados a mano (sin git):
  - **lineal** (3 commits): todas las filas en `col` 0, la primera con `node: "head"`, sin
    curvas;
  - **maqueta** (`c7,c6,m3,c5,m2,c4,m1,m0`, donde `c5` tiene los padres `[c4,m2]` y `c4` tiene
    `[m1]`):
    - `col` → `[0,0,1,0,1,0,1,1]`;
    - `rows[3].node === "merge"`, y su `bottom` incluye `{from:0,to:1}`;
    - el `bottom` de `rows[5]` incluye `{from:0,to:1}`;
    - `rows[6].fork === true`;
    - la columna 0 tiene `color "branch"` y la 1 `color "base"`;
  - **rama mergeada en main** (como en la imagen de VS Code): el merge en main con un segundo
    padre `f2` → `f2` en `col` 1 con color numérico, y una curva `top` de regreso al cerrar;
  - **9 ramas abiertas** a la vez → ninguna `col` > 7, y las sobrantes con `"overflow"`;
  - **HEAD separado** (`head` presente, `branch` vacío, `base` null) → sin errores, y la fila
    0 con `node: "head"`;
  - **estás en la base** (`fork` null y `branch` igual a todos los commits) → todo en
    `col` 0, y ninguna fila con `fork`;
  - **`through`** de `rows[1]` en la maqueta → un solo segmento `{0→0}`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Implementar `layoutGraph` y `through` en `graph.js`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** commit `Assign graph lanes like VS Code's source control graph`.

### Task 4: Consultas de git (`repo.js`)

**Files:**
- Create: `mods/cockpit-changes/repo.js` (sin imports de `herdr`: recibe `git`)
- Test: `tests/cockpit-changes/repo.test.mjs`

**Interfaces:**
- Consumes: `parseLog`, `LOG_FORMAT`, `findForkPoint`, `layoutGraph` (tareas 2 y 3).
- Produces (`git = (args: string[]) => Promise<ExecResult>`, que ya incluye `READ`):
  - `detectBase(git, current: string|null): Promise<string|null>`. Sigue el orden de la spec
    (primero `origin/HEAD`, después `origin/main`, `origin/master`, `main` y `master`).
    Devuelve `null` si no hay ninguna.
  - `graphKey(git): Promise<string>`, que es `rev-parse HEAD @{u} <base>` concatenado. Los que
    fallan cuentan como `"-"`.
  - `loadGraph(git): Promise<{ rows: Row[], branchName: string|null, upstream: string|null, base: string|null, ahead: number|null, behind: number|null, key: string }>`.
    Lee `log --topo-order -n 300 --format=LOG_FORMAT HEAD [@{u}] [base] [local base]`, y
    después `rev-list --first-parent -n 300 HEAD` y `rev-list -n 300 <base>` para el punto de
    nacimiento. Sin commits, devuelve `rows: []`.
  - `commitFiles(git, sha: string, merge: boolean): Promise<{ path, status: "A"|"M"|"D", add, del }[]>`.
    En los merges usa `diff --numstat -z sha^1 sha` (más `--name-status` para el estado).
  - `commitDiffArgs(sha: string, path: string, merge: boolean): string[]` devuelve los args de
    `git` para el diff de un archivo, con `--no-ext-diff --no-textconv --no-color`.

- [ ] **Step 1:** Escribir las pruebas con `makeRepo`/`makeRemote`:
  - `detectBase` con un remoto cuyo `origin/HEAD` es `main` → `"origin/main"`;
  - un repo sin remoto con rama `master` → `"master"`;
  - un repo con una sola rama `trunk` → `null`;
  - `loadGraph` en un repo sin commits → `rows: []`, sin lanzar errores;
  - `loadGraph` en `feat` con 2 commits sin subir → `ahead: 2, behind: 0`, y
    `branchName: "feat"`;
  - sin upstream → `ahead: null`;
  - HEAD separado → `branchName: null`, sin errores;
  - la maqueta reconstruida con git real (`main`, `feat` desde `m1`, merge de main en feat) →
    la fila con `fork: true` es el commit `m1`;
  - `commitFiles` de un merge → solo los archivos que el merge trajo respecto al primer padre;
  - con un `git` falso que registra los args, toda llamada de `loadGraph` es de solo lectura
    (sin `fetch`, `update-index` ni `gc`).
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Implementar `repo.js`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** commit `Read the branch graph, base and fork point from git`.

### Task 5: Secciones plegables y divisor arrastrable

**Files:**
- Modify: `mods/cockpit-changes/main.js`
- Create: `mods/cockpit-changes/chevron-down.svg`, `chevron-right.svg` (copias de `mods/files/`)

**Interfaces:**
- Produces, en la clase `Changes`:
  - `section(id: "changes"|"graph", title, header extras, body)`, que devuelve una sección
    plegable;
  - `this.isOpen(id)` y `this.toggle(id, cx)`, que persisten en
    `setShared("cockpit-changes.open", {changes: bool, graph: bool})` (por defecto ambas
    `true`).

- [ ] **Step 1:** Reordenar `render` de la siguiente forma:
  - un `v_resizable("cockpit-changes-split")` con dos `resizable_panel()`: el primero contiene
    las secciones (Changes con la lista actual, Graph de momento con el texto "Graph"), y el
    segundo el visor de diff;
  - la caja de commit queda fuera, al final;
  - `on_resize` guarda en `setShared("cockpit-changes.split", px del primer panel)`, y ese valor
    se lee como `size()` inicial (por defecto, 55 % del alto o 320 px);
  - con las dos secciones plegadas, el primer panel usa `size` igual al alto de las dos
    cabeceras.
- [ ] **Step 2:** Usar un chevron con `svg()` y `rotate`, como hace `files`, y la cabecera de
  Changes conserva el pill `N files` y `+add −del`.
- [ ] **Step 3:** Sincronizar. `$HERDR check ~/.config/herdr-app/mods/cockpit-changes` → sin
  errores.
- [ ] **Step 4:** En la app, comprobar:
  - plegar y desplegar cada sección;
  - arrastrar el divisor, cambiar de layout ida y vuelta (`ctrl-shift-l`), y que la posición y
    los plegados se mantengan;
  - el commit sigue funcionando.

  Revisarlo con `$HERDR shot`.
- [ ] **Step 5:** commit `Split the changes panel into collapsible sections with a draggable divider`.

### Task 6: Graph: filas, carriles, chips y refresco

**Files:**
- Create: `mods/cockpit-changes/draw.js`
- Modify: `mods/cockpit-changes/main.js`

**Interfaces:**
- Consumes: `loadGraph`, `graphKey` (tarea 4); `Row`, `Seg`, `through` (tarea 3).
- Produces:
  - `draw.js` exporta
    - `laneCell(segs: {top: Seg[], bottom: Seg[]}, node: {col, kind, color}|null, fork: boolean, h: number, t): Element`,
      donde `node` es null en las filas de continuación;
    - `laneWidth(rows: Row[]): number` (16 px por columna más 12);
    - `colorOf(c: Color, t): string`, con la paleta de las restricciones globales.
  - En `Changes`: `this.graph` (el resultado de `loadGraph`), `this.graphKey`,
    `refreshGraph(cx, force?: boolean)`.

- [ ] **Step 1:** Escribir `draw.js` según el resultado de la prueba de `paint_path` (tarea 1),
  con `PathBuilder.stroke(2)`:
  - los segmentos rectos son `move_to` + `line_to`, y los curvos `cubic_bezier_to` con
    controles a media altura;
  - un nodo `commit` es un círculo relleno de r=4;
  - `merge` y `head` llevan un anillo de r=5.5, y `head` además un punto central;
  - `fork` lleva un anillo punteado de r=7.5 en `accent` (`dash_array([2,2])`).
- [ ] **Step 2:** Construir el cuerpo de la sección Graph con
  `v_virtual_list("graph", n, 28, ...)`, donde cada fila lleva:
  - `laneCell`;
  - el asunto truncado;
  - el autor en `dim` (salvo en HEAD);
  - los chips: la rama actual con relleno `accent` y `◎`, la base con borde `ansi[4]` (la
    base local lleva su propio chip, del mismo estilo, donde apunte), `☁` si la ref
    `origin/x` tiene una `x` local, y en la fila `fork` el chip punteado `↳ <rama> nació aquí`.

  La fila de HEAD va con fondo `selected` y `font_semibold`.
- [ ] **Step 3:** En la cabecera del Graph:
  - `↑N ↓M`, que no se muestra si `ahead === null`;
  - el botón `◎`, que hace scroll hasta HEAD con el handle del virtual list;
  - el botón `⟳`, que llama a `refreshGraph(cx, true)`.
- [ ] **Step 4:** Implementar el refresco:
  - `refresh` llama a `refreshGraph`, que compara `graphKey`, y solo si cambió (o si
    `force`) ejecuta `loadGraph`;
  - después de cada `await` se descarta el resultado si `key() !== context`;
  - el estado vacío dice "No commits yet", y fuera de un repo, "Not a git repository".
- [ ] **Step 5:** Sincronizar, `$HERDR check` → sin errores. En la app, sobre un repo real con
  merges, revisar con `$HERDR shot`:
  - las curvas se unen sin cortes entre filas;
  - HEAD está resaltado;
  - «nació aquí» cae en el commit correcto;
  - hacer un commit desde el panel → el Graph se actualiza;
  - cambiar de espacio durante la carga → no aparece el grafo del otro espacio.
- [ ] **Step 6:** commit `Draw the branch graph with lanes, refs and the fork point`.

### Task 7: Commit desplegado, archivos, copia del hash y diff

**Files:**
- Modify: `mods/cockpit-changes/main.js`

**Interfaces:**
- Consumes: `commitFiles`, `commitDiffArgs` (tarea 4); `through`, `laneCell` (tareas 3 y 6).
- Produces: `this.expanded: { sha, files, merge } | null`,
  `this.picked: { source: "changes"|"graph", path, sha? }`, y
  `pickCommit(sha, cx)` / `pickCommitFile(sha, path, cx)`.

- [ ] **Step 1:** Implementar el clic en un commit:
  - pliega el que estuviera abierto y despliega este;
  - las filas del virtual list pasan a ser una lista plana de filas de commit, `meta` y
    `file`, todas de altura fija (28 para commit, 24 para el resto), y las filas extra pintan
    `through(row)`;
  - otro clic en el mismo commit lo pliega.
- [ ] **Step 2:** Implementar la fila `meta`: el hash corto (7), el botón `⧉ copiar`
  (`cx.write_to_clipboard(sha completo)` y una nota breve "Copied" en la fila), y el autor con
  la fecha relativa ("hace 2 h", "hace 3 d").
- [ ] **Step 3:** Implementar la fila `file`. Al hacer clic se ejecuta
  `git(commitDiffArgs(...))` y el resultado entra en `setLines`. `this.picked` cambia a
  `graph`, lo que deselecciona el archivo de Changes, y al revés. La cabecera del visor dice
  `<sha7> · <path>`.
- [ ] **Step 4:** Sincronizar, `$HERDR check` → sin errores. En la app comprobar:
  - desplegar un commit normal y uno de merge (que salgan solo los archivos que trajo);
  - copiar el hash y pegarlo en una terminal;
  - alternar entre un archivo de Changes y uno del Graph;
  - un refresco con el commit desplegado lo mantiene abierto mientras el sha siga en el grafo.
- [ ] **Step 5:** commit `Expand a commit to its files and show their diff`.

### Task 8: Documentación y PR

**Files:**
- Modify: `README.md` (tabla de "What's inside" y sección License)
- Add: `docs/superpowers/specs/…`, `docs/superpowers/plans/…` (ya existen en el clon de trabajo)

- [ ] **Step 1:** En el README:
  - añadir la fila `mods/cockpit-changes` con el texto "Source Control panel: collapsible
    Changes and Graph (current branch, upstream, detected base, fork point), commit drill-down
    into files and diffs.";
  - añadir `cockpit-changes` a la lista de archivos propios de License;
  - mencionar que `node --test tests/` corre las pruebas.
- [ ] **Step 2:** `node --test tests/` → PASS. `./install.sh` sobre un `HERDR_CONFIG_DIR`
  temporal → no copia `tests/` ni `docs/`.
- [ ] **Step 3:** Hacer commit, `git push -u origin feat/source-control-graph` y
  `gh pr create --base main` con un resumen y una captura de `$HERDR shot` del panel en
  `docs/`, sin atribución a Claude.

---

## Notas de ejecución

- Tarea 1, paso 5: `window.paint_path(path, color)` dibuja en **coordenadas relativas al elemento** que lo contiene (comprobado con 3 celdas desplazadas: cada curva cae dentro de su celda). `PathCoordinate` acepta también `"50%"`. Hijo de un `div().w(..).h(..)` de tamaño fijo.
