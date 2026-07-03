# Markdown to Flow

Plugin for **Figma Design and FigJam** that takes a user flow file
(`.md`, `.markdown` or `.txt` — any plain text works), extracts the Mermaid
diagram from wherever it is and turns it into connected nodes, plus
**documentation cards** with the content of the document's sections.

Parsing is **tolerant to variable structure**: the file doesn't need to
follow an exact format — the plugin generates the best it can from whatever
it finds.

- **Diagrams**: searched across the whole file, regardless of headings —
  fenced ```` ```mermaid ```` blocks first; if there are none, unfenced blocks
  starting with `flowchart TD`/`graph LR`/etc. **Each block generates its own
  diagram** in its own Section (named after the closest heading when there is
  more than one), stacked in order of appearance. No diagram is not an error:
  only the cards are generated.
- **Sections**: a cascade of strategies — ATX headings (`#`, `##`…) → Setext
  (text underlined with `===`/`---`) → label lines (a short line on its own,
  in UPPERCASE or ending with `:`) → no structure (a single card with
  everything). Any heading generates its card; those matching the known
  aliases (title, flow/summary, steps, decision, edge cases/errors/alternate,
  assumptions — normalized without accents) get their special formatting.
  `Key: value` pairs without markdown bold are bolded anyway.

- Each node gets the **shape of its mermaid type**: `([...])` → oval,
  `[...]` → rectangle, `{...}` → diamond, `[/.../]` → parallelogram, and its
  color comes from the mermaid's own `classDef` (with a per-shape default when
  it has no class).
- In **Figma Design**: a single **Component Set `user-flow-elements`** (dashed
  `#6F3ECD` border, horizontal autolayout with padding 16 and gap 32) with 7
  variants (`Type=Start / End` circle, `Type=Process`, `Type=Decision`,
  `Type=Options / Input`, `Type=Connector`, `Type=Label` and
  `Type=Annotation` — the yellow re-entry note, 200px wide with hug height)
  inside the "🧩 Base components" Section; the legend's **notation tokens**
  (`([ ])`, `[ ]`, `{ }`, `((CO))`) render as **real 24px icons** (instances;
  `((CO))` tokens with their initials inside), the legend card adds a
  plugin-generated **"Connectors" subsection** (drawn sample + description in
  the panel language: solid `#9747FF`, long jump `#0D99FF`, dashed edge case
  and the label badge), the legend table maps **each row by its "Element"
  column** to the matching icon and color (success green, error red, re-entry
  gray), and cards with wide tables widen themselves. Simulated connectors
  carry a **filled circle at the start and an arrow at the end** (geometry
  equivalent to the `CIRCLE_FILLED`/`ARROW_LINES` caps, which the API only
  allows per `vectorNetwork` vertex — incompatible with the curved elbows);
  each node is an **Instance** of its variant — editing a variant propagates
  to its instances, and any instance's type/shape can be changed by hand with
  Figma's native variant selector. **Connectors route with elbows**: in
  FigJam with native `connectorLineType: 'ELBOWED'` + `magnet: 'AUTO'` (the
  editor draws the corner rounding — the connector's `cornerRadius` is
  readonly in the API); in Design with a simulated right-angle path with
  rounded corners (radius 8, adaptive on short segments), anchored to the
  nearest edge — a simple straight line when nodes are aligned, and returns
  go around the right side without crossing the column. The label badge is
  centered at half the path length. **Obstacle avoidance**: if a connector's
  default route crosses another node's bounding box, it detours through a
  side lane outside the diagram (the side closest to the endpoints; each use
  shifts the lane; entry/exit bands with a 24px margin pushed clear of the
  nodes). In FigJam the API has no waypoints (known limitation): the
  mitigation is forcing `magnet LEFT/RIGHT` on the lane side for those
  long-jump connectors. **Horizontal segments sharing a band get separated
  +24px** (occupied-band registry, creation order, re-checking obstacles) —
  so connectors traveling together look like parallel lines and their badges
  don't stack (labels inherit their own route's offset, in FigJam too).
  Obstacles include **nodes + annotations + already-created badges** (each
  badge registers itself on creation); straight routes register their band
  and U-jog if they step on an occupied one; the detour **evaluates both
  lanes** (fewest collisions, then shortest) and the 12px detection margin
  makes grazing an edge count as a crossing. Constants in
  `src/connectorStyle.ts`.
- In **FigJam**: the API **does not support components**
  (`figma.createComponent` is *"only available in Figma Design"* and
  `createInstance` throws in FigJam, per the official docs). Instead of a
  `clone()` fallback, the plugin uses native `figma.createShapeWithText()`,
  whose `shapeType` provides exactly the 4 shapes (`ELLIPSE`,
  `ROUNDED_RECTANGLE`, `DIAMOND`, `PARALLELOGRAM_RIGHT`), with integrated
  text and magnets for native connectors. **There is no master in FigJam:
  editing one node does not propagate to the rest** (platform limitation).
  All `figma.editorType` branching lives in `src/renderFigma.ts`.
- **Documentation cards** (`createSectionCard()`) are plain frames, identical
  in both editors: title, Flow (metadata), Steps, Decision points, Alternate
  paths and Assumptions, with real bold (`setRangeFontName`). They're grouped
  in a `"Documentation"` Section, in a column to the left of the
  `"Flow diagram"` Section.
- **Configurable language (English/Español, default English)** for the panel
  UI and the labels the plugin writes on the canvas (Section names, canonical
  headers of known cards, base components). **Content extracted from the file
  is never translated**: nodes, card bodies and generic headings show up as
  they come. The Title and Flow cards keep the file's original heading as
  header (it's user content); Steps/Decision points/Edge cases/Assumptions
  use the translated canonical header. Dictionary in `src/i18n.ts`
  (`t(key, lang, vars)`, English fallback, extensible to more languages); the
  UI texts live duplicated in `ui.html` because the iframe has no bundler —
  keep them in sync. The language persists as soon as the selector changes.
- **`FLW0N` identifier per flow**: every heading that groups a diagram is a
  flow (`FLW01`, `FLW02`… in order; semantic detection, independent of the
  numbering format — `1. X`, `Flow 1: X`, etc. are only cleaned from the
  title). Documentation cards carry their flow's prefix
  (`"FLW03 - Edge cases flow — Alternate paths..."` — key when headings
  repeat across flows); global sections (before the first flow or at the same
  level, e.g. legends or checklists) get no prefix. With a single flow, all
  content belongs to `FLW01`. Each diagram Section shows the `flowLabel` as a
  title inside the canvas, above the start node.
- **Connector legend**: if the file has lines like
  `` `((CO))` → Description `` (tolerant to backticks, `->`/`→`/`=>`, double
  or triple parentheses), every appearance of that connector node gets a
  small sticky-looking annotation at its side. Both `((text))` and
  `(((text)))` syntaxes map to the connector type.
- **Connector labels as badges**: black pill (6×4 padding, white 12px text)
  at the midpoint between nodes, in both editors — the line/arrow is left
  untouched. In FigJam the native connector routes its own elbows, so the
  badge sits at the geometric midpoint (known limit).
- **Real tables in cards**: markdown tables (`| a | b |` + `|---|---|`)
  render as a native table (`createTable`/`cellAt`) in FigJam and simulated
  with frames (fixed-width cells, header with background and bold) in Figma
  Design; irregular rows are adjusted to the header with a warning. Also,
  bullets with the `CA{N} (description) → reference` pattern become a
  3-column table (translated headers); non-matching bullets go in as raw rows
  with a warning. Text around a table renders normally. Every
  `<br>`/`<br/>`/`<br />` from the source becomes a real line break
  (`normalizeLineBreaks`, applied to nodes, labels, cards and cells).
- **Layout styles** (`Layout style`, persisted): **Classic** (default) —
  dense flows are **decomposed into independent sub-flows** (`FLW03.1`,
  `FLW03.2`, …), one per hub branch, each in its own Section nested inside
  the parent flow's Section, in a 3-column grid by measured sizes; the shared
  decision is omitted (the sub-section title names the case and the root→hub
  preamble appears once as a header); no reasonable hub → single diagram
  with a warning; FLW01/02 (simple) stay as a single diagram. **Cards** —
  for dense flows whose complexity is topological ("many triggers → shared
  decision → many outcomes"): detects the hub (highest fan-out), shows the
  root→hub preamble once and turns each branch into a **self-contained card**
  (trigger as title, steps with mini icons, decisions with labeled options
  and the re-entry as a colored row with the junction — zero connectors
  crossing the diagram; nodes shared across branches are duplicated per
  card). The **"dense flows only" toggle** (default on) applies the chosen
  mode only to flows with max fan-out > 4 (`UMBRAL_FLUJO_DENSO` — FLW01/02
  stay Classic, FLW03/04/05 get the chosen mode); off, it applies to all.
  In decomposed flows the "separate edge cases" toggle is ignored with a
  notice (they're already split). **Swimlanes**: lanes by re-entry point
  (flat backgrounds, no connector reparenting) with each branch's real
  Classic mini-flow inside (subgraph + compact layout), plus three persisted
  panel sub-settings — *Re-entry style* (local junction or text badge),
  *Lane grouping* (first re-entry or duplicate the branch per lane) and
  *Lane orientation* (horizontal/vertical). **Table**: one row per case —
  Trigger | What the system does | Outcome | Re-enters at (in branches with a
  decision, "Outcome" lists every ending with its label) — reusing the table
  renderer (native in FigJam, simulated in Design), with headers in the
  panel language. **Long-jump connectors** (lane-detoured) use `#0D99FF` to
  tell them apart from sequential steps.
- **Configurable flow direction** (Vertical/Horizontal, default Vertical,
  persisted): takes priority over the mermaid's direction (parsed but only
  logged). In horizontal, BFS levels go to columns and the edge-case zone
  moves below the flow (aligned to the X of the originating decision);
  documentation always goes to the left.
- **Independent, combinable toggles** in the panel, persisted across sessions
  via `figma.clientStorage`; the diagram is always generated:
  - **Repeat Flow card** (off by default): with documentation on and a Flow
    section detected, a 70% copy of the summary card is placed above the
    first node of the main flow (and of the edge-case block if present), as a
    context reminder.
  - **Documentation cards** (on by default).
  - **Separate edge cases and errors** (off by default): nodes with a class
    from the `OFF_PATH_CLASSES` list (default `['error']`, extensible in
    `src/layoutDiagram.ts`) leave the happy path — BFS excludes them as if
    they didn't exist, so the main flow stays linear and gapless — and go to
    a separate column (right in vertical, below in horizontal), each at the
    height of the main node that originates its branch. Everything lives in
    **a single Section per flow** (diagram + edge cases + the dashed
    connectors crossing between them — two separate Sections clipped those
    connectors), with a loose `"Edge cases and errors — {flowLabel}"` title
    above the off-path block. Normal connectors use **#9747FF** (intentional
    override, both editors); the dashing is the only edge-case signal. The
    variant palette: Start/End `#CFF7D3/#008043`, Process `#FFF1C2/#FAB815`,
    Decision `#E5F4FF/#0768CF`, Options/Input `#F1E5FF/#7C2BDA`, Annotation
    fill `#FFF1C2`; text `#000000` at 90% opacity everywhere (in the paint).
    Nodes with the error class use the fixed red palette `#FFE2E0/#BD2915`,
    which overrides both the variant and the file's classDef. Canvas
    organization in **two passes**: each Section is generated with content in
    local coordinates, and with the real measured sizes the flows are stacked
    in a column (200px between edges) with **Documentation on the left**,
    which holds the cards and the nested **"🧩 Base components"** Section
    (the Component Set) at the end of the column.

- **Example file**: the panel has a "Download example markdown" button (in
  the panel language) that downloads `user-flow-example.md` — a single-flow
  user flow showing shapes, semantic classes, a `((CO))` junction with its
  legend and all documentation sections — so you can try the plugin without
  writing anything. Embedded as a UTF-8 Blob in the UI (no network needed).

## Commands

```bash
npm install        # once
npm run build      # generates dist/code.js with esbuild + dist/ui.html
npm run watch      # build in watch mode while developing
npm test           # parser and layout tests (pure Node, no Figma)
npm run typecheck  # tsc --noEmit
```

## Loading it in Figma

1. `npm install && npm run build`
2. In Figma or FigJam (desktop app): **Plugins → Development → Import plugin
   from manifest…** and pick `manifest.json`.
3. Run the plugin, upload a `.md` (or paste the content) and hit **Generate**.

Test files in `Resources/`:

- `user-flow-compra-jeans-invitado.md` — full structure with ATX headings
- `user-flow-compra-jeans-invitado.txt` — same content with label lines (`STEPS (HAPPY PATH):`) and an unfenced diagram
- `user-flow-compra-jeans-invitado_edge.md` — 5 mermaid blocks under their own headings and non-standard sections
- `notas-sin-estructura.txt` — plain text with no headings and no diagram (a single card)

## Structure

```
src/parseMarkdown.ts  # generic parser: sections by heading, card lines, bold (pure)
src/parseMermaid.ts   # locates ### Diagram (via parseMarkdown) and parses the mermaid graph (pure)
src/layoutDiagram.ts  # BFS levels (cycle-tolerant), crossing minimization via
                      # barycenter (Sugiyama, with dummies for long edges) and
                      # adaptive spacing on dense levels (pure)
src/renderFigma.ts    # createStickyLike, createConnectorLike, createSectionCard, Sections;
                      # all figma.editorType branching lives here
src/code.ts           # orchestration: UI messaging, toggles, clientStorage, fonts
src/ui.html           # UI with FigUI3 components (fig-switch, fig-dropdown, fig-button…)
scripts/build-ui.mjs  # inlines FigUI3 (CSS+JS from node_modules) → dist/ui.html;
                      # the manifest points to dist/ and networkAccess stays "none"
test/                 # node:test tests against the sample files
```

The UI uses [FigUI3](https://github.com/rogie/figui3) (native Figma UI3
styling, automatic light/dark theming via `--figma-color-*`). Since the
manifest blocks the iframe's network (`networkAccess: none`), the library is
bundled locally at build time instead of loaded from a CDN — which is why
`npm run build` must run before importing the plugin.

## Supported mermaid syntax (v1)

- `flowchart TD` / `graph TD` (the direction is stored in case `LR` is supported later)
- Shapes: `A([start/end])`, `B[process]`, `C{decision}`, `D[/input-output/]`,
  `E(((connector)))` (double circle/junction, `Type=Connector` variant).
  Unsupported mermaid shapes (hexagon `{{}}`, subroutine `[[]]`, database
  `[()]`, plain circle `(())`) fall back to a rectangle with an informative
  warning, **without losing the line's edge**.
- Edges: `A --> B`, `A -->|label| B`, chains `A --> B --> C`
- Classes: `classDef name fill:#...,stroke:#...,color:#...,stroke-dasharray:4 2;`
  (fill, stroke, text color and dashed border are applied; the rest is
  ignored), assigned inline (`Node:::name`) or in block (`class A,B,C name;`).
  A class without `classDef` → per-shape default color + notice.
- Discrete sizes per shape (short/long preset by text length, with a 14→12
  font reduction before overflowing the large preset)
- `%%` comments ignored; unrecognized lines produce a notice, not a crash

## Supported documentation sections

Each becomes an independent card (missing ones are skipped with a notice):

1. **H1** + the blockquote that follows it (subtitle)
2. **`## Flow:`** (prefix match) with the `- **Field:** value` metadata list
3. **`### Steps (happy path)`** — numbered list
4. **`### Decision points`** — bullets with indented sub-bullets (nesting >2 is flattened)
5. **`### Alternate paths, errors, and edge cases`**
6. **`### Assumptions and open questions`**

Each section's content runs until the next heading of equal or higher level
or a `---`. `**text**` bold renders as real bold, and **inline code**
`` `text` `` shows without backticks in a monospaced font (candidates:
Roboto Mono → Source Code Pro → IBM Plex Mono; if none loads, only the
backticks are removed). Unclosed markers are left as plain text with a
console warning.
