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
import type { LineaCard, BloqueCard, TablaCard } from './parseMarkdown.ts';
import { t } from './i18n.ts';
import type { Idioma } from './i18n.ts';
import { ESTILO_CONECTOR, COLOR_CONECTOR_OFFPATH } from './connectorStyle.ts';

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
  conector: { fill: { r: 0.95, g: 0.95, b: 0.96 }, stroke: { r: 0.45, g: 0.45, b: 0.5 }, texto: { r: 0.25, g: 0.25, b: 0.3 }, dashed: false },
};

// Resuelve el estilo de un nodo: primera clase con classDef definido gana;
// clase sin definir → default por forma + aviso; sin clase → default por forma.
export function resolverEstilo(nodo: Nodo, classDefs: Map<string, EstiloClase>, lang: Idioma = 'en'): { estilo: EstiloNodo; aviso: string | null } {
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
    return { estilo: base, aviso: t('aviso.claseSinDef', lang, { clase: nodo.clases.join(', ') }) };
  }
  return { estilo: base, aviso: null };
}

// Tamaños discretos por forma (más robusto que perseguir un fit pixel-perfect
// con formas vectoriales). umbralLargo = caracteres a partir de los cuales se
// usa el preset largo; umbralFuente = a partir de los cuales, ya en el preset
// más grande, se baja la fuente de 14 a 12 en vez de desbordar.
interface Preset { w: number; h: number }
const PRESETS: Record<Forma, { corto: Preset; largo: Preset; umbralLargo: number; umbralFuente: number }> = {
  inicioFin: { corto: { w: 140, h: 140 }, largo: { w: 170, h: 170 }, umbralLargo: 30, umbralFuente: 60 }, // círculo
  proceso: { corto: { w: 220, h: 90 }, largo: { w: 260, h: 110 }, umbralLargo: 40, umbralFuente: 110 },
  decision: { corto: { w: 260, h: 160 }, largo: { w: 320, h: 200 }, umbralLargo: 30, umbralFuente: 80 },
  inputOutput: { corto: { w: 260, h: 100 }, largo: { w: 300, h: 120 }, umbralLargo: 30, umbralFuente: 90 },
  conector: { corto: { w: 80, h: 80 }, largo: { w: 110, h: 110 }, umbralLargo: 6, umbralFuente: 16 }, // junction chico
};

const FORMA_A_SHAPETYPE: Record<Forma, ShapeWithTextNode['shapeType']> = {
  inicioFin: 'ELLIPSE',
  proceso: 'ROUNDED_RECTANGLE',
  decision: 'DIAMOND',
  inputOutput: 'PARALLELOGRAM_RIGHT',
  conector: 'ELLIPSE', // FigJam no tiene círculo doble: queda círculo simple chico
};

type Geometria = EllipseNode | RectangleNode | VectorNode;

function crearGeometria(forma: Forma, w: number, h: number): Geometria {
  if (forma === 'inicioFin' || forma === 'conector') {
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
  if (forma === 'inicioFin' || forma === 'conector') return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
  return { x: 16, y: 12, w: w - 32, h: h - 24 };
}

export interface ComponentesBase {
  set: ComponentSetNode;
  variantes: Record<Forma, ComponentNode>;
}

// Convención de variantes de Figma: la propiedad se llama "Type". Nombres
// fijos (sin traducir): son funcionales para el selector nativo de variante.
const NOMBRES_VARIANTE: Record<Forma, string> = {
  inicioFin: 'Type=Start / End',
  proceso: 'Type=Process',
  decision: 'Type=Decision',
  inputOutput: 'Type=Options / Input',
  conector: 'Type=Connector',
};

// Crea las 4 variantes y las combina en el Component Set "user-flow-elements"
// (solo Figma Design). Las fuentes deben estar cargadas antes de llamar.
// Las 4 variantes comparten estructura interna (capas "forma" + "texto") para
// que el swap de variante nativo de Figma funcione limpio.
export function createShapeComponents(x: number, y: number): ComponentesBase {
  const nombres = NOMBRES_VARIANTE;
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

    if (forma === 'conector') {
      // anillo interior concéntrico para sugerir el círculo doble de mermaid
      const anillo = figma.createEllipse();
      anillo.name = 'anillo';
      anillo.resize(w - 12, h - 12);
      anillo.fills = [];
      anillo.strokes = [{ type: 'SOLID', color: base.stroke }];
      anillo.strokeWeight = 1;
      comp.appendChild(anillo);
      anillo.x = 6;
      anillo.y = 6;
      anillo.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    }

    const texto = figma.createText();
    texto.name = 'texto';
    texto.fontName = FUENTE;
    texto.fontSize = 14;
    texto.textAlignHorizontal = 'CENTER';
    texto.textAlignVertical = 'CENTER';
    texto.textAutoResize = 'NONE';
    texto.characters = 'Text';
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

  // combinar en un único Component Set; las refs a las variantes siguen válidas
  const set = figma.combineAsVariants(
    [resultado.inicioFin, resultado.proceso, resultado.decision, resultado.inputOutput, resultado.conector],
    figma.currentPage,
  );
  set.name = 'user-flow-elements';
  set.x = x;
  set.y = y;
  return { set, variantes: resultado };
}

// Crea el nodo del diagrama centrado en (cx, cy): Instance de la variante
// correspondiente del Component Set en Figma Design, ShapeWithText en FigJam.
export function createDiagramNodeInstance(
  forma: Forma,
  texto: string,
  estilo: EstiloNodo,
  cx: number,
  cy: number,
  comps: ComponentesBase | null,
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
    if (estilo.dashed) shape.dashPattern = [4, 2];
    shape.text.characters = texto;
    shape.text.fontSize = fontSize;
    shape.text.fills = [{ type: 'SOLID', color: estilo.texto }];
    shape.x = cx - shape.width / 2;
    shape.y = cy - shape.height / 2;
    return shape;
  }

  const instancia = comps!.variantes[forma].createInstance();
  instancia.resize(w, h);
  // por tipo de nodo (no por nombre de capa, que podría traducirse); la
  // primera geometría es el fondo (fill + stroke), las demás (ej. el anillo
  // del conector) solo acompañan el stroke
  const geometrias = instancia.findAll((n) => n.type === 'ELLIPSE' || n.type === 'RECTANGLE' || n.type === 'VECTOR') as Geometria[];
  geometrias.forEach((g, i) => {
    g.strokes = [{ type: 'SOLID', color: estilo.stroke }];
    if (i === 0) {
      g.fills = [{ type: 'SOLID', color: estilo.fill }];
      if (estilo.dashed) g.dashPattern = [4, 2];
    }
  });
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

// Puntos de anclaje de la recta entre dos nodos (bordes enfrentados). Se usa
// para dibujar la línea simulada en Design y para ubicar el badge del label
// en ambos editores (en FigJam el conector nativo rutea por su cuenta: el
// badge queda en el punto medio geométrico entre nodos).
function puntosEntre(origen: SceneNode, destino: SceneNode): { x1: number; y1: number; x2: number; y2: number } {
  if (destino.y >= origen.y + origen.height) {
    // destino en una fila inferior: sale por abajo, entra por arriba
    return {
      x1: origen.x + origen.width / 2, y1: origen.y + origen.height,
      x2: destino.x + destino.width / 2, y2: destino.y,
    };
  }
  if (origen.y >= destino.y + destino.height) {
    // ponytail: back-edge (loop) como recta entre bordes derechos; si molesta
    // el cruce con otros nodos, upgrade a ruteo ortogonal
    return {
      x1: origen.x + origen.width, y1: origen.y + origen.height / 2,
      x2: destino.x + destino.width, y2: destino.y + destino.height / 2,
    };
  }
  // misma fila: entre los lados que se enfrentan
  const haciaDerecha = destino.x >= origen.x;
  return {
    x1: haciaDerecha ? origen.x + origen.width : origen.x, y1: origen.y + origen.height / 2,
    x2: haciaDerecha ? destino.x : destino.x + destino.width, y2: destino.y + destino.height / 2,
  };
}

// Badge negro tipo pill para el label de un conector, centrado en (cx, cy).
// Solo reemplaza cómo se muestra el label; la línea/flecha no se toca.
function crearBadgeLabel(label: string, cx: number, cy: number): FrameNode {
  const badge = figma.createFrame();
  badge.name = label;
  badge.layoutMode = 'HORIZONTAL';
  badge.primaryAxisSizingMode = 'AUTO';  // HUG: crece con el texto, sin límite
  badge.counterAxisSizingMode = 'AUTO';
  badge.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  badge.paddingLeft = badge.paddingRight = 6;
  badge.paddingTop = badge.paddingBottom = 4;
  badge.cornerRadius = 11; // pill completo para fuente 12 + padding 4

  const texto = figma.createText();
  texto.fontName = FUENTE;
  texto.fontSize = 12;
  texto.characters = label;
  texto.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  badge.appendChild(texto);

  badge.x = cx - badge.width / 2;
  badge.y = cy - badge.height / 2;
  return badge;
}

// Conecta dos nodos: conector nativo en FigJam (default intacto, sin
// overrides), línea con flecha dibujada en Figma Design usando el mismo
// estilo (connectorStyle.ts) para que ambos editores se vean iguales.
// offPath = true → punteado y gris tenue (salida del camino feliz o retorno).
// El label (si hay) va como badge negro en el punto medio, no como texto nativo.
let dumpConectorLogueado = false;

export async function createConnectorLike(origen: SceneNode, destino: SceneNode, label?: string, offPath?: boolean, lang: Idioma = 'en'): Promise<SceneNode[]> {
  const colorLinea = offPath ? COLOR_CONECTOR_OFFPATH : ESTILO_CONECTOR.color;

  if (figma.editorType === 'figjam') {
    const conector = figma.createConnector();
    conector.connectorStart = { endpointNodeId: origen.id, magnet: 'AUTO' };
    conector.connectorEnd = { endpointNodeId: destino.id, magnet: 'AUTO' };
    if (!dumpConectorLogueado) {
      // dump de verificación: pegar estos valores en connectorStyle.ts si difieren
      dumpConectorLogueado = true;
      const c = conector as unknown as Record<string, unknown>;
      console.log('[markdown-to-flow] conector default de FigJam (verificar connectorStyle.ts): ' + JSON.stringify({
        strokes: c.strokes,
        strokeWeight: c.strokeWeight,
        connectorLineType: c.connectorLineType,
        startCap: c.connectorStartStrokeCap,
        endCap: c.connectorEndStrokeCap,
        dashPattern: c.dashPattern,
      }));
    }
    if (offPath) {
      // único caso con override explícito de estilo sobre el default
      conector.strokes = [{ type: 'SOLID', color: colorLinea }];
      conector.dashPattern = [6, 6];
    }
    if (label) {
      const p = puntosEntre(origen, destino);
      return [conector, crearBadgeLabel(label, (p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2)];
    }
    return [conector];
  }

  // Figma Design: línea recta entre bordes. No es re-enrutable, alcanza para v1.
  const { x1, y1, x2, y2 } = puntosEntre(origen, destino);
  if (x1 === x2 && y1 === y2) return [];

  const linea = figma.createVector();
  linea.name = label ? t('canvas.capaFlecha', lang, { label }) : t('canvas.capaFlechaSimple', lang);
  linea.strokes = [{ type: 'SOLID', color: colorLinea }];
  linea.strokeWeight = ESTILO_CONECTOR.strokeWeight;
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
    creados.push(crearBadgeLabel(label, (x1 + x2) / 2, (y1 + y2) / 2));
  }
  return creados;
}

// Concatena las líneas de una card en un solo texto, acumulando los rangos
// que van en bold (compartido entre la card frame y el sticky nativo).
function construirCuerpo(lineas: LineaCard[], lang: Idioma): { cuerpo: string; rangos: { inicio: number; fin: number }[] } {
  let cuerpo = '';
  const rangos: { inicio: number; fin: number }[] = [];
  for (const linea of lineas) {
    const negrita = construirNegritas(linea.texto);
    if (negrita.malCerrado) {
      console.warn('[markdown-to-flow] ' + t('aviso.negritaSinCerrar', lang, { linea: linea.texto }));
    }
    const prefijo = '    '.repeat(linea.sangria);
    const offset = cuerpo.length + prefijo.length;
    for (const r of negrita.rangos) {
      rangos.push({ inicio: offset + r.inicio, fin: offset + r.fin });
    }
    cuerpo += prefijo + negrita.texto + '\n';
  }
  cuerpo = cuerpo.length > 0 ? cuerpo.slice(0, -1) : t('canvas.sinContenido', lang);
  return { cuerpo, rangos };
}

// Card de documentación: frame blanco con header en bold y el contenido por
// bloques — texto (con negritas por rangos) intercalado con tablas reales.
// Igual en los dos editores.
export function createSectionCard(titulo: string, bloques: BloqueCard[], x: number, y: number, lang: Idioma = 'en'): FrameNode {
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

  const agregarTexto = (lineas: LineaCard[]) => {
    const { cuerpo, rangos } = construirCuerpo(lineas, lang);
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
  };

  if (bloques.length === 0) {
    agregarTexto([]); // "(sin contenido)"
  }
  for (const bloque of bloques) {
    if (bloque.tipo === 'texto') {
      agregarTexto(bloque.lineas);
    } else {
      card.appendChild(crearTabla(bloque.tabla, ANCHO_CARD - 48, lang));
    }
  }

  card.x = x;
  card.y = y;
  return card;
}

// Título del flujo (flowLabel) como texto suelto dentro del Section del
// diagrama — misma tipografía que el header de las cards de documentación.
export function crearTituloFlujo(label: string, x: number, y: number): TextNode {
  const titulo = figma.createText();
  titulo.fontName = FUENTE_BOLD;
  titulo.fontSize = 18;
  titulo.characters = label;
  titulo.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 } }];
  titulo.x = x;
  titulo.y = y;
  return titulo;
}

// Anotación al costado de un nodo conector: "CO → descripción de la leyenda",
// con pinta de sticky note chico (el sticky nativo de FigJam no se puede
// achicar — no tiene resize — así que se simula igual en los dos editores).
export function crearAnotacionConector(texto: string, x: number, y: number): FrameNode {
  const nota = figma.createFrame();
  nota.name = texto;
  nota.layoutMode = 'HORIZONTAL';
  nota.primaryAxisSizingMode = 'AUTO';
  nota.counterAxisSizingMode = 'AUTO';
  nota.fills = [{ type: 'SOLID', color: { r: 1, g: 0.976, b: 0.694 } }]; // amarillo sticky
  nota.paddingLeft = nota.paddingRight = 8;
  nota.paddingTop = nota.paddingBottom = 6;
  nota.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.15 },
    offset: { x: 0, y: 2 },
    radius: 3,
    visible: true,
    blendMode: 'NORMAL',
  }];

  const contenido = figma.createText();
  contenido.fontName = FUENTE_REGULAR;
  contenido.fontSize = 11;
  contenido.characters = texto;
  contenido.fills = [{ type: 'SOLID', color: { r: 0.25, g: 0.22, b: 0.05 } }];
  nota.appendChild(contenido);

  nota.x = x;
  nota.y = y;
  return nota;
}

// Tabla dentro de una card: nativa en FigJam (createTable + cellAt), simulada
// con frames en Figma Design. Devuelve el nodo listo para appendChild.
function crearTabla(tabla: TablaCard, anchoDisponible: number, lang: Idioma): SceneNode {
  if (figma.editorType === 'figjam') {
    try {
      const nativa = figma.createTable(tabla.filas.length + 1, tabla.headers.length);
      tabla.headers.forEach((h, c) => {
        const celda = nativa.cellAt(0, c);
        const plano = construirNegritas(h).texto;
        celda.text.characters = plano;
        celda.text.setRangeFontName(0, plano.length, FUENTE_BOLD);
        celda.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.95 } }];
      });
      tabla.filas.forEach((fila, f) => {
        fila.forEach((valor, c) => {
          const negrita = construirNegritas(valor);
          const celda = nativa.cellAt(f + 1, c);
          celda.text.characters = negrita.texto;
          for (const r of negrita.rangos) celda.text.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
        });
      });
      return nativa;
    } catch (e) {
      console.warn('[markdown-to-flow] createTable falló; se usa la tabla simulada: ' + String(e));
    }
  }

  // simulada: frame vertical de filas; celdas de ancho fijo para que las
  // columnas queden alineadas (cada fila es un autolayout independiente)
  const anchoCelda = Math.floor(anchoDisponible / tabla.headers.length);
  const contenedor = figma.createFrame();
  contenedor.name = 'tabla';
  contenedor.layoutMode = 'VERTICAL';
  contenedor.primaryAxisSizingMode = 'AUTO';
  contenedor.counterAxisSizingMode = 'AUTO';
  contenedor.fills = [];

  const crearFila = (valores: string[], esHeader: boolean) => {
    const fila = figma.createFrame();
    fila.layoutMode = 'HORIZONTAL';
    fila.primaryAxisSizingMode = 'AUTO';
    fila.counterAxisSizingMode = 'AUTO';
    fila.fills = esHeader ? [{ type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.95 } }] : [];
    fila.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
    fila.strokeBottomWeight = 1;
    for (const valor of valores) {
      const celda = figma.createFrame();
      celda.layoutMode = 'VERTICAL';
      celda.primaryAxisSizingMode = 'AUTO';
      celda.counterAxisSizingMode = 'FIXED';
      celda.resize(anchoCelda, celda.height);
      celda.paddingTop = celda.paddingBottom = 6;
      celda.paddingLeft = celda.paddingRight = 8;
      celda.fills = [];
      const negrita = construirNegritas(valor);
      const texto = figma.createText();
      texto.fontName = esHeader ? FUENTE_BOLD : FUENTE_REGULAR;
      texto.fontSize = 12;
      texto.characters = negrita.texto;
      if (!esHeader) {
        for (const r of negrita.rangos) texto.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
      }
      texto.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
      celda.appendChild(texto);
      texto.layoutAlign = 'STRETCH';
      texto.textAutoResize = 'HEIGHT';
      fila.appendChild(celda);
    }
    contenedor.appendChild(fila);
  };

  crearFila(tabla.headers, true);
  for (const fila of tabla.filas) crearFila(fila, false);
  return contenedor;
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
