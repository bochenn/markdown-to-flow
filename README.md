# Markdown to Flow

Plugin para **Figma Design y FigJam** que toma un archivo de user flow
(`.md`, `.markdown` o `.txt` — cualquier texto plano sirve), extrae el
diagrama Mermaid de donde esté y lo convierte en nodos conectados, más
**cards de documentación** con el contenido de las secciones del documento.

El parseo es **tolerante a estructura variable**: no hace falta que el archivo
siga un formato exacto — el plugin genera lo mejor posible con lo que haya.

- **Diagramas**: se buscan en todo el archivo, independiente de headings —
  primero bloques ```` ```mermaid ```` cercados; si no hay, bloques sin cercar
  que empiecen con `flowchart TD`/`graph LR`/etc. **Cada bloque genera su
  propio diagrama** en su propio Section (nombrado con el heading más cercano
  cuando hay más de uno), apilados en orden de aparición. Sin diagrama no es
  error: se generan solo las cards.
- **Secciones**: cascada de estrategias — headings ATX (`#`, `##`…) → Setext
  (texto subrayado con `===`/`---`) → líneas etiqueta (línea corta y sola, en
  MAYÚSCULAS o terminada en `:`) → sin estructura (una única card con todo).
  Cualquier heading genera su card; los que matchean los alias conocidos
  (título, flow/resumen, steps/pasos, decision, edge cases/errores/alternate,
  assumptions/supuestos — normalizados sin tildes) reciben su formateo
  especial. Los pares `Clave: valor` sin negrita markdown se marcan en bold igual.

- Cada nodo tiene la **forma de su tipo mermaid**: `([...])` → óvalo,
  `[...]` → rectángulo, `{...}` → rombo, `[/.../]` → paralelogramo, y su color
  sale del `classDef` del propio mermaid (con default por forma si no tiene clase).
- En **Figma Design**: un único **Component Set `user-flow-elements`** (borde
  dashed `#6F3ECD`, autolayout horizontal con padding 16 y gap 32) con 7
  variantes (`Type=Start / End` círculo,
  `Type=Process`, `Type=Decision`, `Type=Options / Input`, `Type=Connector`,
  `Type=Label` y `Type=Annotation` — la nota amarilla de reingreso, 200px de
  ancho con alto hug) en el Section "🧩 Base components"; los **tokens de
  notación** de la leyenda (`([ ])`, `[ ]`, `{ }`, `((CO))`) se renderizan
  como **íconos reales de 24px** (instances; los `((CO))` con sus iniciales
  adentro), la card de leyenda suma una **subsección "Conectores"** generada
por el plugin (muestra dibujada + descripción en el idioma del panel: sólida
`#9747FF`, salto largo `#0D99FF`, punteada de edge case y el badge de label),
la tabla de leyenda mapea **cada fila por su "Elemento"** al ícono
  y color correspondientes (éxito verde, error rojo, reingreso gris) y las
  cards con tablas anchas se ensanchan solas. Los conectores simulados llevan
  **círculo relleno al inicio y flecha al final** (geometría equivalente a los
  caps `CIRCLE_FILLED`/`ARROW_LINES`, que la API solo permite por vértice de
  `vectorNetwork`, incompatible con los codos curvos); cada nodo es una
  **Instance** de su variante — editar una variante propaga a sus instancias,
  y el tipo/forma de cualquier instancia puede cambiarse a mano con el
  selector de variante nativo de Figma. Los **conectores rutean en codo**
  (elbow): en FigJam con `connectorLineType: 'ELBOWED'` + `magnet: 'AUTO'`
  nativos (el redondeo del codo lo dibuja el editor — `cornerRadius` del
  conector es readonly en la API); en Design con un trazado simulado de
  tramos en ángulo recto y esquinas redondeadas (radio 8, adaptativo en
  tramos cortos), anclado al borde más cercano — recta simple si los nodos
  están alineados, y los retornos rodean por la derecha sin atravesar la
  columna. El badge del label se centra a mitad de la longitud del recorrido.
  **Evitación de obstáculos**: si la ruta default de un conector cruza el
  bounding box de un nodo ajeno, se desvía por un carril lateral fuera del
  diagrama (lado más cercano a los endpoints; cada uso corre el carril 16px;
  bandas de entrada/salida con 24px de margen empujadas fuera de los nodos).
  En FigJam la API no tiene waypoints (limitación conocida): la mitigación es
  forzar `magnet LEFT/RIGHT` del lado del carril en esos conectores de salto
  largo. Los **tramos horizontales que comparten franja se separan +24px**
  (registro de franjas ocupadas, orden de creación, re-chequeando obstáculos)
  — así los conectores que viajan juntos se ven como líneas paralelas y sus
  badges no se apilan (los labels heredan el offset de su propia ruta, también
  en FigJam). Los obstáculos incluyen **nodos + anotaciones + badges ya
  creados** (cada badge se registra al crearse); las rutas rectas registran su
  franja y hacen U-jog si pisan una ocupada; el desvío **evalúa ambos
  carriles** (menos colisiones, luego el más corto) y el margen de detección
  de 12px hace que rozar un borde cuente como cruce. Constantes en
  `src/connectorStyle.ts`.
- En **FigJam**: la API **no soporta components** (`figma.createComponent` es
  *"only available in Figma Design"* y `createInstance` tira error en FigJam,
  según la documentación oficial). En vez del fallback con `clone()`, se usa
  `figma.createShapeWithText()` nativo, cuyo `shapeType` trae exactamente las
  4 formas (`ELLIPSE`, `ROUNDED_RECTANGLE`, `DIAMOND`, `PARALLELOGRAM_RIGHT`),
  con texto integrado y magnets para los conectores nativos. **En FigJam no hay
  maestro: editar un nodo no propaga al resto** (limitación de la plataforma).
  El branching por `figma.editorType` vive solo en `src/renderFigma.ts`.
- Las **cards de documentación** (`createSectionCard()`) son frames comunes,
  idénticos en los dos editores: título, Flow (metadatos), Steps, Decision
  points, Alternate paths y Assumptions, con negritas reales
  (`setRangeFontName`). Se agrupan en un Section `"Documentación"`, en columna
  a la izquierda del Section `"Diagrama de flujo"`.
- **Idioma configurable (English/Español, default English)** para la UI del
  panel y las etiquetas que el plugin escribe en el canvas (nombres de
  Sections, headers canónicos de cards conocidas, componentes base). El
  **contenido extraído del archivo nunca se traduce**: nodos, bodies de cards
  y headings genéricos se muestran tal cual vienen. Las cards de Título y
  Flow conservan el heading original del archivo como header (es contenido
  del usuario); Steps/Decision points/Edge cases/Assumptions usan el header
  canónico traducido. Diccionario en `src/i18n.ts` (`t(clave, lang, vars)`,
  fallback a inglés, extensible a más idiomas); los textos de la UI viven
  duplicados en `ui.html` porque el iframe no tiene bundler — mantener
  sincronía. El idioma persiste apenas se cambia el selector.
- **Identificador `FLW0N` por flujo**: cada heading que agrupa un diagrama es
  un flujo (`FLW01`, `FLW02`… en orden; detección semántica, independiente
  del formato de numeración — `1. X`, `Flujo 1: X`, etc. solo se limpian del
  título). Las cards de documentación llevan el prefijo de su flujo
  (`"FLW03 - Flujo de edge cases — Alternate paths..."` — clave cuando hay
  headings repetidos entre flujos); las secciones globales (antes del primer
  flujo o al mismo nivel, ej. leyendas o checklists) quedan sin prefijo. Con
  un solo flujo, todo el contenido pertenece a `FLW01`. Cada Section de
  diagrama lleva el `flowLabel` como título dentro del canvas, sobre el nodo
  de inicio.
- **Leyenda de conectores**: si el archivo tiene líneas tipo
  `` `((CO))` → Descripción `` (tolerante a backticks, `->`/`→`/`=>`, doble o
  triple paréntesis), cada aparición de ese nodo conector lleva una anotación
  con pinta de sticky chico al costado. Ambas sintaxis `((texto))` y
  `(((texto)))` mapean al tipo conector.
- **Labels de conectores como badge**: pill negro (padding 6×4, texto blanco
  12px) en el punto medio entre los nodos, en ambos editores — la línea/flecha
  no se toca. En FigJam el conector nativo rutea con codos por su cuenta, así
  que el badge queda en el punto medio geométrico (límite conocido).
- **Tablas reales en las cards**: las tablas markdown (`| a | b |` +
  `|---|---|`) se renderizan como tabla nativa (`createTable`/`cellAt`) en
  FigJam y simulada con frames (celdas de ancho fijo, header con fondo y bold)
  en Figma Design; filas irregulares se ajustan al header con aviso. Además,
  los bullets con patrón `CA{N} (descripción) → referencia` se convierten en
  una tabla de 3 columnas (headers traducidos); el bullet que no matchea va
  como fila cruda con aviso. El texto alrededor de una tabla se renderiza
  normal. Todos los `<br>`/`<br/>`/`<br />` del origen se vuelven saltos de
  línea reales (`normalizeLineBreaks`, aplicado en nodos, labels, cards y celdas).
- **Estilos de layout** (`Layout style`, persistido): **Classic** (default) —
  en flujos densos se **descompone en sub-flujos independientes** (`FLW03.1`,
  `FLW03.2`, …), uno por rama del hub, cada uno en su Section anidada dentro
  de la Section del flujo padre, en grilla de 3 columnas por tamaños reales;
  la decisión compartida se omite (el título de la sub-sección nombra el caso
  y el preámbulo raíz→hub va una vez como encabezado); sin hub razonable →
  diagrama único con warning; FLW01/02 (simples) siguen como diagrama único.
  **Cards** — para flujos densos cuya complejidad es
  topológica ("muchos triggers → decisión compartida → muchos resultados"):
  detecta el hub (mayor fan-out), muestra el preámbulo raíz→hub una vez y
  convierte cada rama en una **tarjeta autocontenida** (trigger como título,
  pasos con mini-íconos, decisiones con opciones etiquetadas y el reingreso
  como fila verde con el junction — cero conectores cruzando el diagrama;
  los nodos compartidos entre ramas se duplican por tarjeta). El toggle
  **"solo flujos densos"** (default activado) aplica el modo elegido
  únicamente a los flujos con fan-out máximo > 4 (`UMBRAL_FLUJO_DENSO` —
  FLW01/02 quedan Classic, FLW03/04/05 en Cards); desactivado, aplica a
  todos. En flujos renderizados como Cards el toggle de "separar edge cases"
  se ignora con aviso (ya son tarjetas). **Swimlanes**: carriles por punto de
  reingreso (fondos planos, sin reparenting de conectores) con el mini-flujo
  Classic real de cada rama adentro (subgrafo + layout compacto), y tres
  sub-settings persistidos en el panel — *Re-entry style* (junction local o
  badge de texto), *Lane grouping* (primer reingreso o duplicar la rama en
  cada carril) y *Lane orientation* (horizontal/vertical). **Table**: una
  fila por caso — Disparador | Qué hace el sistema | Resultado | Reingresa a
  (en ramas con decisión, "Resultado" lista todos los desenlaces con su
  label) — reusando el renderer de tablas (nativa en FigJam, simulada en
  Design), con headers en el idioma del panel. Los **conectores de salto largo** (desviados por carril) van en
  `#0D99FF` para distinguirlos de los pasos secuenciales.
- **Dirección de flujo configurable** (Vertical/Horizontal, default Vertical,
  persistida): tiene prioridad sobre la dirección del mermaid (que se parsea
  pero solo se loguea). En horizontal los niveles del BFS van a columnas y la
  zona de edge cases pasa a estar debajo del flujo (alineada al X de la
  decisión de origen); la documentación va siempre a la izquierda.
- **Toggles independientes y combinables** en el panel, persistidos entre
  sesiones vía `figma.clientStorage`; el diagrama se genera siempre:
  - **Repetir card de Flow** (desactivado por defecto): con documentación
    activa y sección Flow detectada, una copia al 70% de la card de resumen
    se pega arriba del primer nodo del flujo principal (y del de edge cases
    si existe), como recordatorio de contexto.
  - **Cards de documentación** (activado por defecto).
  - **Separar edge cases y errores** (desactivado por defecto): los nodos con
    clase de la lista `OFF_PATH_CLASSES` (default `['error']`, extensible en
    `src/layoutDiagram.ts`) salen del happy path — el BFS los excluye como si
    no existieran, así el flujo principal queda lineal y sin huecos — y van a
    una columna aparte (derecha en vertical, debajo en horizontal), cada uno a
    la altura del nodo principal que origina su rama. Todo vive en **una única
    Section por flujo** (diagrama + edge cases + conectores punteados que los
    cruzan — dos Sections separadas clipeaban esos conectores), con un título
    suelto `"Edge cases and errors — {flowLabel}"` sobre el bloque off-path.
    Los conectores normales van en **#9747FF** (override intencional, ambos
    editores); el punteado es la única señal de edge case. La paleta de las
    variantes: Start/End `#CFF7D3/#008043`, Process `#FFF1C2/#FAB815`,
    Decision `#E5F4FF/#0768CF`, Options/Input `#F1E5FF/#7C2BDA`, Annotation
    fill `#FFF1C2`; texto `#000000` al 90% de opacidad en todas (en el paint).
    Los nodos con clase de error usan la paleta roja fija `#FFE2E0/#BD2915`,
    que pisa la variante y el classDef del archivo. Organización del
    canvas en **dos pasadas**: cada Section se genera con contenido en
    coordenadas locales, y con los tamaños reales medidos se apilan los flujos
    en columna (200px entre bordes) con **Documentation a la izquierda**, que
    contiene las cards y la Section anidada **"🧩 Base components"** (el
    Component Set) al final de la columna.

## Comandos

```bash
npm install        # una sola vez
npm run build      # genera dist/code.js con esbuild
npm run watch      # build en modo watch mientras desarrollás
npm test           # tests del parser y layout (Node puro, sin Figma)
npm run typecheck  # tsc --noEmit
```

## Cómo cargarlo en Figma

1. `npm install && npm run build`
2. En Figma o FigJam (app de escritorio): **Plugins → Development → Import plugin from manifest…** y elegir `manifest.json`.
3. Correr el plugin, subir un `.md` (o pegar el contenido) y apretar **Generar diagrama**.

Archivos de prueba en `Resources/`:

- `user-flow-compra-jeans-invitado.md` — estructura completa con headings ATX
- `user-flow-compra-jeans-invitado.txt` — mismo contenido con líneas etiqueta (`STEPS (HAPPY PATH):`) y diagrama sin cercar
- `user-flow-compra-jeans-invitado_edge.md` — 5 bloques mermaid bajo headings propios y secciones no estándar
- `notas-sin-estructura.txt` — texto plano sin headings ni diagrama (una única card)

## Estructura

```
src/parseMarkdown.ts  # parser genérico: secciones por heading, líneas de card, negritas (puro)
src/parseMermaid.ts   # localiza ### Diagram (vía parseMarkdown) y parsea el grafo mermaid (puro)
src/layoutDiagram.ts  # niveles por BFS (tolera ciclos), minimización de cruces por
                      # barycenter (Sugiyama, con dummies para edges largos) y
                      # espaciado adaptativo en niveles densos (puro)
src/renderFigma.ts    # createStickyLike, createConnectorLike, createSectionCard, Sections;
                      # todo el branching por figma.editorType vive acá
src/code.ts           # orquestación: mensajería con la UI, toggle, clientStorage, fuentes
src/ui.html           # UI con componentes FigUI3 (fig-switch, fig-dropdown, fig-button…)
scripts/build-ui.mjs  # inline de FigUI3 (CSS+JS de node_modules) → dist/ui.html;
                      # el manifest apunta a dist/ y networkAccess queda en "none"
test/                 # tests con node:test contra el archivo de ejemplo
```

La UI usa [FigUI3](https://github.com/rogie/figui3) (estilo nativo de Figma
UI3, theming light/dark automático vía `--figma-color-*`). Como el manifest
bloquea la red del iframe (`networkAccess: none`), la librería se bundlea
localmente en el build en vez de cargarse por CDN — por eso hay que correr
`npm run build` antes de importar el plugin.

## Sintaxis mermaid soportada (v1)

- `flowchart TD` / `graph TD` (la dirección se guarda por si después se soporta `LR`)
- Formas: `A([inicio/fin])`, `B[proceso]`, `C{decisión}`, `D[/input-output/]`,
  `E(((conector)))` (círculo doble/junction, variante `Type=Connector`).
  Formas mermaid no soportadas (hexágono `{{}}`, subrutina `[[]]`, base de
  datos `[()]`, círculo simple `(())`) caen a rectángulo con warning
  informativo, **sin perder el edge de la línea**.
- Edges: `A --> B`, `A -->|label| B`, cadenas `A --> B --> C`
- Clases: `classDef nombre fill:#...,stroke:#...,color:#...,stroke-dasharray:4 2;`
  (se aplican fill, stroke, color de texto y borde punteado; el resto se ignora),
  asignadas inline (`Nodo:::nombre`) o en bloque (`class A,B,C nombre;`).
  Clase sin `classDef` → color default por forma + aviso.
- Tamaños discretos por forma (preset corto/largo según el largo del texto,
  con reducción de fuente 14→12 antes de desbordar el preset grande)
- Comentarios `%%` ignorados; las líneas no reconocidas generan un aviso, no un crash

## Secciones de documentación soportadas

Cada una se vuelve una card independiente (las ausentes se omiten con un aviso):

1. **H1** + el blockquote que lo sigue (subtítulo)
2. **`## Flow:`** (match por prefijo) con la lista de metadatos `- **Campo:** valor`
3. **`### Steps (happy path)`** — lista numerada
4. **`### Decision points`** — bullets con sub-bullets indentados (anidamiento >2 se aplana)
5. **`### Alternate paths, errors, and edge cases`**
6. **`### Assumptions and open questions`**

El contenido de cada sección llega hasta el próximo heading de nivel igual o
superior o un `---`. Negritas `**texto**` se renderizan en bold real, y el
**código inline** `` `texto` `` se muestra sin backticks y en fuente
monoespaciada (candidatas: Roboto Mono → Source Code Pro → IBM Plex Mono; si
ninguna carga, solo se quitan los backticks). Marcadores sin cerrar se dejan
como texto plano con un warning en consola.
