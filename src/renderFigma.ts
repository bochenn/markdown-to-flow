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
import type { Nodo, Forma, EstiloClase, Grafo } from './parseMermaid.ts';
import { construirNegritas, construirRico } from './parseMarkdown.ts';
import type { LineaCard, BloqueCard, TablaCard } from './parseMarkdown.ts';
import { t } from './i18n.ts';
import type { Idioma } from './i18n.ts';
import {
  ESTILO_CONECTOR,
  COLOR_SALTO_LARGO,
  RADIO_CODO,
  DESVIO_RETORNO,
  MARGEN_OBSTACULO,
  MARGEN_CARRIL,
  SEPARACION_CARRIL,
} from './connectorStyle.ts';
import { esOffPath, calcularLayout } from './layoutDiagram.ts';
import type { DescomposicionCards, RamaCard, Carril } from './layoutDiagram.ts';

export const FUENTE: FontName = { family: 'Inter', style: 'Medium' };          // nodos y conectores
export const FUENTE_REGULAR: FontName = { family: 'Inter', style: 'Regular' }; // body de las cards
export const FUENTE_BOLD: FontName = { family: 'Inter', style: 'Bold' };       // headers y negritas

// Fuente monoespaciada para el código inline (`texto`): se intenta cargar la
// primera candidata disponible; si ninguna carga, el fallback es solo quitar
// los backticks sin cambiar la fuente.
let FUENTE_MONO: FontName | null = null;

export async function cargarFuenteMono(): Promise<void> {
  for (const family of ['Roboto Mono', 'Source Code Pro', 'IBM Plex Mono']) {
    try {
      await figma.loadFontAsync({ family, style: 'Regular' });
      FUENTE_MONO = { family, style: 'Regular' };
      return;
    } catch (e) {
      // probar la siguiente candidata
    }
  }
  FUENTE_MONO = null;
}

export const ANCHO_CARD = 420;

type Color = { r: number; g: number; b: number };

export interface EstiloNodo {
  fill: Color;
  stroke: Color;
  texto: Color;
  dashed: boolean;
}

const NEGRO: Color = { r: 0, g: 0, b: 0 };

// Colores default por forma (paleta de las variantes). El texto es negro al
// 90% de opacidad en todas — la opacidad se aplica en el paint, no en el hex.
const ESTILOS_DEFAULT: Record<Forma, EstiloNodo> = {
  inicioFin: { fill: { r: 207 / 255, g: 247 / 255, b: 211 / 255 }, stroke: { r: 0, g: 128 / 255, b: 67 / 255 }, texto: NEGRO, dashed: false },        // #CFF7D3 / #008043
  proceso: { fill: { r: 1, g: 241 / 255, b: 194 / 255 }, stroke: { r: 250 / 255, g: 184 / 255, b: 21 / 255 }, texto: NEGRO, dashed: false },          // #FFF1C2 / #FAB815
  decision: { fill: { r: 229 / 255, g: 244 / 255, b: 1 }, stroke: { r: 7 / 255, g: 104 / 255, b: 207 / 255 }, texto: NEGRO, dashed: false },          // #E5F4FF / #0768CF
  inputOutput: { fill: { r: 241 / 255, g: 229 / 255, b: 1 }, stroke: { r: 124 / 255, g: 43 / 255, b: 218 / 255 }, texto: NEGRO, dashed: false },      // #F1E5FF / #7C2BDA
  conector: { fill: { r: 0.95, g: 0.95, b: 0.96 }, stroke: { r: 0.45, g: 0.45, b: 0.5 }, texto: NEGRO, dashed: false },
};

// Nodos Process con clase de error: paleta propia que pisa la variante base
// y el classDef del archivo.
const PALETA_ERROR: EstiloNodo = {
  fill: { r: 1, g: 226 / 255, b: 224 / 255 },      // #FFE2E0
  stroke: { r: 189 / 255, g: 41 / 255, b: 21 / 255 }, // #BD2915
  texto: NEGRO,
  dashed: false,
};

// Pintura estándar del texto de nodos: #000000 al 90% de opacidad.
function pinturaTextoNodo(color: Color): SolidPaint[] {
  return [{ type: 'SOLID', color, opacity: 0.9 }];
}

// Resuelve el estilo de un nodo: primera clase con classDef definido gana;
// clase sin definir → default por forma + aviso; sin clase → default por forma.
export function resolverEstilo(nodo: Nodo, classDefs: Map<string, EstiloClase>, lang: Idioma = 'en'): { estilo: EstiloNodo; aviso: string | null } {
  // la clase de error pisa la variante base Y el classDef del archivo
  if (esOffPath(nodo)) {
    return { estilo: { fill: PALETA_ERROR.fill, stroke: PALETA_ERROR.stroke, texto: PALETA_ERROR.texto, dashed: false }, aviso: null };
  }
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
  label: ComponentNode;      // variante Type=Label: badge negro para labels de conector
  annotation: ComponentNode; // variante Type=Annotation: nota amarilla de reingreso
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
    texto.fills = pinturaTextoNodo(base.texto);
    comp.appendChild(texto);
    const area = areaTexto(forma, w, h);
    texto.x = area.x;
    texto.y = area.y;
    texto.resize(area.w, area.h);
    // SCALE agranda la caja de texto con la instancia; el fontSize no cambia
    texto.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };

    resultado[forma] = comp;
  }

  // 6ta variante: el badge de label de conector. Es un component con
  // autolayout HUG en ambos ejes — las instances se autoajustan al override
  // del texto (comportamiento estándar de autolayout en instances).
  const label = figma.createComponent();
  label.name = 'Type=Label';
  label.layoutMode = 'HORIZONTAL';
  label.primaryAxisSizingMode = 'AUTO';
  label.counterAxisSizingMode = 'AUTO';
  label.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  label.paddingLeft = label.paddingRight = 6;
  label.paddingTop = label.paddingBottom = 4;
  label.cornerRadius = 11;
  label.x = x;
  label.y = y + offsetY;
  const textoLabel = figma.createText();
  textoLabel.name = 'texto';
  textoLabel.fontName = FUENTE;
  textoLabel.fontSize = 12;
  textoLabel.characters = 'Label';
  textoLabel.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  label.appendChild(textoLabel);

  // 7ma variante: la anotación de los conectores de reingreso.
  // 200px de ancho fijo, alto hug, padding 16, texto Inter Medium 12 al 150%
  // con "fill" en el ancho (wrap dentro del frame, sin truncar).
  const annotation = figma.createComponent();
  annotation.name = 'Type=Annotation';
  annotation.layoutMode = 'VERTICAL';
  annotation.counterAxisSizingMode = 'FIXED';
  annotation.primaryAxisSizingMode = 'AUTO';
  annotation.resize(200, annotation.height);
  annotation.paddingLeft = annotation.paddingRight = annotation.paddingTop = annotation.paddingBottom = 16;
  annotation.cornerRadius = 4;
  annotation.fills = [{ type: 'SOLID', color: { r: 1, g: 241 / 255, b: 194 / 255 } }]; // #FFF1C2
  annotation.effects = [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: 0.15 },
    offset: { x: 0, y: 2 },
    radius: 3,
    visible: true,
    blendMode: 'NORMAL',
  }];
  const textoAnnotation = figma.createText();
  textoAnnotation.name = 'texto';
  textoAnnotation.fontName = FUENTE; // Inter Medium
  textoAnnotation.fontSize = 12;
  textoAnnotation.lineHeight = { value: 150, unit: 'PERCENT' };
  textoAnnotation.characters = 'Annotation';
  textoAnnotation.fills = pinturaTextoNodo(NEGRO);
  annotation.appendChild(textoAnnotation);
  textoAnnotation.layoutAlign = 'STRETCH'; // fill en el ancho → wrap
  textoAnnotation.textAutoResize = 'HEIGHT';

  // combinar en un único Component Set; las refs a las variantes siguen válidas
  const set = figma.combineAsVariants(
    [resultado.inicioFin, resultado.proceso, resultado.decision, resultado.inputOutput, resultado.conector, label, annotation],
    figma.currentPage,
  );
  set.name = 'user-flow-elements';
  set.x = x;
  set.y = y;
  // borde dashed del contenedor del set (BaseFrameMixin → strokes/dashPattern directos)
  set.strokes = [{ type: 'SOLID', color: { r: 111 / 255, g: 62 / 255, b: 205 / 255 } }]; // #6F3ECD
  set.strokeWeight = 2;
  set.dashPattern = [8, 6];
  return { set, variantes: resultado, label, annotation };
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
    shape.text.fills = pinturaTextoNodo(estilo.texto);
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
    textoNodo.fills = pinturaTextoNodo(estilo.texto);
  }
  instancia.x = cx - w / 2;
  instancia.y = cy - h / 2;
  return instancia;
}

// ---------------------------------------------------------------------------
// Ruteo en codo (elbow) para los conectores, replicando el estilo nativo de
// FigJam: sale/entra por el borde más cercano, tramos en ángulo recto,
// esquinas redondeadas. Funciones puras, testeables en Node.
// ---------------------------------------------------------------------------

export interface Caja { x: number; y: number; width: number; height: number }
export interface Punto { x: number; y: number }

// Polilínea del recorrido entre dos nodos. Alineados → recta simple (sin codo
// artificial); desplazados → Z; destino arriba (retorno) → rodea por la
// derecha para no atravesar los nodos intermedios de la columna.
export function rutaElbow(origen: Caja, destino: Caja): Punto[] {
  if (destino.y >= origen.y + origen.height) {
    // destino abajo: sale por el borde inferior, entra por el superior
    const x1 = origen.x + origen.width / 2, y1 = origen.y + origen.height;
    const x2 = destino.x + destino.width / 2, y2 = destino.y;
    if (Math.abs(x1 - x2) < 1) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
    const midY = (y1 + y2) / 2;
    return [{ x: x1, y: y1 }, { x: x1, y: midY }, { x: x2, y: midY }, { x: x2, y: y2 }];
  }
  if (origen.y >= destino.y + destino.height) {
    // retorno (destino arriba): sale por la derecha y rodea
    const x1 = origen.x + origen.width, y1 = origen.y + origen.height / 2;
    const x2 = destino.x + destino.width, y2 = destino.y + destino.height / 2;
    const desvioX = Math.max(x1, x2) + DESVIO_RETORNO;
    return [{ x: x1, y: y1 }, { x: desvioX, y: y1 }, { x: desvioX, y: y2 }, { x: x2, y: y2 }];
  }
  // misma fila: entre los lados que se enfrentan
  const haciaDerecha = destino.x >= origen.x;
  const x1 = haciaDerecha ? origen.x + origen.width : origen.x;
  const x2 = haciaDerecha ? destino.x : destino.x + destino.width;
  const y1 = origen.y + origen.height / 2, y2 = destino.y + destino.height / 2;
  if (Math.abs(y1 - y2) < 1) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const midX = (x1 + x2) / 2;
  return [{ x: x1, y: y1 }, { x: midX, y: y1 }, { x: midX, y: y2 }, { x: x2, y: y2 }];
}

// Punto a mitad de la LONGITUD del recorrido (para centrar el badge del label).
export function puntoMedioRuta(puntos: Punto[]): Punto {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    total += Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].y - puntos[i - 1].y);
  }
  let restante = total / 2;
  for (let i = 1; i < puntos.length; i++) {
    const largo = Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].y - puntos[i - 1].y);
    if (restante <= largo && largo > 0) {
      const f = restante / largo;
      return {
        x: puntos[i - 1].x + (puntos[i].x - puntos[i - 1].x) * f,
        y: puntos[i - 1].y + (puntos[i].y - puntos[i - 1].y) * f,
      };
    }
    restante -= largo;
  }
  return puntos[puntos.length - 1];
}

// Path SVG de la polilínea con esquinas redondeadas: en cada codo se corta
// `radio` antes y después y se une con una curva Q por el vértice. El radio
// se reduce automáticamente si un tramo es más corto que 2×radio.
export function pathElbow(puntos: Punto[], radio: number = RADIO_CODO): string {
  const hacia = (desde: Punto, hasta: Punto, distancia: number): Punto => {
    const largo = Math.hypot(hasta.x - desde.x, hasta.y - desde.y);
    const f = largo === 0 ? 0 : distancia / largo;
    return { x: desde.x + (hasta.x - desde.x) * f, y: desde.y + (hasta.y - desde.y) * f };
  };
  let d = `M ${puntos[0].x} ${puntos[0].y}`;
  for (let i = 1; i < puntos.length - 1; i++) {
    const anterior = puntos[i - 1], codo = puntos[i], siguiente = puntos[i + 1];
    const r = Math.min(
      radio,
      Math.hypot(codo.x - anterior.x, codo.y - anterior.y) / 2,
      Math.hypot(siguiente.x - codo.x, siguiente.y - codo.y) / 2,
    );
    const entrada = hacia(codo, anterior, r);
    const salida = hacia(codo, siguiente, r);
    d += ` L ${entrada.x} ${entrada.y} Q ${codo.x} ${codo.y} ${salida.x} ${salida.y}`;
  }
  const fin = puntos[puntos.length - 1];
  d += ` L ${fin.x} ${fin.y}`;
  return d;
}

// ---------------------------------------------------------------------------
// Desvío por carril lateral: si la ruta default de un conector cruza el
// bounding box de un nodo que no es su origen ni su destino, se lo saca a un
// carril fuera del diagrama (heurística simple, sin pathfinding):
// sale por abajo → banda libre → carril lateral → banda sobre el destino →
// entra por arriba. Cada uso del carril se corre 16px para no superponerse.
// ---------------------------------------------------------------------------

export interface ContextoRuteo {
  obstaculos: Caja[];
  carrilDerecha: number;
  carrilIzquierda: number;
  usosDerecha: number;
  usosIzquierda: number;
  tramosH: { y: number; x1: number; x2: number }[]; // franjas horizontales ya ocupadas
}

export function crearContextoRuteo(obstaculos: Caja[]): ContextoRuteo {
  let minX = Infinity, maxX = -Infinity;
  for (const o of obstaculos) {
    minX = Math.min(minX, o.x);
    maxX = Math.max(maxX, o.x + o.width);
  }
  return {
    obstaculos,
    carrilDerecha: maxX + MARGEN_CARRIL,
    carrilIzquierda: minX - MARGEN_CARRIL,
    usosDerecha: 0,
    usosIzquierda: 0,
    tramosH: [],
  };
}

// Segmento axis-aligned vs caja expandida por `margen` (test de solapamiento
// de rectángulos: el segmento es un rectángulo degenerado).
export function segmentoCruzaCaja(a: Punto, b: Punto, caja: Caja, margen: number): boolean {
  return Math.min(a.x, b.x) < caja.x + caja.width + margen
    && Math.max(a.x, b.x) > caja.x - margen
    && Math.min(a.y, b.y) < caja.y + caja.height + margen
    && Math.max(a.y, b.y) > caja.y - margen;
}

function esMismaCaja(a: Caja, b: Caja): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// margen de detección: rozar el borde de un elemento cuenta como cruce
const MARGEN_DETECCION = 12;

function contarColisiones(puntos: Punto[], obstaculos: Caja[], origen: Caja, destino: Caja): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    for (const o of obstaculos) {
      if (esMismaCaja(o, origen) || esMismaCaja(o, destino)) continue;
      if (segmentoCruzaCaja(puntos[i - 1], puntos[i], o, MARGEN_DETECCION)) total++;
    }
  }
  return total;
}

function rutaCruzaObstaculos(puntos: Punto[], obstaculos: Caja[], origen: Caja, destino: Caja): boolean {
  return contarColisiones(puntos, obstaculos, origen, destino) > 0;
}

function largoRuta(puntos: Punto[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    total += Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].y - puntos[i - 1].y);
  }
  return total;
}

// Empuja una banda horizontal (a la altura `y`, entre x1 y x2) fuera de
// cualquier obstáculo que la pise, hacia abajo o hacia arriba.
function empujarBanda(
  y: number,
  x1: number,
  x2: number,
  obstaculos: Caja[],
  origen: Caja,
  destino: Caja,
  direccion: 'abajo' | 'arriba',
): number {
  for (let vueltas = 0; vueltas < 20; vueltas++) {
    let cambiado = false;
    for (const o of obstaculos) {
      if (esMismaCaja(o, origen) || esMismaCaja(o, destino)) continue;
      if (segmentoCruzaCaja({ x: Math.min(x1, x2), y }, { x: Math.max(x1, x2), y }, o, 4)) {
        y = direccion === 'abajo' ? o.y + o.height + MARGEN_OBSTACULO : o.y - MARGEN_OBSTACULO;
        cambiado = true;
      }
    }
    if (!cambiado) break;
  }
  return y;
}

// Separa los tramos horizontales INTERIORES de una ruta de las franjas ya
// ocupadas por rutas anteriores (mismo carril/banda): cada solape corre el
// tramo +SEPARACION_CARRIL, re-chequeando que no caiga sobre un nodo. Los
// labels heredan la separación porque el badge se centra sobre la ruta final.
// El orden es determinístico: orden de creación de los conectores.
function separarTramosCompartidos(puntos: Punto[], ctx: ContextoRuteo, origen: Caja, destino: Caja): void {
  for (let i = 1; i + 2 < puntos.length; i++) {
    const a = puntos[i];
    const b = puntos[i + 1];
    if (a.y !== b.y) continue; // solo tramos horizontales interiores
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    let y = a.y;
    for (let vueltas = 0; vueltas < 30; vueltas++) {
      let movido = false;
      for (const t of ctx.tramosH) {
        if (x1 < t.x2 && x2 > t.x1 && Math.abs(y - t.y) < SEPARACION_CARRIL - 4) {
          y += SEPARACION_CARRIL;
          movido = true;
        }
      }
      // el corrimiento no debe meter el tramo sobre un nodo ajeno
      for (const o of ctx.obstaculos) {
        if (esMismaCaja(o, origen) || esMismaCaja(o, destino)) continue;
        if (segmentoCruzaCaja({ x: x1, y }, { x: x2, y }, o, 4)) {
          y = o.y + o.height + MARGEN_OBSTACULO;
          movido = true;
        }
      }
      if (!movido) break;
    }
    a.y = y;
    b.y = y;
    ctx.tramosH.push({ y, x1, x2 });
  }
}

export interface RutaCalculada {
  puntos: Punto[];
  lado: 'derecha' | 'izquierda' | null; // null = ruta default, sin desvío
}

export function rutaEvitandoObstaculos(origen: Caja, destino: Caja, ctx?: ContextoRuteo): RutaCalculada {
  const base = rutaElbow(origen, destino);
  if (!ctx || !rutaCruzaObstaculos(base, ctx.obstaculos, origen, destino)) {
    if (ctx) {
      // ruta recta de 2 puntos: registra su franja, y si pisa una franja ya
      // ocupada se convierte en U-jog (el corrimiento lo hace separarTramos)
      if (base.length === 2 && base[0].y === base[1].y) {
        const x1 = Math.min(base[0].x, base[1].x);
        const x2 = Math.max(base[0].x, base[1].x);
        const pisa = ctx.tramosH.some((t) => x1 < t.x2 && x2 > t.x1 && Math.abs(base[0].y - t.y) < SEPARACION_CARRIL - 4);
        if (pisa) {
          const dirX = base[1].x >= base[0].x ? 1 : -1;
          const yJog = base[0].y + SEPARACION_CARRIL; // banda inicial; separarTramos la corre lo que haga falta
          const jog: Punto[] = [
            base[0],
            { x: base[0].x + dirX * 24, y: base[0].y },
            { x: base[0].x + dirX * 24, y: yJog },
            { x: base[1].x - dirX * 24, y: yJog },
            { x: base[1].x - dirX * 24, y: base[1].y },
            base[1],
          ];
          separarTramosCompartidos(jog, ctx, origen, destino);
          return { puntos: jog, lado: null };
        }
        ctx.tramosH.push({ y: base[0].y, x1, x2 });
      } else {
        separarTramosCompartidos(base, ctx, origen, destino);
      }
    }
    return { puntos: base, lado: null };
  }

  // construir la ruta candidata por CADA carril y elegir la de menos
  // colisiones (empate → la más corta), en vez de decidir solo por cercanía
  const candidata = (usarDerecha: boolean): Punto[] => {
    const carrilX = usarDerecha
      ? ctx.carrilDerecha + ctx.usosDerecha * SEPARACION_CARRIL
      : ctx.carrilIzquierda - ctx.usosIzquierda * SEPARACION_CARRIL;
    const sx = origen.x + origen.width / 2;
    const ex = destino.x + destino.width / 2;
    const ySalida = empujarBanda(
      origen.y + origen.height + MARGEN_OBSTACULO, sx, carrilX, ctx.obstaculos, origen, destino, 'abajo',
    );
    const yEntrada = empujarBanda(
      destino.y - MARGEN_OBSTACULO, ex, carrilX, ctx.obstaculos, origen, destino, 'arriba',
    );
    return [
      { x: sx, y: origen.y + origen.height },
      { x: sx, y: ySalida },
      { x: carrilX, y: ySalida },
      { x: carrilX, y: yEntrada },
      { x: ex, y: yEntrada },
      { x: ex, y: destino.y },
    ];
  };

  const porDerecha = candidata(true);
  const porIzquierda = candidata(false);
  const colDer = contarColisiones(porDerecha, ctx.obstaculos, origen, destino);
  const colIzq = contarColisiones(porIzquierda, ctx.obstaculos, origen, destino);
  let usarDerecha: boolean;
  if (colDer !== colIzq) usarDerecha = colDer < colIzq;
  else usarDerecha = largoRuta(porDerecha) <= largoRuta(porIzquierda);

  const puntos = usarDerecha ? porDerecha : porIzquierda;
  if (usarDerecha) ctx.usosDerecha++;
  else ctx.usosIzquierda++;

  separarTramosCompartidos(puntos, ctx, origen, destino);
  return { puntos, lado: usarDerecha ? 'derecha' : 'izquierda' };
}

// Punta de flecha en V al final del recorrido. El último tramo siempre es
// axis-aligned, así que hay solo 4 orientaciones posibles.
function pathFlecha(puntos: Punto[], tam = 8): string {
  const fin = puntos[puntos.length - 1];
  const previo = puntos[puntos.length - 2];
  const dx = fin.x - previo.x, dy = fin.y - previo.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    const s = dy >= 0 ? -1 : 1; // llega bajando → alas hacia arriba, y viceversa
    return `M ${fin.x - tam} ${fin.y + s * tam} L ${fin.x} ${fin.y} L ${fin.x + tam} ${fin.y + s * tam}`;
  }
  const s = dx >= 0 ? -1 : 1;
  return `M ${fin.x + s * tam} ${fin.y - tam} L ${fin.x} ${fin.y} L ${fin.x + s * tam} ${fin.y + tam}`;
}

// Badge negro tipo pill para el label de un conector, centrado en (cx, cy).
// Solo reemplaza cómo se muestra el label; la línea/flecha no se toca.
// En Figma Design es una instance de la variante Type=Label del Component Set;
// en FigJam (sin components) es un frame armado a mano con el mismo estilo.
function crearBadgeLabel(label: string, cx: number, cy: number, comps?: ComponentesBase | null): SceneNode {
  if (comps) {
    const instancia = comps.label.createInstance();
    const texto = instancia.findOne((n) => n.type === 'TEXT') as TextNode | null;
    if (texto) texto.characters = label;
    // el HUG recalcula el tamaño con el texto overrideado; leerlo después
    instancia.x = cx - instancia.width / 2;
    instancia.y = cy - instancia.height / 2;
    return instancia;
  }
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

export async function createConnectorLike(origen: SceneNode, destino: SceneNode, label?: string, offPath?: boolean, lang: Idioma = 'en', ruteo?: ContextoRuteo, comps?: ComponentesBase | null): Promise<SceneNode[]> {
  // ruta final (con desvío por carril si la default cruza otros nodos);
  // también posiciona el badge del label en ambos editores
  const ruta = rutaEvitandoObstaculos(origen, destino, ruteo);
  // salto largo (desviado por carril) → verde, para distinguirlo de los pasos secuenciales
  const colorLinea = ruta.lado !== null ? COLOR_SALTO_LARGO : ESTILO_CONECTOR.color;

  if (figma.editorType === 'figjam') {
    const conector = figma.createConnector();
    // el default real NO es elbowed: forzarlo explícito; el redondeo del codo
    // lo pone FigJam (cornerRadius del conector es readonly en la API).
    // La API no tiene waypoints (limitación conocida): para los saltos largos
    // la única influencia es forzar el magnet hacia el lado del carril.
    conector.connectorLineType = 'ELBOWED';
    const magnet = ruta.lado === null ? 'AUTO' : (ruta.lado === 'derecha' ? 'RIGHT' : 'LEFT');
    conector.connectorStart = { endpointNodeId: origen.id, magnet };
    conector.connectorEnd = { endpointNodeId: destino.id, magnet };
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
    // override intencional del default; verde si es salto largo
    conector.strokes = [{ type: 'SOLID', color: colorLinea }];
    if (offPath) {
      conector.dashPattern = [6, 6]; // el punteado es la única señal de edge case
    }
    if (label) {
      const medio = puntoMedioRuta(ruta.puntos);
      const badge = crearBadgeLabel(label, medio.x, medio.y, comps);
      // el badge pasa a ser obstáculo para los conectores siguientes
      if (ruteo) ruteo.obstaculos.push({ x: badge.x, y: badge.y, width: badge.width, height: badge.height });
      return [conector, badge];
    }
    return [conector];
  }

  // Figma Design: trazado en codo con esquinas redondeadas, mismo criterio
  // visual que el elbowed nativo. No es re-enrutable, alcanza para v1.
  const puntos = ruta.puntos;
  const inicio = puntos[0];
  const fin = puntos[puntos.length - 1];
  if (inicio.x === fin.x && inicio.y === fin.y) return [];

  const linea = figma.createVector();
  linea.name = label ? t('canvas.capaFlecha', lang, { label }) : t('canvas.capaFlechaSimple', lang);
  linea.strokes = [{ type: 'SOLID', color: colorLinea }];
  linea.strokeWeight = ESTILO_CONECTOR.strokeWeight;
  if (offPath) linea.dashPattern = [6, 6];
  linea.x = 0;
  linea.y = 0;
  // recorrido y punta de flecha como dos subpaths del mismo vector
  linea.vectorPaths = [
    { windingRule: 'NONE', data: pathElbow(puntos) },
    { windingRule: 'NONE', data: pathFlecha(puntos) },
  ];

  // cap de inicio "Circle Arrow": los caps por extremo solo existen en
  // vectorNetwork (sin curvas), así que se replica la geometría exacta de
  // CIRCLE_FILLED con un punto relleno; la V del final ya es ARROW_LINES
  const punto = figma.createEllipse();
  punto.name = 'inicio';
  punto.resize(8, 8);
  punto.fills = [{ type: 'SOLID', color: colorLinea }];
  punto.x = inicio.x - 4;
  punto.y = inicio.y - 4;

  const creados: SceneNode[] = [linea, punto];
  if (label) {
    const medio = puntoMedioRuta(puntos);
    const badge = crearBadgeLabel(label, medio.x, medio.y, comps);
    // el badge pasa a ser obstáculo para los conectores siguientes
    if (ruteo) ruteo.obstaculos.push({ x: badge.x, y: badge.y, width: badge.width, height: badge.height });
    creados.push(badge);
  }
  return creados;
}

// Concatena las líneas de una card en un solo texto, acumulando los rangos de
// negrita y de código inline (los backticks ya salen removidos).
function construirCuerpo(lineas: LineaCard[], lang: Idioma): {
  cuerpo: string;
  negritas: { inicio: number; fin: number }[];
  codigo: { inicio: number; fin: number }[];
} {
  let cuerpo = '';
  const negritas: { inicio: number; fin: number }[] = [];
  const codigo: { inicio: number; fin: number }[] = [];
  for (const linea of lineas) {
    const rico = construirRico(linea.texto);
    if (rico.malCerrado) {
      console.warn('[markdown-to-flow] ' + t('aviso.negritaSinCerrar', lang, { linea: linea.texto }));
    }
    const prefijo = '    '.repeat(linea.sangria);
    const offset = cuerpo.length + prefijo.length;
    for (const r of rico.negritas) negritas.push({ inicio: offset + r.inicio, fin: offset + r.fin });
    for (const r of rico.codigo) codigo.push({ inicio: offset + r.inicio, fin: offset + r.fin });
    cuerpo += prefijo + rico.texto + '\n';
  }
  cuerpo = cuerpo.length > 0 ? cuerpo.slice(0, -1) : t('canvas.sinContenido', lang);
  return { cuerpo, negritas, codigo };
}

// Card de documentación: frame blanco con header en bold y el contenido por
// bloques — texto (con negritas/código por rangos, y tokens de forma como
// íconos reales cuando hay Component Set) intercalado con tablas reales.
export function createSectionCard(titulo: string, bloques: BloqueCard[], x: number, y: number, lang: Idioma = 'en', comps?: ComponentesBase | null): FrameNode {
  // ancho dinámico: las cards con tablas anchas (ej. la leyenda de 4 columnas)
  // se ensanchan para que ninguna celda/ícono quede recortado
  let maxColumnas = 0;
  for (const b of bloques) {
    if (b.tipo === 'tabla') maxColumnas = Math.max(maxColumnas, b.tabla.headers.length);
  }
  const anchoCard = Math.max(ANCHO_CARD, maxColumnas * 140 + 48);
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
  card.resize(anchoCard, card.height);
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

  const agregarBloqueTexto = (lineas: LineaCard[]) => {
    const { cuerpo, negritas, codigo } = construirCuerpo(lineas, lang);
    const body = figma.createText();
    body.fontName = FUENTE_REGULAR;
    body.fontSize = 13;
    body.lineHeight = { value: 150, unit: 'PERCENT' };
    body.characters = cuerpo;
    body.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
    for (const r of negritas) {
      body.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
    }
    if (FUENTE_MONO) {
      for (const r of codigo) body.setRangeFontName(r.inicio, r.fin, FUENTE_MONO);
    }
    card.appendChild(body);
    body.layoutAlign = 'STRETCH';
    body.textAutoResize = 'HEIGHT';
  };

  // las líneas con token de forma se renderizan como fila con ícono; el resto
  // se agrupa en TextNodes como siempre, preservando el orden
  const agregarTexto = (lineas: LineaCard[]) => {
    if (lineas.length === 0) {
      agregarBloqueTexto([]); // "(sin contenido)"
      return;
    }
    let pendientes: LineaCard[] = [];
    const volcar = () => {
      if (pendientes.length > 0) {
        agregarBloqueTexto(pendientes);
        pendientes = [];
      }
    };
    for (const linea of lineas) {
      const rico = construirRico(linea.texto);
      const token = comps ? rico.texto.match(REGEX_TOKEN_FORMA) : null;
      if (token && token.index !== undefined) {
        volcar();
        card.appendChild(crearFilaConIcono(rico, token, comps!, 13, '    '.repeat(linea.sangria)));
      } else {
        pendientes.push(linea);
      }
    }
    volcar();
  };

  if (bloques.length === 0) {
    agregarBloqueTexto([]); // "(sin contenido)"
  }
  for (const bloque of bloques) {
    if (bloque.tipo === 'texto') {
      agregarTexto(bloque.lineas);
    } else {
      card.appendChild(crearTabla(bloque.tabla, anchoCard - 48, lang, comps));
    }
  }

  card.x = x;
  card.y = y;
  return card;
}

// ---------------------------------------------------------------------------
// Modo Cards: cada rama del hub como tarjeta autocontenida en una grilla,
// sin conectores entre tarjetas. El reingreso se representa como fila final
// con el mini-junction y texto verde (decisión de representación para este
// modo: ningún conector de reingreso cruza el diagrama).
// ---------------------------------------------------------------------------

const CARDS_ANCHO = 300;
const CARDS_POR_FILA = 3;
const CARDS_GAP = 24;

// mini-ícono de forma (18px aprox) para las filas de las tarjetas — frames
// simples, funcionan igual en los dos editores (sin depender de instances)
function crearMiniForma(forma: Forma): SceneNode {
  const estilo = ESTILOS_DEFAULT[forma];
  if (forma === 'inicioFin' || forma === 'conector') {
    const circulo = figma.createEllipse();
    circulo.resize(16, 16);
    circulo.fills = [{ type: 'SOLID', color: estilo.fill }];
    circulo.strokes = [{ type: 'SOLID', color: estilo.stroke }];
    circulo.strokeWeight = 1.5;
    return circulo;
  }
  if (forma === 'decision') {
    const rombo = figma.createRectangle();
    rombo.resize(12, 12);
    rombo.rotation = 45;
    rombo.fills = [{ type: 'SOLID', color: estilo.fill }];
    rombo.strokes = [{ type: 'SOLID', color: estilo.stroke }];
    rombo.strokeWeight = 1.5;
    return rombo;
  }
  const rect = figma.createRectangle();
  rect.resize(18, 13);
  rect.cornerRadius = 2;
  rect.fills = [{ type: 'SOLID', color: estilo.fill }];
  rect.strokes = [{ type: 'SOLID', color: estilo.stroke }];
  rect.strokeWeight = 1.5;
  return rect;
}

function crearCardRama(rama: RamaCard): FrameNode {
  const card = figma.createFrame();
  card.name = rama.titulo;
  card.layoutMode = 'VERTICAL';
  card.counterAxisSizingMode = 'FIXED';
  card.primaryAxisSizingMode = 'AUTO';
  card.resize(CARDS_ANCHO, card.height);
  card.fills = [{ type: 'SOLID', color: { r: 0.99, g: 0.99, b: 0.99 } }];
  card.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
  card.strokeWeight = 1;
  card.cornerRadius = 8;

  // header: el trigger/condición del caso
  const header = figma.createFrame();
  header.layoutMode = 'VERTICAL';
  header.counterAxisSizingMode = 'FIXED';
  header.primaryAxisSizingMode = 'AUTO';
  header.paddingTop = header.paddingBottom = 10;
  header.paddingLeft = header.paddingRight = 14;
  header.fills = [{ type: 'SOLID', color: { r: 0.996, g: 0.976, b: 0.765 } }];
  const titulo = figma.createText();
  titulo.fontName = FUENTE_BOLD;
  titulo.fontSize = 12;
  titulo.characters = rama.titulo;
  titulo.fills = [{ type: 'SOLID', color: { r: 0.44, g: 0.25, b: 0.07 } }];
  header.appendChild(titulo);
  titulo.layoutAlign = 'STRETCH';
  titulo.textAutoResize = 'HEIGHT';
  card.appendChild(header);
  header.layoutAlign = 'STRETCH';

  // cuerpo: una fila por paso/decisión/reingreso
  const cuerpo = figma.createFrame();
  cuerpo.layoutMode = 'VERTICAL';
  cuerpo.counterAxisSizingMode = 'FIXED';
  cuerpo.primaryAxisSizingMode = 'AUTO';
  cuerpo.paddingTop = cuerpo.paddingBottom = 12;
  cuerpo.paddingLeft = cuerpo.paddingRight = 14;
  cuerpo.itemSpacing = 8;
  cuerpo.fills = [];
  for (const f of rama.filas) {
    const fila = figma.createFrame();
    fila.layoutMode = 'HORIZONTAL';
    fila.counterAxisSizingMode = 'AUTO';
    fila.primaryAxisSizingMode = 'FIXED';
    fila.resize(CARDS_ANCHO - 28, fila.height);
    fila.counterAxisAlignItems = 'CENTER';
    fila.itemSpacing = 8;
    fila.fills = [];
    fila.appendChild(crearMiniForma(f.forma));

    const texto = figma.createText();
    const prefijo = f.label ? `${f.label} → ` : '';
    if (f.tipo === 'reingreso') {
      texto.fontName = FUENTE_BOLD;
      texto.characters = `${prefijo}→ ${f.texto}`;
      texto.fills = [{ type: 'SOLID', color: COLOR_SALTO_LARGO }];
    } else {
      texto.fontName = FUENTE_REGULAR;
      texto.characters = prefijo + f.texto;
      texto.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
      if (prefijo) texto.setRangeFontName(0, f.label!.length, FUENTE_BOLD);
    }
    texto.fontSize = 11;
    fila.appendChild(texto);
    texto.layoutGrow = 1;
    texto.textAutoResize = 'HEIGHT';
    cuerpo.appendChild(fila);
    fila.layoutAlign = 'STRETCH';
  }
  card.appendChild(cuerpo);
  cuerpo.layoutAlign = 'STRETCH';
  return card;
}

// Genera el flujo completo en modo Cards: encabezado con el preámbulo
// (raíz → hub) y la grilla de tarjetas, todo en coordenadas locales.
export function crearCardsFlujo(desc: DescomposicionCards): SceneNode[] {
  const nodos: SceneNode[] = [];

  const encabezado = figma.createText();
  encabezado.fontName = FUENTE;
  encabezado.fontSize = 14;
  encabezado.characters = desc.preambulo.map((n) => n.texto.replace(/\n/g, ' ')).join('  →  ');
  encabezado.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
  encabezado.x = 0;
  encabezado.y = 0;
  nodos.push(encabezado);

  const cards = desc.ramas.map((rama) => crearCardRama(rama));
  let y = encabezado.height + 32;
  for (let i = 0; i < cards.length; i += CARDS_POR_FILA) {
    const fila = cards.slice(i, i + CARDS_POR_FILA);
    fila.forEach((card, j) => {
      card.x = j * (CARDS_ANCHO + CARDS_GAP);
      card.y = y;
    });
    let maxAlto = 0;
    for (const card of fila) maxAlto = Math.max(maxAlto, card.height);
    y += maxAlto + CARDS_GAP;
  }
  for (const card of cards) nodos.push(card);
  return nodos;
}

// ---------------------------------------------------------------------------
// Modo Swimlanes: carriles por punto de reingreso, con el mini-flujo Classic
// de cada rama adentro. Los carriles son fondos planos (rect + header como
// hermanos de los nodos, no frames contenedores): así los conectores nativos
// no sufren reparenting. Configurable desde el panel: representación del
// reingreso (junction local o badge de texto) y orientación de los carriles.
// ---------------------------------------------------------------------------

export interface OpcionesSwimlanes {
  reingreso: 'junction' | 'badge';
  orientacion: 'horizontal' | 'vertical';
}

const LANE_ESCALA_X = 0.8;          // compacta el espaciado del mini-flujo
const LANE_ESPACIADO_Y = 170;
const LANE_PADDING = 24;
const LANE_GAP = 32;
const LANE_GAP_RAMAS = 48;

// Mini-flujo Classic de una rama: subgrafo real (nodos + edges propios) con
// el layout existente en espaciado compacto. Devuelve los nodos creados y su
// bounding box local.
async function crearMiniFlujo(
  grafo: Grafo,
  ids: string[],
  offsetX: number,
  offsetY: number,
  estilos: Map<string, EstiloNodo>,
  lang: Idioma,
  comps: ComponentesBase | null,
  incluirJunctions: boolean,
): Promise<{ nodos: SceneNode[]; ancho: number; alto: number }> {
  const idsUsados = new Set(incluirJunctions ? ids : ids.filter((id) => grafo.nodos.get(id)!.forma !== 'conector'));
  const subGrafo: Grafo = {
    direccion: 'TD',
    nodos: new Map(Array.from(grafo.nodos).filter(([id]) => idsUsados.has(id))),
    edges: grafo.edges.filter((e) => idsUsados.has(e.origen) && idsUsados.has(e.destino)),
    classDefs: grafo.classDefs,
    warnings: [],
  };
  const posiciones = calcularLayout(subGrafo);

  // primero las instances (con centros escalados), después se normaliza el
  // bloque al offset pedido ANTES de trazar los conectores
  const creados = new Map<string, SceneNode>();
  const nodos: SceneNode[] = [];
  for (const [id, p] of posiciones) {
    const nodo = subGrafo.nodos.get(id)!;
    const estilo = estilos.get(id) || ESTILOS_DEFAULT[nodo.forma];
    const instancia = createDiagramNodeInstance(
      nodo.forma, nodo.texto, estilo,
      p.x * LANE_ESCALA_X,
      p.y * (LANE_ESPACIADO_Y / 300),
      comps,
    );
    creados.set(id, instancia);
    nodos.push(instancia);
  }
  let minX = Infinity, minY = Infinity;
  for (const n of nodos) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
  }
  for (const n of nodos) {
    n.x += offsetX - minX;
    n.y += offsetY - minY;
  }
  for (const e of subGrafo.edges) {
    const a = creados.get(e.origen);
    const b = creados.get(e.destino);
    if (!a || !b) continue;
    const conector = await createConnectorLike(a, b, e.label, false, lang, undefined, comps);
    for (const c of conector) nodos.push(c);
  }

  let maxX = 0, maxY = 0;
  for (const n of nodos) {
    if (n.type === 'CONNECTOR') continue;
    maxX = Math.max(maxX, n.x + n.width - offsetX);
    maxY = Math.max(maxY, n.y + n.height - offsetY);
  }
  return { nodos, ancho: maxX, alto: maxY };
}

// Genera el flujo completo en modo Swimlanes, en coordenadas locales.
export async function crearSwimlanesFlujo(
  grafo: Grafo,
  desc: DescomposicionCards,
  carriles: Carril[],
  estilos: Map<string, EstiloNodo>,
  opciones: OpcionesSwimlanes,
  lang: Idioma,
  comps: ComponentesBase | null,
): Promise<SceneNode[]> {
  const nodos: SceneNode[] = [];

  const encabezado = figma.createText();
  encabezado.fontName = FUENTE;
  encabezado.fontSize = 14;
  encabezado.characters = desc.preambulo.map((n) => n.texto.replace(/\n/g, ' ')).join('  →  ');
  encabezado.fills = pinturaTextoNodo(NEGRO);
  encabezado.x = 0;
  encabezado.y = 0;
  nodos.push(encabezado);

  const horizontal = opciones.orientacion === 'horizontal';
  let cursor = encabezado.height + 32; // Y en horizontal, X en vertical

  for (const carril of carriles) {
    const laneX = horizontal ? 0 : cursor;
    const laneY = horizontal ? cursor : encabezado.height + 32;

    const header = figma.createText();
    header.fontName = FUENTE_BOLD;
    header.fontSize = 14;
    header.characters = carril.clave !== null ? `→ ${carril.clave}` : t('canvas.laneSinReingreso', lang);
    header.fills = [{ type: 'SOLID', color: COLOR_SALTO_LARGO }];
    header.x = laneX + LANE_PADDING;
    header.y = laneY + 14;

    const hijosCarril: SceneNode[] = [header];
    let x = laneX + LANE_PADDING;
    const contenidoY = laneY + 14 + header.height + 16;
    let maxAlto = 0;

    for (const rama of carril.ramas) {
      const tituloRama = figma.createText();
      tituloRama.fontName = FUENTE_BOLD;
      tituloRama.fontSize = 11;
      tituloRama.characters = rama.titulo;
      tituloRama.fills = pinturaTextoNodo(NEGRO);
      tituloRama.x = x;
      tituloRama.y = contenidoY;
      hijosCarril.push(tituloRama);

      const mini = await crearMiniFlujo(
        grafo, rama.ids, x, contenidoY + tituloRama.height + 12,
        estilos, lang, comps, opciones.reingreso === 'junction',
      );
      for (const n of mini.nodos) hijosCarril.push(n);
      let altoRama = tituloRama.height + 12 + mini.alto;

      // reingreso como badge de texto (cuando los junctions quedan fuera)
      if (opciones.reingreso === 'badge') {
        const reingresos = rama.filas.filter((f) => f.tipo === 'reingreso');
        if (reingresos.length > 0) {
          const badge = figma.createText();
          badge.fontName = FUENTE_BOLD;
          badge.fontSize = 11;
          badge.characters = reingresos.map((f) => `${f.label ? f.label + ': ' : ''}→ ${f.texto}`).join('\n');
          badge.fills = [{ type: 'SOLID', color: COLOR_SALTO_LARGO }];
          badge.x = x;
          badge.y = contenidoY + tituloRama.height + 12 + mini.alto + 10;
          hijosCarril.push(badge);
          altoRama += 10 + badge.height;
        }
      }

      x += Math.max(mini.ancho, tituloRama.width) + LANE_GAP_RAMAS;
      maxAlto = Math.max(maxAlto, altoRama);
    }

    // fondo del carril, medido sobre el contenido real; va PRIMERO en la
    // lista para quedar detrás de los nodos
    const fondo = figma.createRectangle();
    fondo.name = header.characters;
    fondo.cornerRadius = 8;
    fondo.fills = [{ type: 'SOLID', color: { r: 0.984, g: 0.984, b: 0.99 } }];
    fondo.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
    fondo.strokeWeight = 1;
    const anchoLane = x - laneX - LANE_GAP_RAMAS + LANE_PADDING;
    const altoLane = contenidoY - laneY + maxAlto + LANE_PADDING;
    fondo.resize(Math.max(anchoLane, header.width + LANE_PADDING * 2), altoLane);
    fondo.x = laneX;
    fondo.y = laneY;

    nodos.push(fondo);
    for (const h of hijosCarril) nodos.push(h);

    cursor += (horizontal ? altoLane : fondo.width) + LANE_GAP;
  }
  return nodos;
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

// Anotación al costado de un nodo conector: "CO → descripción de la leyenda".
// En Figma Design es una instance de la variante Type=Annotation del set;
// en FigJam (sin components) se simula con un frame equivalente.
export function crearAnotacionConector(texto: string, x: number, y: number, comps?: ComponentesBase | null): SceneNode {
  if (comps) {
    const instancia = comps.annotation.createInstance();
    const contenido = instancia.findOne((n) => n.type === 'TEXT') as TextNode | null;
    if (contenido) contenido.characters = texto;
    instancia.x = x;
    instancia.y = y;
    return instancia;
  }
  return crearAnotacionFrame(texto, x, y);
}

function crearAnotacionFrame(texto: string, x: number, y: number): FrameNode {
  const nota = figma.createFrame();
  nota.name = texto;
  nota.layoutMode = 'HORIZONTAL';
  nota.primaryAxisSizingMode = 'AUTO';
  nota.counterAxisSizingMode = 'AUTO';
  nota.fills = [{ type: 'SOLID', color: { r: 1, g: 241 / 255, b: 194 / 255 } }]; // #FFF1C2
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
  contenido.fills = pinturaTextoNodo(NEGRO);
  nota.appendChild(contenido);

  nota.x = x;
  nota.y = y;
  return nota;
}

// ---------------------------------------------------------------------------
// Tokens de notación mermaid en textos de leyenda (`([ ])`, `[ ]`, `{ }`,
// `((CO))`) → ícono real: instance chica (24px de alto) de la variante
// correspondiente del Component Set. Solo Figma Design (FigJam no tiene
// instances: ahí el token queda como texto).
// ---------------------------------------------------------------------------

const REGEX_TOKEN_FORMA = /(\(\(\s*[A-Za-z0-9]*\s*\)\)|\(\[\s*\]\)|\[\s*\]|\{\s*\})/;

function formaDeToken(token: string): Forma {
  if (token.indexOf('((') === 0) return 'conector';
  if (token.indexOf('([') === 0) return 'inicioFin';
  if (token.indexOf('{') === 0) return 'decision';
  return 'proceso';
}

// texto interno de un token de conector: "((CO))" → "CO"
function inicialesDeToken(token: string): string {
  const m = token.match(/^\(\(\s*([A-Za-z0-9]+)\s*\)\)$/);
  return m ? m[1] : '';
}

function crearIconoForma(
  forma: Forma,
  comps: ComponentesBase,
  opciones?: { texto?: string; fill?: Color; stroke?: Color },
): InstanceNode {
  const icono = comps.variantes[forma].createInstance();
  const textoNodo = icono.findOne((n) => n.type === 'TEXT') as TextNode | null;
  // con texto (ej. las iniciales "CO") queda visible y escala con el rescale;
  // sin texto se vacía el placeholder para que sea un ícono puro
  if (textoNodo) textoNodo.characters = opciones && opciones.texto ? opciones.texto : '';
  if (opciones && (opciones.fill || opciones.stroke)) {
    const geometrias = icono.findAll((n) => n.type === 'ELLIPSE' || n.type === 'RECTANGLE' || n.type === 'VECTOR') as Geometria[];
    geometrias.forEach((g, i) => {
      if (opciones.stroke) g.strokes = [{ type: 'SOLID', color: opciones.stroke }];
      if (i === 0 && opciones.fill) g.fills = [{ type: 'SOLID', color: opciones.fill }];
    });
  }
  icono.rescale(24 / icono.height);
  return icono;
}

// Paleta de la leyenda (la misma del archivo de referencia).
const COLORES_LEYENDA = {
  verde: { fill: { r: 0.863, g: 0.988, b: 0.906 }, stroke: { r: 0.086, g: 0.643, b: 0.29 } },
  azul: { fill: { r: 0.859, g: 0.918, b: 0.996 }, stroke: { r: 0.008, g: 0.533, b: 0.82 } },
  ambar: { fill: { r: 0.996, g: 0.976, b: 0.765 }, stroke: { r: 0.792, g: 0.541, b: 0.016 } },
  rojo: { fill: { r: 0.996, g: 0.886, b: 0.886 }, stroke: { r: 0.863, g: 0.149, b: 0.149 } },
};

const normalizarTexto = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Mapeo directo de la tabla de leyenda (caso conocido): cada fila recibe su
// ícono según la columna "Elemento", tenga o no el token en el texto.
function iconoDeElemento(elemento: string): { forma: Forma; fill?: Color; stroke?: Color } | null {
  const e = normalizarTexto(elemento);
  if (e.indexOf('inicio') !== -1 || e.indexOf('fin') !== -1) return { forma: 'inicioFin', ...COLORES_LEYENDA.verde };
  if (e.indexOf('accion') !== -1 || e.indexOf('pantalla') !== -1) return { forma: 'proceso', ...COLORES_LEYENDA.azul };
  if (e.indexOf('decision') !== -1) return { forma: 'decision', ...COLORES_LEYENDA.ambar };
  if (e.indexOf('exito') !== -1) return { forma: 'proceso', ...COLORES_LEYENDA.verde };
  if (e.indexOf('error') !== -1 || e.indexOf('fallo') !== -1) return { forma: 'proceso', ...COLORES_LEYENDA.rojo };
  if (e.indexOf('reingreso') !== -1) return { forma: 'conector' }; // gris default del junction
  return null;
}

// TextNode con rangos de negrita/código ya calculados (para las partes
// antes/después de un ícono).
function textoConFormatos(
  contenido: string,
  negritas: { inicio: number; fin: number }[],
  codigo: { inicio: number; fin: number }[],
  fontSize: number,
): TextNode {
  const nodo = figma.createText();
  nodo.fontName = FUENTE_REGULAR;
  nodo.fontSize = fontSize;
  nodo.characters = contenido;
  nodo.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
  for (const r of negritas) nodo.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
  if (FUENTE_MONO) {
    for (const r of codigo) nodo.setRangeFontName(r.inicio, r.fin, FUENTE_MONO);
  }
  return nodo;
}

// Fila en autolayout horizontal: texto antes + ícono de 24px + texto después.
function crearFilaConIcono(
  rico: { texto: string; negritas: { inicio: number; fin: number }[]; codigo: { inicio: number; fin: number }[] },
  match: RegExpMatchArray,
  comps: ComponentesBase,
  fontSize: number,
  prefijo: string,
): FrameNode {
  const desde = match.index!;
  const hasta = desde + match[0].length;
  const recortar = (rangos: { inicio: number; fin: number }[], ini: number, fin: number, offset: number) =>
    rangos
      .filter((r) => r.fin > ini && r.inicio < fin)
      .map((r) => ({ inicio: Math.max(r.inicio, ini) - ini + offset, fin: Math.min(r.fin, fin) - ini + offset }));

  const fila = figma.createFrame();
  fila.name = rico.texto;
  fila.layoutMode = 'HORIZONTAL';
  fila.primaryAxisSizingMode = 'AUTO';
  fila.counterAxisSizingMode = 'AUTO';
  fila.counterAxisAlignItems = 'CENTER';
  fila.itemSpacing = 6;
  fila.fills = [];

  const antes = prefijo + rico.texto.slice(0, desde);
  if (antes.trim().length > 0) {
    fila.appendChild(textoConFormatos(antes, recortar(rico.negritas, 0, desde, prefijo.length), recortar(rico.codigo, 0, desde, prefijo.length), fontSize));
  }
  fila.appendChild(crearIconoForma(formaDeToken(match[0]), comps, { texto: inicialesDeToken(match[0]) }));
  const despues = rico.texto.slice(hasta);
  if (despues.trim().length > 0) {
    fila.appendChild(textoConFormatos(despues, recortar(rico.negritas, hasta, rico.texto.length, 0), recortar(rico.codigo, hasta, rico.texto.length, 0), fontSize));
  }
  return fila;
}

// Tabla dentro de una card: nativa en FigJam (createTable + cellAt), simulada
// con frames en Figma Design. Devuelve el nodo listo para appendChild.
function crearTabla(tabla: TablaCard, anchoDisponible: number, lang: Idioma, comps?: ComponentesBase | null): SceneNode {
  if (figma.editorType === 'figjam') {
    try {
      const nativa = figma.createTable(tabla.filas.length + 1, tabla.headers.length);
      // fijar SIEMPRE una fuente ya cargada antes de setear characters: la
      // fuente default de la celda puede no estar cargada y setear texto con
      // fuente sin cargar produce glifos corruptos (tildes, ñ, →)
      tabla.headers.forEach((h, c) => {
        const celda = nativa.cellAt(0, c);
        const plano = construirNegritas(h).texto;
        celda.text.fontName = FUENTE_BOLD;
        celda.text.characters = plano;
        celda.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.95 } }];
      });
      tabla.filas.forEach((fila, f) => {
        fila.forEach((valor, c) => {
          const rico = construirRico(valor);
          const celda = nativa.cellAt(f + 1, c);
          celda.text.fontName = FUENTE_REGULAR;
          celda.text.characters = rico.texto;
          for (const r of rico.negritas) celda.text.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
          if (FUENTE_MONO) {
            for (const r of rico.codigo) celda.text.setRangeFontName(r.inicio, r.fin, FUENTE_MONO);
          }
        });
      });
      return nativa;
    } catch (e) {
      console.warn('[markdown-to-flow] createTable falló; se usa la tabla simulada: ' + String(e));
    }
  }

  // simulada: frame vertical de filas; celdas de ancho fijo para que las
  // columnas queden alineadas. En la leyenda, la columna "Forma" es más ancha
  // para que el ícono (texto + 24px) nunca quede recortado.
  const anchoColumnaForma = 200;
  const anchoCeldaDe = (col: number): number => {
    if (esLeyenda && tabla.headers.length > 1) {
      return col === 1
        ? anchoColumnaForma
        : Math.floor((anchoDisponible - anchoColumnaForma) / (tabla.headers.length - 1));
    }
    return Math.floor(anchoDisponible / tabla.headers.length);
  };
  const contenedor = figma.createFrame();
  contenedor.name = 'tabla';
  contenedor.layoutMode = 'VERTICAL';
  contenedor.primaryAxisSizingMode = 'AUTO';
  contenedor.counterAxisSizingMode = 'AUTO';
  contenedor.fills = [];

  // tabla de leyenda (caso conocido): headers "Elemento" + "Forma" → la celda
  // de Forma lleva SIEMPRE su ícono mapeado por el texto de Elemento
  const esLeyenda = comps
    && tabla.headers.length >= 2
    && normalizarTexto(tabla.headers[0]).indexOf('elemento') !== -1
    && normalizarTexto(tabla.headers[1]).indexOf('forma') !== -1;

  const crearFila = (valores: string[], esHeader: boolean) => {
    const fila = figma.createFrame();
    fila.layoutMode = 'HORIZONTAL';
    fila.primaryAxisSizingMode = 'AUTO';
    fila.counterAxisSizingMode = 'AUTO';
    fila.fills = esHeader ? [{ type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.95 } }] : [];
    fila.strokes = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.87 } }];
    fila.strokeBottomWeight = 1;
    valores.forEach((valor, col) => {
      const celda = figma.createFrame();
      celda.layoutMode = 'VERTICAL';
      celda.primaryAxisSizingMode = 'AUTO';
      celda.counterAxisSizingMode = 'FIXED';
      celda.resize(anchoCeldaDe(col), celda.height);
      celda.paddingTop = celda.paddingBottom = 6;
      celda.paddingLeft = celda.paddingRight = 8;
      celda.fills = [];

      // fila de leyenda: ícono sí o sí en la columna "Forma", con su color
      const spec = esLeyenda && !esHeader && col === 1 ? iconoDeElemento(valores[0]) : null;
      if (spec) {
        const textoSinToken = construirRico(valor.replace(REGEX_TOKEN_FORMA, '').trim());
        const filaIcono = figma.createFrame();
        filaIcono.layoutMode = 'HORIZONTAL';
        filaIcono.primaryAxisSizingMode = 'AUTO';
        filaIcono.counterAxisSizingMode = 'AUTO';
        filaIcono.counterAxisAlignItems = 'CENTER';
        filaIcono.itemSpacing = 6;
        filaIcono.fills = [];
        if (textoSinToken.texto.trim().length > 0) {
          filaIcono.appendChild(textoConFormatos(textoSinToken.texto, textoSinToken.negritas, textoSinToken.codigo, 12));
        }
        filaIcono.appendChild(crearIconoForma(spec.forma, comps!, { fill: spec.fill, stroke: spec.stroke }));
        celda.appendChild(filaIcono);
        fila.appendChild(celda);
        return;
      }

      const rico = construirRico(valor);
      const token = !esHeader && comps ? rico.texto.match(REGEX_TOKEN_FORMA) : null;
      if (token && token.index !== undefined) {
        // celda con token de forma → texto + ícono real en fila horizontal
        celda.appendChild(crearFilaConIcono(rico, token, comps!, 12, ''));
      } else {
        const texto = figma.createText();
        texto.fontName = esHeader ? FUENTE_BOLD : FUENTE_REGULAR;
        texto.fontSize = 12;
        texto.characters = rico.texto;
        if (!esHeader) {
          for (const r of rico.negritas) texto.setRangeFontName(r.inicio, r.fin, FUENTE_BOLD);
          if (FUENTE_MONO) {
            for (const r of rico.codigo) texto.setRangeFontName(r.inicio, r.fin, FUENTE_MONO);
          }
        }
        texto.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.22 } }];
        celda.appendChild(texto);
        texto.layoutAlign = 'STRETCH';
        texto.textAutoResize = 'HEIGHT';
      }
      fila.appendChild(celda);
    });
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
