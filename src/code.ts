// Main thread del plugin: orquestación y mensajería con la UI.
// Settings persistidos en clientStorage: generarDocs, separarEdgeCases,
// direccionFlujo (vertical/horizontal, prioridad sobre la del mermaid),
// repetirFlow (card de resumen repetida al inicio de cada flujo) e idioma.
//
// Posicionamiento en DOS pasadas: cada Section se genera con su contenido en
// coordenadas locales, y recién con los tamaños reales medidos se apilan los
// flujos en columna (200px entre bordes) con Documentation a la izquierda.
// "🧩 Base components" vive como Section anidada dentro de Documentation.

import { parsearFlowchart, Grafo } from './parseMermaid.ts';
import { calcularLayout, posicionarOffPath, esOffPath, esFlujoDenso, descomponerEnRamas, agruparEnCarriles, descomposicionATabla, Direccion } from './layoutDiagram.ts';
import { analizarDocumento, esResumenFlow, TipoSeccion, SeccionDetectada } from './parseMarkdown.ts';
import { t } from './i18n.ts';
import type { Idioma } from './i18n.ts';
import {
  FUENTE,
  FUENTE_REGULAR,
  FUENTE_BOLD,
  ComponentesBase,
  resolverEstilo,
  createShapeComponents,
  createDiagramNodeInstance,
  createConnectorLike,
  createSectionCard,
  crearTituloFlujo,
  crearAnotacionConector,
  crearContextoRuteo,
  crearCardsFlujo,
  crearSwimlanesFlujo,
  crearTablaFlujo,
  crearSubflujosClassic,
  crearSection,
  cargarFuenteMono,
} from './renderFigma.ts';
import type { EstiloNodo, OpcionesSwimlanes } from './renderFigma.ts';

const CLAVE_DOCS = 'generarDocs';
const CLAVE_EDGE_CASES = 'separarEdgeCases';
const CLAVE_IDIOMA = 'idioma';
const CLAVE_DIRECCION = 'direccionFlujo';
const CLAVE_REPETIR_FLOW = 'repetirFlow';
const CLAVE_LAYOUT = 'layoutStyle';
const CLAVE_SOLO_DENSOS = 'layoutSoloDensos';
const CLAVE_LANE_REINGRESO = 'laneReingreso';
const CLAVE_LANE_AGRUPACION = 'laneAgrupacion';
const CLAVE_LANE_ORIENTACION = 'laneOrientacion';
const SEPARACION_CARDS = 40;
const MARGEN_CARD_FLOW = 40;   // entre título/card repetida y el primer nodo
const ESCALA_CARD_FLOW = 0.7;  // la copia repetida es más chica que la original
const MARGEN_SECCIONES = 200;  // entre bordes REALES de las Sections de nivel superior

// headers canónicos traducibles; las cards de tipo titulo/flow/generica
// conservan el heading original del archivo (contenido del usuario)
const HEADERS_CONOCIDOS: Partial<Record<TipoSeccion, string>> = {
  steps: 'canvas.cardSteps',
  decision: 'canvas.cardDecision',
  edgeCases: 'canvas.cardEdgeCases',
  assumptions: 'canvas.cardAssumptions',
};

// 600 de ancho por el anatomy de UI3; el título va en la barra NATIVA de la
// ventana del plugin (la UI no dibuja header propio)
figma.showUI(__html__, { width: 600, height: 560, title: 'Markdown to Flow' });

// Al abrir el plugin, mandar a la UI el estado persistido de los settings.
Promise.all([
  figma.clientStorage.getAsync(CLAVE_DOCS),
  figma.clientStorage.getAsync(CLAVE_EDGE_CASES),
  figma.clientStorage.getAsync(CLAVE_IDIOMA),
  figma.clientStorage.getAsync(CLAVE_DIRECCION),
  figma.clientStorage.getAsync(CLAVE_REPETIR_FLOW),
  figma.clientStorage.getAsync(CLAVE_LAYOUT),
  figma.clientStorage.getAsync(CLAVE_SOLO_DENSOS),
  figma.clientStorage.getAsync(CLAVE_LANE_REINGRESO),
  figma.clientStorage.getAsync(CLAVE_LANE_AGRUPACION),
  figma.clientStorage.getAsync(CLAVE_LANE_ORIENTACION),
]).then(([docs, edgeCases, idioma, direccion, repetir, layout, soloDensos, laneRe, laneAgr, laneOri]) => {
  figma.ui.postMessage({
    type: 'estado-inicial',
    generarDocs: docs === undefined ? true : docs === true,        // default: activado
    separarEdgeCases: edgeCases === true,                           // default: desactivado
    lang: idioma === 'es' ? 'es' : 'en',                            // default: inglés
    direccion: direccion === 'horizontal' ? 'horizontal' : 'vertical', // default: vertical
    repetirFlow: repetir === true,                                  // default: desactivado
    layoutStyle: layout === 'cards' || layout === 'swimlanes' || layout === 'table' ? layout : 'classic', // default: classic
    soloDensos: soloDensos === undefined ? true : soloDensos === true, // default: activado
    laneReingreso: laneRe === 'badge' ? 'badge' : 'junction',           // default: junction local
    laneAgrupacion: laneAgr === 'duplicar' ? 'duplicar' : 'primero',    // default: primer reingreso
    laneOrientacion: laneOri === 'vertical' ? 'vertical' : 'horizontal', // default: horizontal
  });
});

interface Opciones {
  generarDocs: boolean;
  separarEdgeCases: boolean;
  direccion: Direccion;
  repetirFlow: boolean;
  layoutStyle: 'classic' | 'cards' | 'swimlanes' | 'table';
  soloDensos: boolean;
  laneReingreso: 'junction' | 'badge';
  laneAgrupacion: 'primero' | 'duplicar';
  laneOrientacion: 'horizontal' | 'vertical';
  lang: Idioma;
  nombreArchivo?: string;
}

interface DiagramaListo {
  grafo: Grafo;
  flujoLabel: string;
  offPath: Set<string>;
  posiciones: Map<string, { x: number; y: number }>;
  posicionesOffPath: Map<string, { x: number; y: number }>;
}

async function generar(markdown: string, o: Opciones): Promise<{ resumen: string; warnings: string[] }> {
  const nombreFallback = o.nombreArchivo ? o.nombreArchivo.replace(/\.[^.]+$/, '') : undefined;
  const doc = analizarDocumento(markdown, nombreFallback, o.lang);
  const avisos = doc.avisos.slice();

  // Parsear y calcular el layout de TODOS los diagramas detectados. Sin
  // ninguno (o sin nodos reconocibles) se genera solo la documentación.
  const diagramas: DiagramaListo[] = [];
  for (const d of doc.diagramas) {
    const grafo = parsearFlowchart(d.codigo, o.lang);
    for (const w of grafo.warnings) avisos.push(w);
    if (grafo.nodos.size === 0) {
      avisos.push(t('aviso.diagramaSinNodos', o.lang));
      continue;
    }
    // la dirección del mermaid se parsea pero manda el setting del panel
    console.log(`[markdown-to-flow] dirección del mermaid: ${grafo.direccion}; se usa el setting del panel: ${o.direccion}`);
    const offPath = new Set<string>();
    if (o.separarEdgeCases) {
      for (const nodo of grafo.nodos.values()) {
        if (esOffPath(nodo)) offPath.add(nodo.id);
      }
    }
    const posiciones = calcularLayout(grafo, offPath.size > 0 ? offPath : undefined, o.direccion);
    const posicionesOffPath = offPath.size > 0
      ? posicionarOffPath(grafo, offPath, posiciones, o.direccion)
      : new Map<string, { x: number; y: number }>();
    diagramas.push({ grafo, flujoLabel: d.flujo.label, offPath, posiciones, posicionesOffPath });
  }

  // Todas las fuentes una sola vez, antes de crear cualquier texto (la mono
  // para código inline es best-effort: sin ella solo se quitan los backticks).
  await Promise.all([
    figma.loadFontAsync(FUENTE),
    figma.loadFontAsync(FUENTE_REGULAR),
    figma.loadFontAsync(FUENTE_BOLD),
    cargarFuenteMono(),
  ]);

  const centro = figma.viewport.center;
  const partesResumen: string[] = [];

  // sección de resumen para la card repetida (solo con docs activo): la
  // sección "Flow" clásica, o el título con metadatos "**Clave:** valor"
  // como texto corrido bajo el H1
  let seccionFlow: SeccionDetectada | null = null;
  if (o.generarDocs) {
    for (const s of doc.secciones) {
      if (s.tipo === 'flow') { seccionFlow = s; break; }
    }
    if (!seccionFlow) {
      for (const s of doc.secciones) {
        if (s.tipo === 'titulo' && esResumenFlow(s)) { seccionFlow = s; break; }
      }
    }
  }
  // copia liviana de la card de Flow, pegada arriba del ancla que le pasen
  const crearCardFlowRepetida = (ancla: SceneNode): SceneNode => {
    const card = createSectionCard(seccionFlow!.titulo, seccionFlow!.bloques, 0, 0, o.lang, comps);
    card.rescale(ESCALA_CARD_FLOW);
    card.x = ancla.x;
    card.y = ancla.y - card.height - MARGEN_CARD_FLOW;
    return card;
  };

  // Component Set una sola vez (solo Figma Design; en FigJam los nodos son
  // ShapeWithText). Se crea en coordenadas provisorias: al final se anida
  // como Section "🧩 Base components" dentro de Documentation.
  let comps: ComponentesBase | null = null;
  if (figma.editorType === 'figma' && diagramas.length > 0) {
    comps = createShapeComponents(0, 0);
  }

  // --- PASADA 1: generar cada flujo en coordenadas locales y cerrarlo en su Section ---
  const seccionesFlujo: SectionNode[] = [];
  let totalNodos = 0;
  let totalEdgeCases = 0;
  let avisoCardsEdge = false;

  for (const d of diagramas) {
    const { grafo, offPath, posiciones, posicionesOffPath } = d;
    const sufijo = diagramas.length > 1 ? ' — ' + d.flujoLabel : '';

    // Modos que descomponen el flujo por ramas del hub. Los simplificados
    // (Cards/Swimlanes/Table) respetan el toggle "solo densos"; Classic
    // descompone SIEMPRE solo los densos (los simples quedan como diagrama
    // único, que es lo correcto para ellos).
    const descomponer = o.layoutStyle === 'classic'
      ? esFlujoDenso(grafo)
      : (!o.soloDensos || esFlujoDenso(grafo));
    if (descomponer) {
      const descomposicion = descomponerEnRamas(grafo);
      if (descomposicion) {
        const construirEstilos = () => {
          const estilos = new Map<string, EstiloNodo>();
          const avisosEstilo = new Set<string>();
          for (const nodo of grafo.nodos.values()) {
            const { estilo, aviso } = resolverEstilo(nodo, grafo.classDefs, o.lang);
            estilos.set(nodo.id, estilo);
            if (aviso) avisosEstilo.add(aviso);
          }
          for (const aviso of avisosEstilo) avisos.push(aviso);
          return estilos;
        };
        let hijos: SceneNode[];
        if (o.layoutStyle === 'swimlanes') {
          const carriles = agruparEnCarriles(descomposicion, o.laneAgrupacion === 'duplicar');
          const opcionesLane: OpcionesSwimlanes = { reingreso: o.laneReingreso, orientacion: o.laneOrientacion };
          hijos = await crearSwimlanesFlujo(grafo, descomposicion, carriles, construirEstilos(), opcionesLane, o.lang, comps);
        } else if (o.layoutStyle === 'table') {
          hijos = crearTablaFlujo(descomposicionATabla(descomposicion, o.lang), descomposicion.preambulo, o.lang, comps);
        } else if (o.layoutStyle === 'classic') {
          hijos = await crearSubflujosClassic(grafo, descomposicion, d.flujoLabel, construirEstilos(), o.lang, comps);
        } else {
          hijos = crearCardsFlujo(descomposicion);
        }
        // título del flujo (y card repetida) arriba del encabezado, como en Classic
        let ancla: SceneNode = hijos[0];
        const tituloFlujo = crearTituloFlujo(d.flujoLabel, ancla.x, 0);
        tituloFlujo.y = ancla.y - tituloFlujo.height - MARGEN_CARD_FLOW;
        hijos.push(tituloFlujo);
        ancla = tituloFlujo;
        if (o.repetirFlow && o.generarDocs && seccionFlow) {
          hijos.push(crearCardFlowRepetida(ancla));
        }
        seccionesFlujo.push(crearSection(t('canvas.seccionDiagrama', o.lang) + sufijo, hijos));
        totalNodos += grafo.nodos.size;
        // en los layouts descompuestos los edge cases ya están integrados
        if (o.separarEdgeCases && offPath.size > 0) avisoCardsEdge = true;
        continue;
      }
      // sin hub razonable → cae al diagrama único con warning
      avisos.push(t('aviso.descomposicionFallback', o.lang, { flujo: d.flujoLabel }));
    }
    const nodosCreados = new Map<string, SceneNode>();
    const nodosPrincipal: SceneNode[] = [];
    const nodosEdgeCases: SceneNode[] = [];
    const anotaciones: SceneNode[] = [];
    const avisosEstilo = new Set<string>();

    for (const nodo of grafo.nodos.values()) {
      const p = posiciones.get(nodo.id) || posicionesOffPath.get(nodo.id)!;
      const { estilo, aviso } = resolverEstilo(nodo, grafo.classDefs, o.lang);
      if (aviso) avisosEstilo.add(aviso);
      const creado = createDiagramNodeInstance(nodo.forma, nodo.texto, estilo, p.x, p.y, comps);
      nodosCreados.set(nodo.id, creado);
      const grupo = offPath.has(nodo.id) ? nodosEdgeCases : nodosPrincipal;
      grupo.push(creado);

      // anotación de la leyenda de conectores, en cada aparición del nodo
      if (nodo.forma === 'conector') {
        const descripcion = doc.leyendaConectores[nodo.texto.toUpperCase()];
        if (descripcion) {
          const nota = crearAnotacionConector(`${nodo.texto} → ${descripcion}`, creado.x + creado.width + 8, 0, comps);
          nota.y = creado.y + (creado.height - nota.height) / 2;
          grupo.push(nota);
          anotaciones.push(nota);
        }
      }
    }

    // Conectores: todos dentro del mismo Section del flujo (los off-path van
    // al grupo de edge cases, punteados). El contexto de ruteo conoce todos
    // los nodos Y las anotaciones del flujo (los badges se van sumando como
    // obstáculos a medida que se crean).
    const cajas = Array.from(nodosCreados.values()).concat(anotaciones)
      .map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
    const ruteo = crearContextoRuteo(cajas);
    for (const edge of grafo.edges) {
      const origen = nodosCreados.get(edge.origen);
      const destino = nodosCreados.get(edge.destino);
      if (!origen || !destino) continue;
      const esOffPathEdge = offPath.has(edge.origen) || offPath.has(edge.destino);
      const creados = await createConnectorLike(origen, destino, edge.label, esOffPathEdge, o.lang, ruteo, comps);
      const grupo = esOffPathEdge ? nodosEdgeCases : nodosPrincipal;
      for (const c of creados) grupo.push(c);
    }

    // título del flujo dentro del Section, antes del primer nodo; la card de
    // Flow repetida (si aplica) se apila arriba del título
    if (nodosPrincipal.length > 0) {
      let ancla: SceneNode = nodosPrincipal[0];
      const tituloFlujo = crearTituloFlujo(d.flujoLabel, ancla.x, 0);
      tituloFlujo.y = ancla.y - tituloFlujo.height - MARGEN_CARD_FLOW;
      nodosPrincipal.push(tituloFlujo);
      ancla = tituloFlujo;
      if (o.repetirFlow && o.generarDocs && seccionFlow) {
        nodosPrincipal.push(crearCardFlowRepetida(ancla));
      }
    }
    // título del bloque de edge cases (suelto, misma tipografía que el flowLabel)
    if (nodosEdgeCases.length > 0) {
      let anclaEdge: SceneNode = nodosEdgeCases[0];
      const tituloEdge = crearTituloFlujo(
        `${t('canvas.seccionEdgeCases', o.lang)} — ${d.flujoLabel}`,
        anclaEdge.x,
        0,
      );
      tituloEdge.y = anclaEdge.y - tituloEdge.height - MARGEN_CARD_FLOW;
      nodosEdgeCases.push(tituloEdge);
      anclaEdge = tituloEdge;
      if (o.repetirFlow && o.generarDocs && seccionFlow) {
        nodosEdgeCases.push(crearCardFlowRepetida(anclaEdge));
      }
    }

    for (const a of avisosEstilo) avisos.push(a);
    totalNodos += grafo.nodos.size;
    totalEdgeCases += offPath.size;

    // UNA sola Section por flujo: diagrama + edge cases juntos
    seccionesFlujo.push(crearSection(
      t('canvas.seccionDiagrama', o.lang) + sufijo,
      nodosPrincipal.concat(nodosEdgeCases),
    ));
  }

  // --- Status del diagrama ---
  if (diagramas.length > 0) {
    partesResumen.push(t('status.diagramas', o.lang, { flows: diagramas.length, total: totalNodos }));
    if (o.separarEdgeCases) {
      if (totalEdgeCases > 0) {
        partesResumen.push(t('status.edgeCases', o.lang, { count: totalEdgeCases }));
      } else {
        avisos.push(t('aviso.sinEdgeCases', o.lang));
      }
    }
  } else {
    partesResumen.push(t('status.sinDiagrama', o.lang));
  }
  if (o.repetirFlow && o.generarDocs && !seccionFlow) {
    avisos.push(t('aviso.sinFlowParaRepetir', o.lang));
  }
  if (avisoCardsEdge) {
    avisos.push(t('aviso.edgeCasesEnCards', o.lang));
  }

  // --- PASADA 1 (documentación): cards en coordenadas locales + 🧩 anidado ---
  let seccionIzquierda: SectionNode | null = null;
  const hijosDocs: SceneNode[] = [];
  if (!o.generarDocs) {
    partesResumen.push(t('status.docsOmitida', o.lang));
  } else if (doc.secciones.length === 0) {
    avisos.push(t('aviso.sinSeccionesDocs', o.lang));
  } else {
    let cardY = 0;
    for (const seccion of doc.secciones) {
      const claveHeader = HEADERS_CONOCIDOS[seccion.tipo];
      const base = claveHeader ? t(claveHeader, o.lang) : seccion.titulo;
      // prefijo FLW0N — {header}; si la card ES el heading del flujo, va el label solo
      let header = base;
      if (seccion.flujo) {
        header = seccion.titulo === seccion.flujo.heading
          ? seccion.flujo.label
          : `${seccion.flujo.label} — ${base}`;
      }
      const card = createSectionCard(header, seccion.bloques, 0, cardY, o.lang, comps);
      hijosDocs.push(card);
      cardY += card.height + SEPARACION_CARDS;
    }

    const conocidas = new Set(doc.secciones.filter((s) => s.tipo !== 'generica').map((s) => s.tipo));
    const genericas = doc.secciones.filter((s) => s.tipo === 'generica');
    const extra = genericas.length > 0
      ? t('status.docsExtra', o.lang, { count: genericas.length, names: genericas.map((s) => `'${s.titulo}'`).join(', ') })
      : '';
    partesResumen.push(t('status.docs', o.lang, { known: conocidas.size, extra }));

    // 🧩 Base components: Section anidada al final de la columna de cards.
    // Se envuelve PRIMERO y se posiciona la Section ya medida (el margen que
    // agrega crearSection hacia arriba era lo que pisaba la última card).
    if (comps) {
      const seccionComps = crearSection(t('canvas.seccionComponentes', o.lang), [comps.set]);
      seccionComps.x = 0;
      seccionComps.y = cardY;
      hijosDocs.push(seccionComps);
    }
    seccionIzquierda = crearSection(t('canvas.seccionDocs', o.lang), hijosDocs);
  }
  // sin documentación pero con components: Section 🧩 suelta a la izquierda
  if (!seccionIzquierda && comps) {
    seccionIzquierda = crearSection(t('canvas.seccionComponentes', o.lang), [comps.set]);
  }

  // --- PASADA 2: posiciones finales con los tamaños REALES medidos ---
  let y = centro.y;
  let maxAnchoIzquierda = 0;
  if (seccionIzquierda) maxAnchoIzquierda = seccionIzquierda.width;
  const xColumnaFlujos = centro.x + (seccionIzquierda ? maxAnchoIzquierda + MARGEN_SECCIONES : 0);
  for (const sec of seccionesFlujo) {
    sec.x = xColumnaFlujos;
    sec.y = y;
    y += sec.height + MARGEN_SECCIONES;
  }
  if (seccionIzquierda) {
    seccionIzquierda.x = centro.x;
    seccionIzquierda.y = centro.y;
  }

  const seccionesVisibles: SceneNode[] = seccionIzquierda
    ? [seccionIzquierda, ...seccionesFlujo]
    : [...seccionesFlujo];
  if (seccionesVisibles.length > 0) {
    figma.viewport.scrollAndZoomIntoView(seccionesVisibles);
  }
  return { resumen: partesResumen.join(' '), warnings: avisos };
}

// URLs que el About de la UI puede pedir abrir (figma.openExternal)
const URLS_PERMITIDAS = [
  'https://www.figma.com/community/file/1486123838948777078', // librería Figma UI3
  'https://mermaid.js.org/syntax/flowchart.html',
  'https://developers.figma.com/docs/plugins/',
  'https://github.com/bochenn/markdown-to-flow',
  'https://crafter.studio',
  'https://x.com/bochenn',
  'https://www.linkedin.com/in/bochenn',
  'https://buymeacoffee.com/bochenn',
];

figma.ui.onmessage = async (msg: {
  type: string;
  markdown?: string;
  generarDocs?: boolean;
  separarEdgeCases?: boolean;
  direccion?: string;
  repetirFlow?: boolean;
  layoutStyle?: string;
  soloDensos?: boolean;
  laneReingreso?: string;
  laneAgrupacion?: string;
  laneOrientacion?: string;
  lang?: string;
  nombreArchivo?: string;
  url?: string;
}) => {
  const lang: Idioma = msg.lang === 'es' ? 'es' : 'en';

  // el idioma persiste apenas se cambia, aunque no se genere nada
  if (msg.type === 'cambiar-idioma') {
    figma.clientStorage.setAsync(CLAVE_IDIOMA, lang);
    return;
  }
  // links del About: solo URLs conocidas (no abrir cualquier cosa que llegue
  // por mensaje); figma.openExternal es el único camino confiable desde la UI
  if (msg.type === 'abrir-url') {
    if (msg.url && URLS_PERMITIDAS.indexOf(msg.url) !== -1) figma.openExternal(msg.url);
    return;
  }
  // Cancel / cerrar del panel (footer y header del modal)
  if (msg.type === 'cancelar') {
    figma.closePlugin();
    return;
  }
  if (msg.type !== 'generar') return;

  let layoutStyle: 'classic' | 'cards' | 'swimlanes' | 'table' = 'classic';
  if (msg.layoutStyle === 'cards' || msg.layoutStyle === 'swimlanes' || msg.layoutStyle === 'table') {
    layoutStyle = msg.layoutStyle;
  }

  const opciones: Opciones = {
    generarDocs: msg.generarDocs === true,
    separarEdgeCases: msg.separarEdgeCases === true,
    direccion: msg.direccion === 'horizontal' ? 'horizontal' : 'vertical',
    repetirFlow: msg.repetirFlow === true,
    layoutStyle,
    soloDensos: msg.soloDensos !== false,
    laneReingreso: msg.laneReingreso === 'badge' ? 'badge' : 'junction',
    laneAgrupacion: msg.laneAgrupacion === 'duplicar' ? 'duplicar' : 'primero',
    laneOrientacion: msg.laneOrientacion === 'vertical' ? 'vertical' : 'horizontal',
    lang,
    nombreArchivo: msg.nombreArchivo,
  };
  figma.clientStorage.setAsync(CLAVE_DOCS, opciones.generarDocs); // persistir sin bloquear
  figma.clientStorage.setAsync(CLAVE_EDGE_CASES, opciones.separarEdgeCases);
  figma.clientStorage.setAsync(CLAVE_DIRECCION, opciones.direccion);
  figma.clientStorage.setAsync(CLAVE_REPETIR_FLOW, opciones.repetirFlow);
  figma.clientStorage.setAsync(CLAVE_LAYOUT, msg.layoutStyle || 'classic');
  figma.clientStorage.setAsync(CLAVE_SOLO_DENSOS, opciones.soloDensos);
  figma.clientStorage.setAsync(CLAVE_LANE_REINGRESO, opciones.laneReingreso);
  figma.clientStorage.setAsync(CLAVE_LANE_AGRUPACION, opciones.laneAgrupacion);
  figma.clientStorage.setAsync(CLAVE_LANE_ORIENTACION, opciones.laneOrientacion);
  figma.clientStorage.setAsync(CLAVE_IDIOMA, lang);
  try {
    const { resumen, warnings } = await generar(msg.markdown || '', opciones);
    figma.ui.postMessage({ type: 'ok', resumen, warnings });
  } catch (e) {
    figma.ui.postMessage({ type: 'error', mensaje: e instanceof Error ? e.message : String(e) });
  }
};
