# Markdown to Flow

Plugin para **Figma Design y FigJam** que toma un archivo `.md` de user flow,
extrae el diagrama Mermaid de la sección `### Diagram` y lo convierte en
sticky notes conectados, más **cards de documentación** con el contenido de
las otras secciones del markdown.

- Cada nodo tiene la **forma de su tipo mermaid**: `([...])` → óvalo,
  `[...]` → rectángulo, `{...}` → rombo, `[/.../]` → paralelogramo, y su color
  sale del `classDef` del propio mermaid (con default por forma si no tiene clase).
- En **Figma Design**: 4 `ComponentNode` maestros (en el Section
  "🧩 Componentes base", a la derecha del diagrama) y cada nodo es una
  **Instance** — editar un maestro propaga a todas sus instancias. Los
  conectores son líneas vectoriales con flecha.
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
- Dos **toggles independientes y combinables** en el panel, persistidos entre
  sesiones vía `figma.clientStorage`; el diagrama se genera siempre:
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

Archivo de prueba: `Resources/user-flow-compra-jeans-invitado.md`.

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
- Formas: `A([inicio/fin])`, `B[proceso]`, `C{decisión}`, `D[/input-output/]`
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
