// Main thread del plugin: orquestación y mensajería con la UI.
// El diagrama se genera siempre. Dos toggles independientes y combinables,
// persistidos en clientStorage: generarDocs (cards de documentación) y
// separarEdgeCases (nodos de error en una columna aparte).

import { extraerMermaid, parsearFlowchart, Forma } from './parseMermaid.ts';
import { calcularLayout, posicionarOffPath, esOffPath } from './layoutDiagram.ts';
import { extraerDocumentacion } from './parseMarkdown.ts';
import {
  FUENTE,
  FUENTE_REGULAR,
  FUENTE_BOLD,
  ANCHO_CARD,
  resolverEstilo,
  createShapeComponents,
  createDiagramNodeInstance,
  createConnectorLike,
  createSectionCard,
  crearSection,
} from './renderFigma.ts';

const CLAVE_DOCS = 'generarDocs';
const CLAVE_EDGE_CASES = 'separarEdgeCases';
const SEPARACION_CARDS = 40;
const MARGEN_COLUMNA = 200; // entre la columna de cards y el diagrama

figma.showUI(__html__, { width: 380, height: 560 });

// Al abrir el plugin, mandar a la UI el estado persistido de los toggles.
Promise.all([
  figma.clientStorage.getAsync(CLAVE_DOCS),
  figma.clientStorage.getAsync(CLAVE_EDGE_CASES),
]).then(([docs, edgeCases]) => {
  figma.ui.postMessage({
    type: 'estado-inicial',
    generarDocs: docs === undefined ? true : docs === true, // default: activado
    separarEdgeCases: edgeCases === true,                    // default: desactivado
  });
});

async function generar(
  markdown: string,
  generarDocs: boolean,
  separarEdgeCases: boolean,
): Promise<{ resumen: string; warnings: string[] }> {
  const { codigo, warnings } = extraerMermaid(markdown);
  const grafo = parsearFlowchart(codigo);
  if (grafo.nodos.size === 0) {
    throw new Error('El bloque mermaid no tiene nodos reconocibles.');
  }
  const documentacion = generarDocs ? extraerDocumentacion(markdown) : null;

  // Todas las fuentes una sola vez, antes de crear cualquier texto.
  await Promise.all([
    figma.loadFontAsync(FUENTE),
    figma.loadFontAsync(FUENTE_REGULAR),
    figma.loadFontAsync(FUENTE_BOLD),
  ]);

  // --- Layout: happy path, y columna off-path aparte si corresponde ---
  const offPath = new Set<string>();
  if (separarEdgeCases) {
    for (const nodo of grafo.nodos.values()) {
      if (esOffPath(nodo)) offPath.add(nodo.id);
    }
  }
  const posiciones = calcularLayout(grafo, offPath.size > 0 ? offPath : undefined);
  const posicionesOffPath = offPath.size > 0
    ? posicionarOffPath(grafo, offPath, posiciones)
    : new Map<string, { x: number; y: number }>();
  const centro = figma.viewport.center;

  // Components maestro solo en Figma Design (en FigJam la API no los soporta:
  // se usan ShapeWithText nativos, sin maestro). Van a la derecha de todo,
  // después de la columna de edge cases si existe.
  let comps: Record<Forma, ComponentNode> | null = null;
  if (figma.editorType === 'figma') {
    let maxPX = 0;
    for (const p of posiciones.values()) maxPX = Math.max(maxPX, p.x);
    for (const p of posicionesOffPath.values()) maxPX = Math.max(maxPX, p.x);
    comps = createShapeComponents(centro.x + maxPX + 600, centro.y);
  }

  // --- Nodos del diagrama ---
  const nodosCreados = new Map<string, SceneNode>();
  const nodosPrincipal: SceneNode[] = [];
  const nodosEdgeCases: SceneNode[] = [];
  const avisosEstilo = new Set<string>();

  for (const nodo of grafo.nodos.values()) {
    const p = posiciones.get(nodo.id) || posicionesOffPath.get(nodo.id)!;
    const { estilo, aviso } = resolverEstilo(nodo, grafo.classDefs);
    if (aviso) avisosEstilo.add(aviso);
    const creado = createDiagramNodeInstance(nodo.forma, nodo.texto, estilo, centro.x + p.x, centro.y + p.y, comps);
    nodosCreados.set(nodo.id, creado);
    if (offPath.has(nodo.id)) nodosEdgeCases.push(creado);
    else nodosPrincipal.push(creado);
  }

  // --- Conectores: los que tocan un nodo off-path van punteados y quedan a
  // nivel de página (si entraran a un Section, su bounding box se estiraría
  // hasta pisar la otra columna) ---
  for (const edge of grafo.edges) {
    const origen = nodosCreados.get(edge.origen);
    const destino = nodosCreados.get(edge.destino);
    if (!origen || !destino) continue;
    const esOffPathEdge = offPath.has(edge.origen) || offPath.has(edge.destino);
    const creados = await createConnectorLike(origen, destino, edge.label, esOffPathEdge);
    if (!esOffPathEdge) {
      for (const c of creados) nodosPrincipal.push(c);
    }
  }

  // --- Cards de documentación (solo con el toggle activo) ---
  const cards: SceneNode[] = [];
  if (documentacion) {
    let minX = Infinity, minY = Infinity;
    for (const n of nodosCreados.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
    }
    let cardY = minY;
    const cardX = minX - MARGEN_COLUMNA - ANCHO_CARD;
    for (const card of documentacion.cards) {
      const frame = createSectionCard(card.titulo, card.lineas, cardX, cardY);
      cards.push(frame);
      cardY += frame.height + SEPARACION_CARDS;
    }
  }

  // --- Sections (al final, cuando ya están todas las posiciones absolutas) ---
  const seccionesVisibles: SceneNode[] = [crearSection('Diagrama de flujo', nodosPrincipal)];
  if (nodosEdgeCases.length > 0) {
    seccionesVisibles.push(crearSection('Edge cases y errores', nodosEdgeCases));
  }
  if (cards.length > 0) {
    seccionesVisibles.push(crearSection('Documentación', cards));
  }
  if (comps) {
    // fuera del zoom a propósito: es zona de staging, no parte del resultado
    crearSection('🧩 Componentes base', [comps.inicioFin, comps.proceso, comps.decision, comps.inputOutput]);
  }
  figma.viewport.scrollAndZoomIntoView(seccionesVisibles);

  // --- Resumen para el status de la UI ---
  let resumen = `Diagrama generado (${posiciones.size} nodos).`;
  const avisos = warnings.concat(grafo.warnings, Array.from(avisosEstilo));
  if (separarEdgeCases) {
    if (nodosEdgeCases.length > 0) {
      resumen += ` Edge cases separados (${nodosEdgeCases.length} nodos).`;
    } else {
      avisos.push('No hay nodos de edge case/error para separar (ninguna clase de ' +
        'la lista off-path está asignada en el diagrama).');
    }
  }
  if (!generarDocs) {
    resumen += ' Documentación omitida (toggle desactivado).';
  } else if (cards.length > 0) {
    resumen += ` Documentación generada (${cards.length} cards).`;
  } else {
    avisos.push('No se encontraron secciones de documentación para generar cards.');
  }
  if (documentacion) {
    for (const a of documentacion.avisos) avisos.push(a);
  }
  return { resumen, warnings: avisos };
}

figma.ui.onmessage = async (msg: { type: string; markdown?: string; generarDocs?: boolean; separarEdgeCases?: boolean }) => {
  if (msg.type !== 'generar') return;
  const generarDocs = msg.generarDocs === true;
  const separarEdgeCases = msg.separarEdgeCases === true;
  figma.clientStorage.setAsync(CLAVE_DOCS, generarDocs);           // persistir sin bloquear
  figma.clientStorage.setAsync(CLAVE_EDGE_CASES, separarEdgeCases);
  try {
    const { resumen, warnings } = await generar(msg.markdown || '', generarDocs, separarEdgeCases);
    figma.ui.postMessage({ type: 'ok', resumen, warnings });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', mensaje: e instanceof Error ? e.message : String(e) });
  }
};
