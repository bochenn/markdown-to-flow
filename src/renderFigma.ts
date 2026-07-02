// Creación de nodos en el canvas.
//
// Nodos del diagrama (verificado contra la Plugin API, 2026-07):
// - Figma Design: ComponentNode maestro por forma + createInstance() por nodo.
//   Editar un maestro propaga a todas sus instancias.
// - FigJam: figma.createComponent() NO existe ("only available in Figma Design").
//   Se usa figma.createShapeWithText() nativo, cuyo shapeType trae exactamente
//   las 4 formas que necesitamos (ELLIPSE, ROUNDED_RECTANGLE, DIAMOND,
//   PARALLELOGRAM_RIGHT), con texto integrado y magnets para conectores.
//   En FigJam NO hay maestro: editar un nodo no propaga al resto.
//
// El branching por figma.editorType queda contenido acá. Las cards de
// documentación (createSectionCard) usan frames comunes en los dos editores.

import { hexARgb } from './parseMermaid.ts';
import type { Nodo, Forma, EstiloClase } from './parseMermaid.ts';
import { construirNegritas } from './parseMarkdown.ts';
import type { LineaCard } from './parseMarkdown.ts';

export const FUENTE: FontName = { family: 'Inter', style: 'Medium' };          // nodos y conectores
export const FUENTE_REGULAR: FontName = { family: 'Inter', style: 'Regular' }; // body de las cards
export const FUENTE_BOLD: FontName = { family: 'Inter', style: 'Bold' };       // headers y negritas

export const ANCHO_CARD = 420;

type Color = { r: number; g: number; b: number };

export interface EstiloNodo {
  fill: Color;
  stroke: Color;
  texto: Color;
  dashed: boolean;
}

// Colores default por forma, para nodos sin clase (o con clase sin classDef).
const ESTILOS_DEFAULT: Record<Forma, EstiloNodo> = {
  inicioFin: { fill: { r: 0.86, g: 0.99, b: 0.91 }, stroke: { r: 0.09, g: 0.64, b: 0.29 }, texto: { r: 0.09, g: 0.37, b: 0.2 }, dashed: false },
  proceso: { fill: { r: 1, g: 0.98, b: 0.76 }, stroke: { r: 0.79, g: 0.5, b: 0.02 }, texto: { r: 0.44, g: 0.25, b: 0.07 }, dashed: false },
  decision: { fill: { r: 0.84, g: 0.94, b: 1 }, stroke: { r: 0.01, g: 0.53, b: 0.82 }, texto: { r: 0, g: 0.34, b: 0.61 }, dashed: false },
  inputOutput: { fill: { r: 0.9, g: 0.88, b: 0.98 }, stroke: { r: 0.37, g: 0.21, b: 0.69 }, texto: { r: 0.19, g: 0.11, b: 0.57 }, dashed: false },
};

// Resuelve el estilo de un nodo: primera clase con classDef definido gana;
// clase sin definir → default por forma + aviso; sin clase → default por forma.
export function resolverEstilo(nodo: Nodo, classDefs: Map<string, EstiloClase>): { estilo: EstiloNodo; aviso: string | null } {
  const base = ESTILOS_DEFAULT[nodo.forma];
  for (const clase of nodo.clases) {
    const def = classDefs.get(clase);
    if (def) {
      return {
        estilo: {
          fill: hexARgb(def.fill || '') || base.fill,
          stroke: hexARgb(def.stroke || '') || base.stroke,
          texto: hexARgb(def.color || '') || base.texto,
          dashed: def.dashed === true,
        },
        aviso: null,
      };
    }
  }
  if (nodo.clases.length > 0) {
    return { estilo: base, aviso: `Clase "${nodo.clases.join(', ')}" sin classDef; se usa el color default de la forma.` };
  }
  return { estilo: base, aviso: null };
}

// Tamaños discretos por forma (más robusto que perseguir un fit pixel-perfect
// con formas vectoriales). umbralLargo = caracteres a partir de los cuales se
// usa el preset largo; umbralFuente = a partir de los cuales, ya en el preset
// más grande, se baja la fuente de 14 a 12 en vez de desbordar.
interface Preset { w: number; h: number }
const PRESETS: Record<Forma, { corto: Preset; largo: Preset; umbralLargo: number; umbralFuente: number }> = {
  inicioFin: { corto: { w: 220, h: 90 }, largo: { w: 260, h: 110 }, umbralLargo: 40, umbralFuente: 110 },
  proceso: { corto: { w: 220, h: 90 }, largo: { w: 260, h: 110 }, umbralLargo: 40, umbralFuente: 110 },
  decision: { corto: { w: 260, h: 160 }, largo: { w: 320, h: 200 }, umbralLargo: 30, umbralFuente: 80 },
  inputOutput: { corto: { w: 260, h: 100 }, largo: { w: 300, h: 120 }, umbralLargo: 30, umbralFuente: 90 },
};

const FORMA_A_SHAPETYPE: Record<Forma, ShapeWithTextNode['shapeType']> = {
  inicioFin: 'ELLIPSE',
  proceso: 'ROUNDED_RECTANGLE',
  decision: 'DIAMOND',
  inputOutput: 'PARALLELOGRAM_RIGHT',
};

type Geometria = EllipseNode | RectangleNode | VectorNode;

function crearGeometria(forma: Forma, w: number, h: number): Geometria {
  if (forma === 'inicioFin') {
    const ovalo = figma.createEllipse();
    ovalo.resize(w, h);
    return ovalo;
  }
  if (forma === 'proceso') {
    const rect = figma.createRectangle();
    rect.resize(w, h);
    rect.cornerRadius = 6;
    return rect;
  }
  const vector = figma.createVector();
  const slant = Math.round(w * 0.2);
  vector.vectorPaths = [{
    windingRule: 'NONZERO',
    data: forma === 'decision'
      ? `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`
      : `M ${slant} 0 L ${w} 0 L ${w - slant} ${h} L 0 ${h} Z`,
  }];
  return vector;
}

// Área segura de texto dentro del bounding box: el rombo pierde superficie en
// las esquinas (60% del box), el paralelogramo pierde los bordes inclinados.
function areaTexto(forma: Forma, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (forma === 'decision') return { x: w * 0.2, y: h * 0.2, w: w * 0.6, h: h * 0.6 };
  if (forma === 'inputOutput') {
    const slant = w * 0.2;
    return { x: slant + 8, y: 12, w: w - slant * 2 - 16, h: h - 24 };
  }
  if (forma === 'inicioFin') return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
  return { x: 16, y: 12, w: w - 32, h: h - 24 };
}

// Crea los 4 Components maestro (solo Figma Design), apilados a partir de (x, y).
// Las fuentes deben estar cargadas antes de llamar.
export function createShapeComponents(x: number, y: number): Record<Forma, ComponentNode> {
  const nombres: Record<Forma, string> = {
    inicioFin: 'Nodo / Inicio-Fin (óvalo)',
    proceso: 'Nodo / Proceso (rectángulo)',
    decision: 'Nodo / Decisión (rombo)',
    inputOutput: 'Nodo / Opciones (paralelogramo)',
  };
  const resultado = {} as Record<Forma, ComponentNode>;
  let offsetY = 0;
  for (const forma of Object.keys(nombres) as Forma[]) {
    const { w, h } = PRESETS[forma].corto;
    const base = ESTILOS_DEFAULT[forma];

    const comp = figma.createComponent();
    comp.name = nombres[forma];
    comp.resizeWithoutConstraints(w, h);
    comp.fills = [];
    comp.x = x;
    comp.y = y + offsetY;
    offsetY += h + 60;

    const geometria = crearGeometria(forma, w, h);
    geometria.name = 'forma';
    geometria.fills = [{ type: 'SOLID', color: base.fill }];
    geometria.strokes = [{ type: 'SOLID', color: base.stroke }];
    geometria.strokeWeight = 2;
    comp.appendChild(geometria);
    geometria.x = 0;
    geometria.y = 0;
    // SCALE: al redimensionar la instancia, la geometría se estira con ella
    geometria.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };

    const texto = figma.createText();
    texto.name = 'texto';
    texto.fontName = FUENTE;
    texto.fontSize = 14;
    texto.textAlignHorizontal = 'CENTER';
    texto.textAlignVertical = 'CENTER';
    texto.textAutoResize = 'NONE';
    texto.characters = 'Texto';
    texto.fills = [{ type: 'SOLID', color: base.texto }];
    comp.appendChild(texto);
    const area = areaTexto(forma, w, h);
    texto.x = area.x;
    texto.y = area.y;
    texto.resize(area.w, area.h);
    // SCALE agranda la caja de texto con la instancia; el fontSize no cambia
    texto.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };

    resultado[forma] = comp;
  }
  return resultado;
}

// Crea el nodo del diagrama centrado en (cx, cy): Instance del Component
// correspondiente en Figma Design, ShapeWithText nativo en FigJam.
export function createDiagramNodeInstance(
  forma: Forma,
  texto: string,
  estilo: EstiloNodo,
  cx: number,
  cy: number,
  comps: Record<Forma, ComponentNode> | null,
): SceneNode {
  const preset = PRESETS[forma];
  const { w, h } = texto.length > preset.umbralLargo ? preset.largo : preset.corto;
  const fontSize = texto.length > preset.umbralFuente ? 12 : 14;

  if (figma.editorType === 'figjam') {
    const shape = figma.createShapeWithText();
    shape.shapeType = FORMA_A_SHAPETYPE[forma];
    shape.resize(w, h);
    shape.fills = [{ type: 'SOLID', color: estilo.fill }];
    shape.strokes = [{ type: 'SOLID', color: estilo.stroke }];
    shape.strokeWeight = 2;
    if (estilo.dashed) {
      // ponytail: dashPattern no figura en el typing de ShapeWithText; si el
      // runtime no lo soporta, el nodo queda con borde sólido y ya
      try { (shape as unknown as { dashPattern: number[] }).dashPattern = [4, 2]; } catch (e) { /* sin punteado */ }
    }
    shape.text.characters = texto;
    shape.text.fontSize = fontSize;
    shape.text.fills = [{ type: 'SOLID', color: estilo.texto }];
    shape.x = cx - w / 2;
    shape.y = cy - h / 2;
    return shape;
  }

  const instancia = comps![forma].createInstance();
  instancia.resize(w, h);
  const geometria = instancia.findOne((n) => n.name === 'forma') as Geometria | null;
  if (geometria) {
    geometria.fills = [{ type: 'SOLID', color: estilo.fill }];
    geometria.strokes = [{ type: 'SOLID', color: estilo.stroke }];
    if (estilo.dashed) geometria.dashPattern = [4, 2];
  }
  const textoNodo = instancia.findOne((n) => n.type === 'TEXT') as TextNode | null;
  if (textoNodo) {
    textoNodo.characters = texto;
    textoNodo.fontSize = fontSize;
    textoNodo.fills = [{ type: 'SOLID', color: estilo.texto }];
  }
  instancia.x = cx - w / 2;
  instancia.y = cy - h / 2;
  return instancia;
}

// Conecta dos nodos: conector nativo en FigJam, línea con flecha dibujada en
// Figma Design. Devuelve los nodos creados para poder agruparlos en el Section.
// offPath = true → punteado y gris tenue (salida del camino feliz o retorno).
export async function createConnectorLike(origen: SceneNode, destino: SceneNode, label?: string, offPath?: boolean): Promise<SceneNode[]> {
  const colorLinea = offPath ? { r: 0.62, g: 0.62, b: 0.62 } : { r: 0.4, g: 0.4, b: 0.4 };

  if (figma.editorType === 'figjam') {
    const conector = figma.createConnector();
    conector.connectorStart = { endpointNodeId: origen.id, magnet: 'AUTO' };
    conector.connectorEnd = { endpointNodeId: destino.id, magnet: 'AUTO' };
    conector.connectorEndStrokeCap = 'ARROW_LINES';
    if (offPath) {
      conector.strokes = [{ type: 'SOLID', color: colorLinea }];
      // ponytail: dashPattern no figura en el typing del conector; si el
      // runtime no lo soporta, queda gris sólido y ya
      try { (conector as unknown as { dashPattern: number[] }).dashPattern = [6, 6]; } catch (e) { /* sin punteado */ }
    }
    if (label) conector.text.characters = label;
    return [conector];
  }

  // Figma Design: línea recta entre bordes. No es re-enrutable, alcanza para v1.
  let x1: number, y1: number, x2: number, y2: number;
  if (destino.y >= origen.y + origen.height) {
    // destino en una fila inferior: sale por abajo, entra por arriba
    x1 = origen.x + origen.width / 2;
    y1 = origen.y + origen.height;
    x2 = destino.x + destino.width / 2;
    y2 = destino.y;
  } else if (origen.y >= destino.y + destino.height) {
    // ponytail: back-edge (loop) como recta entre bordes derechos; si molesta
    // el cruce con otros nodos, upgrade a ruteo ortogonal
    x1 = origen.x + origen.width;
    y1 = origen.y + origen.height / 2;
    x2 = destino.x + destino.width;
    y2 = destino.y + destino.height / 2;
  } else {
    // misma fila: entre los lados que se enfrentan
    const haciaDerecha = destino.x >= origen.x;
    x1 = haciaDerecha ? origen.x + origen.width : origen.x;
    y1 = origen.y + origen.height / 2;
    x2 = haciaDerecha ? destino.x : destino.x + destino.width;
    y2 = destino.y + destino.height / 2;
  }
  if (x1 === x2 && y1 === y2) return [];

  const linea = figma.createVector();
  linea.name = label ? `flecha (${label})` : 'flecha';
  linea.strokes = [{ type: 'SOLID', color: colorLinea }];
  linea.strokeWeight = 2;
  if (offPath) linea.dashPattern = [6, 6];
  linea.x = 0;
  linea.y = 0;
  await linea.setVectorNetworkAsync({
    vertices: [
      { x: x1, y: y1, strokeCap: 'NONE' },
      { x: x2, y: y2, strokeCap: 'ARROW_LINES' },
    ],
    segments: [{ start: 0, end: 1 }],
    regions: [],
  });

  const creados: SceneNode[] = [linea];
  if (label) {
    const textoLabel = figma.createText();
    textoLabel.fontName = FUENTE;
    textoLabel.fontSize = 12;
    textoLabel.characters = label;
    textoLabel.fills = [{ type: 'SOLID', color: { r: 0.25, g: 0.25, b: 0.25 } }];
    textoLabel.x = (x1 + x2) / 2 - textoLabel.width / 2;
    textoLabel.y = (y1 + y2) / 2 - textoLabel.height / 2 - 10;
    creados.push(textoLabel);
  }
  return creados;
}

// Card de documentación: frame blanco con header en bold y un solo TextNode
// de body con las negritas aplicadas por rangos. Igual en los dos editores.
export function createSectionCard(titulo: string, lineas: LineaCard[], x: number, y: number): FrameNode {
  const card = figma.createFrame();
  card.name = titulo;
  card.fills = [{ type: 'SOLID', color: { r: 0.99, g: 0.99, b: 0.99 } }];
  card.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
  card.strokeWeight = 1;
  card.cornerRadius = 8;
  card.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.08 },
    offset: { x: 0, y: 1 },
    radius: 4,
    visible: true,
    blendMode: 'NORMAL',
  }];
  card.layoutMode = 'VERTICAL';
  card.primaryAxisSizingMode = 'AUTO';
  card.counterAxisSizingMode = 'FIXED';
  card.resize(ANCHO_CARD, card.height);
  card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 24;
  card.itemSpacing = 12;

  const header = figma.createText();
  header.fontName = FUENTE_BOLD;
  header.fontSize = 18;
  header.characters = titulo;
  header.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  card.appendChild(header);
  header.layoutAlign = 'STRETCH';
  header.textAutoResize = 'HEIGHT';

  // Body: se concatena todo en un solo texto acumulando los rangos en bold.
  let cuerpo = '';
  const rangos: { inicio: number; fin: number }[] = [];
  for (const linea of lineas) {
    const negrita = construirNegritas(linea.texto);
    if (negrita.malCerrado) {
      console.warn(`[markdown-to-flow] Negrita sin cerrar, se deja como texto plano: "${linea.texto}"`);
    }
    const prefijo = '    '.repeat(linea.sangria);
    const offset = cuerpo.length + prefijo.length;
    for (const r of negrita.rangos) {
      rangos.push({ inicio: offset + r.inicio, fin: offset + r.fin });
    }
    cuerpo += prefijo + negrita.texto + '\n';
  }
  cuerpo = cuerpo.length > 0 ? cuerpo.slice(0, -1) : '(sin contenido)';

  const body = figma.createText();
  body.fontName = FUENTE_REGULAR;
  body.fontSize = 13;
  body.lineHeight = { value: 150, unit: 'PERCENT' };
  body.characters = cuerpo;
  body.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
  for (const r of rangos) {
    body.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
  }
  card.appendChild(body);
  body.layoutAlign = 'STRETCH';
  body.textAutoResize = 'HEIGHT';

  card.x = x;
  card.y = y;
  return card;
}

// Agrupa nodos en un SectionNode (los Section no auto-ajustan su tamaño:
// se dimensiona al bounding box y se reajustan las coordenadas de los hijos).
export function crearSection(nombre: string, hijos: SceneNode[]): SectionNode {
  const MARGEN = 60;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of hijos) {
    if (h.type === 'CONNECTOR') continue; // los conectores siguen a sus endpoints
    minX = Math.min(minX, h.x);
    minY = Math.min(minY, h.y);
    maxX = Math.max(maxX, h.x + h.width);
    maxY = Math.max(maxY, h.y + h.height);
  }
  const seccion = figma.createSection();
  seccion.name = nombre;
  seccion.x = minX - MARGEN;
  seccion.y = minY - MARGEN;
  seccion.resizeWithoutConstraints(maxX - minX + MARGEN * 2, maxY - minY + MARGEN * 2);
  for (const h of hijos) {
    if (h.type === 'CONNECTOR') {
      seccion.appendChild(h);
      continue;
    }
    const absX = h.x, absY = h.y;
    seccion.appendChild(h); // al reparentar, x/y pasan a ser relativas al section
    h.x = absX - seccion.x;
    h.y = absY - seccion.y;
  }
  return seccion;
}
