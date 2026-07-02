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
- En **Figma Design**: un único **Component Set `user-flow-elements`** con 4
  variantes (`Type=Start / End` círculo, `Type=Process`, `Type=Decision`,
  `Type=Options / Input`) en el Section "🧩 Base components"; cada nodo es una
  **Instance** de su variante — editar una variante propaga a sus instancias,
  y el tipo/forma de cualquier instancia puede cambiarse a mano con el
  selector de variante nativo de Figma. Los conectores son líneas vectoriales
  que replican el estilo del conector default de FigJam (`src/connectorStyle.ts`
  — valores provisorios: al correr en FigJam, la consola imprime un dump con
  las propiedades reales del conector para verificar/corregir las constantes).
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
    una columna propia en el Section `"Edge cases y errores"`, cada uno a la
    altura del nodo principal que origina su rama (solapamientos se empujan
    hacia abajo lo mínimo). Los conectores que cruzan entre columnas van
    punteados y grises, conservando su label, y quedan fuera de los Sections.
    Orden en el canvas: Documentación → Diagrama de flujo → Edge cases y
    errores → 🧩 Componentes base.

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
src/layoutDiagram.ts  # niveles por BFS (tolera ciclos) y posiciones top-down (puro)
src/renderFigma.ts    # createStickyLike, createConnectorLike, createSectionCard, Sections;
                      # todo el branching por figma.editorType vive acá
src/code.ts           # orquestación: mensajería con la UI, toggle, clientStorage, fuentes
src/ui.html           # UI: input de archivo, textarea, toggle de documentación, status
test/                 # tests con node:test contra el archivo de ejemplo
```

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
superior o un `---`. Negritas `**texto**` se renderizan en bold real; un `**`
sin cerrar se deja como texto plano con un warning en consola.
