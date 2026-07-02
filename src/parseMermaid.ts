// Parser acotado de flowcharts Mermaid (flowchart TD / graph TD).
// No usa la librería mermaid (esa renderiza SVG): acá solo extraemos el grafo
// con regex línea por línea, tolerando lo que no reconocemos con un warning.
// La localización del bloque dentro del documento vive en parseMarkdown.ts
// (analizarDocumento); acá solo se parsea el código mermaid ya extraído.

import { t } from './i18n.ts';
import type { Idioma } from './i18n.ts';
import { normalizeLineBreaks } from './texto.ts';

export type Forma = 'inicioFin' | 'proceso' | 'decision' | 'inputOutput' | 'conector';

export interface Nodo {
  id: string;
  texto: string;
  forma: Forma;
  clases: string[];
}

export interface Edge {
  origen: string;
  destino: string;
  label?: string;
}

// Estilos extraídos de un classDef (fill:#fde,stroke:#c33,color:#900,stroke-dasharray:4 2).
// Solo los que usamos: fill, stroke, color de texto y si el borde va punteado.
export interface EstiloClase {
  fill?: string;
  stroke?: string;
  color?: string;
  dashed?: boolean;
}

export interface Grafo {
  direccion: string; // "TD" por ahora; se guarda por si después soportamos "LR"
  nodos: Map<string, Nodo>;
  edges: Edge[];
  classDefs: Map<string, EstiloClase>;
  warnings: string[];
}

function parsearEstilos(texto: string): EstiloClase {
  const estilo: EstiloClase = {};
  for (const parte of texto.split(',')) {
    const separador = parte.indexOf(':');
    if (separador === -1) continue;
    const clave = parte.slice(0, separador).trim();
    const valor = parte.slice(separador + 1).trim();
    if (clave === 'fill') estilo.fill = valor;
    else if (clave === 'stroke') estilo.stroke = valor;
    else if (clave === 'color') estilo.color = valor;
    else if (clave === 'stroke-dasharray') estilo.dashed = true;
    // otros estilos (stroke-width, etc.) se ignoran a propósito
  }
  return estilo;
}

// "#fde" o "#DCFCE7" → RGB 0..1 para la Figma API; null si no es un hex válido.
export function hexARgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

// Token de nodo en 3 partes independientes: id + chunk de forma + :::clase.
// El id alcanza para registrar el edge; la forma se resuelve aparte, y si no
// se reconoce cae a rectángulo con warning EN VEZ de perder la línea entera.
const REGEX_TOKEN = /^([A-Za-z0-9_-]+)\s*(.*?)\s*(?::::([A-Za-z0-9_-]+))?$/;

// Patrones de forma en orden (las sintaxis se contienen entre sí: "(((" antes
// que "((" y "([", "{{" antes que "{", "[[" y "[(" antes que "[").
// forma: null = sintaxis mermaid conocida pero no soportada → fallback a
// rectángulo con el texto limpio del grupo capturado.
const PATRONES_FORMA: { forma: Forma | null; regex: RegExp }[] = [
  { forma: 'conector', regex: /^\(\(\((.+)\)\)\)$/ },  // círculo doble (junction)
  { forma: 'conector', regex: /^\(\((.+)\)\)$/ },      // círculo simple: mismo junction (el triple va antes)
  { forma: 'inicioFin', regex: /^\(\[(.+)\]\)$/ },
  { forma: 'inputOutput', regex: /^\[\/(.+)\/\]$/ },
  { forma: null, regex: /^\{\{(.+)\}\}$/ },            // hexágono
  { forma: 'decision', regex: /^\{(.+)\}$/ },
  { forma: null, regex: /^\[\[(.+)\]\]$/ },            // subrutina
  { forma: null, regex: /^\[\((.+)\)\]$/ },            // base de datos
  { forma: 'proceso', regex: /^\[(.+)\]$/ },
];

function limpiarTexto(texto: string): string {
  let t = texto.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  return normalizeLineBreaks(t);
}

export function parsearFlowchart(codigo: string, lang: Idioma = 'en'): Grafo {
  const grafo: Grafo = {
    direccion: 'TD',
    nodos: new Map(),
    edges: [],
    classDefs: new Map(),
    warnings: [],
  };

  // Registra (o reusa) un nodo a partir de un token. Devuelve el id o null si
  // el token no tiene ni la pinta de un nodo (para eso el chunk de forma debe
  // matchear un patrón conocido o al menos empezar con un delimitador de forma).
  function registrarNodo(token: string): string | null {
    const m = token.trim().match(REGEX_TOKEN);
    if (!m) return null;
    const [, id, chunk, clase] = m;

    let forma: Forma | null = null;
    let texto: string | null = null;
    if (chunk) {
      let reconocido = false;
      for (const patron of PATRONES_FORMA) {
        const f = chunk.match(patron.regex);
        if (!f) continue;
        reconocido = true;
        texto = f[1];
        if (patron.forma !== null) {
          forma = patron.forma;
        } else {
          // sintaxis conocida pero no soportada → rectángulo + warning, sin perder el edge
          forma = 'proceso';
          const aviso = t('aviso.formaNoReconocida', lang, { id, forma: chunk });
          grafo.warnings.push(aviso);
          console.warn('[markdown-to-flow] ' + aviso);
        }
        break;
      }
      if (!reconocido) {
        // catch-all: solo si parece una forma (empieza con delimitador);
        // si no, el token no es un nodo y la línea se reporta como no reconocida
        if (!/^[\[({]/.test(chunk)) return null;
        forma = 'proceso';
        texto = chunk;
        const aviso = t('aviso.formaNoReconocida', lang, { id, forma: chunk });
        grafo.warnings.push(aviso);
        console.warn('[markdown-to-flow] ' + aviso);
      }
    }

    let nodo = grafo.nodos.get(id);
    if (!nodo) {
      nodo = { id, texto: id, forma: 'proceso', clases: [] };
      grafo.nodos.set(id, nodo);
    }
    // Si el token trae forma explícita se aplica; una referencia pelada ("H") reusa lo que haya.
    if (forma !== null && texto !== null) {
      nodo.forma = forma;
      nodo.texto = limpiarTexto(texto);
    }
    if (clase && nodo.clases.indexOf(clase) === -1) nodo.clases.push(clase);
    return id;
  }

  // Procesa una línea con uno o más "-->" (soporta cadenas A --> B --> C y labels |texto|).
  function procesarEdges(linea: string): boolean {
    const segmentos = linea.split('-->');
    const ids: string[] = [];
    const labels: (string | undefined)[] = [];
    for (let i = 0; i < segmentos.length; i++) {
      let seg = segmentos[i].trim();
      if (i > 0) {
        let label: string | undefined;
        const conLabel = seg.match(/^\|([^|]*)\|\s*([\s\S]*)$/);
        if (conLabel) {
          const crudo = conLabel[1].trim();
          label = crudo ? normalizeLineBreaks(crudo) : undefined;
          seg = conLabel[2].trim();
        }
        labels.push(label);
      }
      const id = registrarNodo(seg);
      if (!id) return false;
      ids.push(id);
    }
    for (let i = 1; i < ids.length; i++) {
      grafo.edges.push({ origen: ids[i - 1], destino: ids[i], label: labels[i - 1] });
    }
    return true;
  }

  for (const cruda of codigo.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('%%')) continue;

    const dir = linea.match(/^(?:flowchart|graph)\s+([A-Za-z]{2})\b/);
    if (dir) { grafo.direccion = dir[1]; continue; }

    const classDef = linea.match(/^classDef\s+([A-Za-z0-9_-]+)\s+(.+?);?$/);
    if (classDef) { grafo.classDefs.set(classDef[1], parsearEstilos(classDef[2])); continue; }

    // asignación en bloque: "class E,H,K,O,R decision;" (además del ":::clase" inline)
    const asignacion = linea.match(/^class\s+([A-Za-z0-9_,\s-]+?)\s+([A-Za-z0-9_-]+);?$/);
    if (asignacion) {
      for (const idCrudo of asignacion[1].split(',')) {
        const id = registrarNodo(idCrudo.trim());
        if (id) {
          const nodo = grafo.nodos.get(id)!;
          if (nodo.clases.indexOf(asignacion[2]) === -1) nodo.clases.push(asignacion[2]);
        }
      }
      continue;
    }

    if (linea.indexOf('-->') !== -1) {
      if (procesarEdges(linea)) continue;
    } else if (registrarNodo(linea)) {
      continue;
    }

    const aviso = t('aviso.lineaNoReconocida', lang, { linea });
    grafo.warnings.push(aviso);
    console.warn('[markdown-to-flow] ' + aviso);
  }

  return grafo;
}
