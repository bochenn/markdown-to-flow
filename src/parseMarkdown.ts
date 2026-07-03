// Extracción genérica de secciones del markdown y normalización del contenido
// a líneas planas para las cards de documentación. Todo puro y testeable en Node.
// El parseo específico de mermaid vive en parseMermaid.ts y usa buscarSeccion() de acá.

import { t } from './i18n.ts';
import type { Idioma } from './i18n.ts';
import { normalizeLineBreaks } from './texto.ts';

export interface Seccion {
  nivel: number;
  titulo: string;
  contenido: string;
}

// Línea ya lista para mostrar en una card: conserva los **marcadores** de negrita,
// que se resuelven recién al renderizar con construirNegritas().
export interface LineaCard {
  sangria: number;
  texto: string;
}

const REGEX_HEADING = /^(#{1,6})\s+(.+?)\s*$/;

// Corta el markdown en secciones. El contenido de cada una llega hasta el
// próximo heading del mismo nivel o superior, un "---", o el fin del archivo.
// Los headings y "---" adentro de bloques ``` ``` se ignoran.
export function partirEnSecciones(markdown: string): Seccion[] {
  const lineas = markdown.split(/\r?\n/);

  // marcar qué líneas están dentro de un bloque de código
  const enBloque: boolean[] = new Array(lineas.length);
  let abierto = false;
  for (let i = 0; i < lineas.length; i++) {
    const esFence = lineas[i].trim().startsWith('```');
    enBloque[i] = abierto || esFence;
    if (esFence) abierto = !abierto;
  }

  const secciones: Seccion[] = [];
  for (let i = 0; i < lineas.length; i++) {
    if (enBloque[i]) continue;
    const h = lineas[i].match(REGEX_HEADING);
    if (!h) continue;
    const nivel = h[1].length;
    let fin = lineas.length;
    for (let j = i + 1; j < lineas.length; j++) {
      if (enBloque[j]) continue;
      if (lineas[j].trim() === '---') { fin = j; break; }
      const otro = lineas[j].match(REGEX_HEADING);
      if (otro && otro[1].length <= nivel) { fin = j; break; }
    }
    secciones.push({ nivel, titulo: h[2], contenido: lineas.slice(i + 1, fin).join('\n') });
  }
  return secciones;
}

export function buscarSeccion(
  secciones: Seccion[],
  nivel: number,
  titulo: string,
  opciones?: { prefijo?: boolean },
): Seccion | null {
  for (const s of secciones) {
    if (s.nivel !== nivel) continue;
    if (opciones && opciones.prefijo ? s.titulo.startsWith(titulo) : s.titulo === titulo) return s;
  }
  return null;
}

// Clasifica UNA línea cruda: bullet (anidamiento aplanado a una sola sangría
// extra), numerada (conservando el número), blockquote o párrafo suelto.
// null = línea vacía o separador. Los <br/> se vuelven saltos de línea reales.
function lineaACard(cruda: string): LineaCard | null {
  if (!cruda.trim() || cruda.trim() === '---') return null;

  let m = cruda.match(/^(\s*)[-*]\s+(.*)$/);
  if (m) return { sangria: m[1].length > 0 ? 1 : 0, texto: normalizeLineBreaks('• ' + m[2]) };
  m = cruda.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
  if (m) return { sangria: m[1].length > 0 ? 1 : 0, texto: normalizeLineBreaks(m[2] + '. ' + m[3]) };
  m = cruda.match(/^>\s?(.*)$/);
  if (m) return { sangria: 0, texto: normalizeLineBreaks(m[1]) };
  return { sangria: 0, texto: normalizeLineBreaks(cruda.trim()) };
}

// Normaliza el contenido crudo de una sección a líneas planas (sin estructura
// de tablas; para las cards usar contenidoABloques).
export function contenidoALineas(contenido: string): LineaCard[] {
  const resultado: LineaCard[] = [];
  for (const cruda of contenido.split(/\r?\n/)) {
    const linea = lineaACard(cruda);
    if (linea) resultado.push(linea);
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Bloques de card: texto plano intercalado con tablas (markdown reales, o
// generadas desde bullets con el patrón "CA{N} (descripción) → referencia").
// ---------------------------------------------------------------------------

export interface TablaCard {
  headers: string[];
  filas: string[][];
}

export type BloqueCard =
  | { tipo: 'texto'; lineas: LineaCard[] }
  | { tipo: 'tabla'; tabla: TablaCard };

function esFilaTabla(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith('|') && t.indexOf('|', 1) !== -1;
}

function esSeparadorTabla(linea: string): boolean {
  const t = linea.trim();
  return /^\|?[\s:|-]+\|?$/.test(t) && t.indexOf('-') !== -1 && t.indexOf('|') !== -1;
}

function parsearFilaTabla(linea: string): string[] {
  const celdas = linea.trim().split('|');
  if (celdas.length > 0 && celdas[0].trim() === '') celdas.shift();
  if (celdas.length > 0 && celdas[celdas.length - 1].trim() === '') celdas.pop();
  return celdas.map((c) => normalizeLineBreaks(c.trim()));
}

const REGEX_BULLET_CA = /^•\s*(?:\*\*)?(CA\d+)(?:\*\*)?\s*\((.+?)\)\s*(?:→|->)\s*(.+?)\.?$/;

// Un grupo de bullets consecutivos donde ≥2 matchean el patrón CA se vuelve
// tabla de 3 columnas; el bullet que no matchea va como fila cruda + aviso.
function convertirBulletsCA(lineas: LineaCard[], lang: Idioma, avisos: string[]): BloqueCard[] {
  const bloques: BloqueCard[] = [];
  let texto: LineaCard[] = [];
  let bullets: LineaCard[] = [];

  const cerrarTexto = () => {
    if (texto.length > 0) { bloques.push({ tipo: 'texto', lineas: texto }); texto = []; }
  };
  const cerrarBullets = () => {
    if (bullets.length === 0) return;
    const matches = bullets.filter((b) => REGEX_BULLET_CA.test(b.texto));
    if (matches.length >= 2) {
      const filas = bullets.map((b) => {
        const m = b.texto.match(REGEX_BULLET_CA);
        if (m) return [m[1], m[2], m[3]];
        avisos.push(t('aviso.filaCACruda', lang, { linea: b.texto }));
        return [b.texto.replace(/^•\s*/, ''), '', ''];
      });
      bloques.push({
        tipo: 'tabla',
        tabla: { headers: [t('canvas.thCA', lang), t('canvas.thDescripcion', lang), t('canvas.thReferencia', lang)], filas },
      });
    } else {
      texto = texto.concat(bullets);
    }
    bullets = [];
  };

  for (const linea of lineas) {
    if (linea.texto.startsWith('• ')) {
      bullets.push(linea);
    } else {
      cerrarBullets();
      cerrarTexto();
      texto.push(linea);
    }
  }
  cerrarBullets();
  cerrarTexto();
  return bloques;
}

// Contenido de sección → bloques en orden: tablas markdown detectadas
// (`| a | b |` + separador `|---|---|`) intercaladas con el texto normal.
export function contenidoABloques(contenido: string, lang: Idioma, avisos: string[]): BloqueCard[] {
  const lineas = contenido.split(/\r?\n/);
  const bloques: BloqueCard[] = [];
  let pendientes: LineaCard[] = [];

  const cerrarPendientes = () => {
    if (pendientes.length > 0) {
      for (const b of convertirBulletsCA(pendientes, lang, avisos)) bloques.push(b);
      pendientes = [];
    }
  };

  let i = 0;
  while (i < lineas.length) {
    if (esFilaTabla(lineas[i]) && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1])) {
      cerrarPendientes();
      const headers = parsearFilaTabla(lineas[i]);
      i += 2; // header + separador
      const filas: string[][] = [];
      while (i < lineas.length && esFilaTabla(lineas[i]) && !esSeparadorTabla(lineas[i])) {
        let fila = parsearFilaTabla(lineas[i]);
        if (fila.length !== headers.length) {
          avisos.push(t('aviso.tablaIrregular', lang, { found: fila.length, expected: headers.length }));
          while (fila.length < headers.length) fila.push('');
          fila = fila.slice(0, headers.length);
        }
        filas.push(fila);
        i++;
      }
      bloques.push({ tipo: 'tabla', tabla: { headers, filas } });
    } else {
      const linea = lineaACard(lineas[i]);
      if (linea) pendientes.push(linea);
      i++;
    }
  }
  cerrarPendientes();
  return bloques;
}

// Resuelve los **marcadores** de una línea: devuelve el texto plano y los
// rangos que van en bold. Si hay un "**" sin cerrar, deja el texto tal cual
// (con los asteriscos visibles) y lo marca para loguear un warning.
export function construirNegritas(texto: string): {
  texto: string;
  rangos: { inicio: number; fin: number }[];
  malCerrado: boolean;
} {
  const partes = texto.split('**');
  if (partes.length % 2 === 0) {
    return { texto, rangos: [], malCerrado: true };
  }
  let plano = '';
  const rangos: { inicio: number; fin: number }[] = [];
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 1 && partes[i].length > 0) {
      rangos.push({ inicio: plano.length, fin: plano.length + partes[i].length });
    }
    plano += partes[i];
  }
  return { texto: plano, rangos, malCerrado: false };
}

// Texto rico completo: **negrita** + `código inline` (los backticks NO son un
// bug de encoding — son sintaxis markdown sin parsear). Los backticks se
// quitan del resultado y el rango queda marcado para fuente monoespaciada;
// un backtick sin cerrar deja la línea como texto plano. Soporta el combo
// **`texto`** (ambos formatos sobre el mismo rango).
export function construirRico(texto: string): {
  texto: string;
  negritas: { inicio: number; fin: number }[];
  codigo: { inicio: number; fin: number }[];
  malCerrado: boolean;
} {
  const negrita = construirNegritas(texto);
  const plano1 = negrita.texto;
  const partes = plano1.split('`');
  if (partes.length % 2 === 0) {
    // backtick sin cerrar → texto plano, sin romper el resto de la línea
    return { texto: plano1, negritas: negrita.rangos, codigo: [], malCerrado: negrita.malCerrado };
  }
  let plano2 = '';
  const codigo: { inicio: number; fin: number }[] = [];
  const cortes: number[] = []; // posiciones (en plano1) de los backticks removidos
  let pos1 = 0;
  for (let i = 0; i < partes.length; i++) {
    if (i % 2 === 1) {
      cortes.push(pos1 - 1); // backtick de apertura
      if (partes[i].length > 0) {
        codigo.push({ inicio: plano2.length, fin: plano2.length + partes[i].length });
      }
      cortes.push(pos1 + partes[i].length); // backtick de cierre
    }
    plano2 += partes[i];
    pos1 += partes[i].length + 1;
  }
  // remapear los rangos de negrita restando los backticks removidos antes de cada offset
  const remap = (p: number) => p - cortes.filter((c) => c < p).length;
  return {
    texto: plano2,
    negritas: negrita.rangos.map((r) => ({ inicio: remap(r.inicio), fin: remap(r.fin) })),
    codigo,
    malCerrado: negrita.malCerrado,
  };
}

// ============================================================================
// Análisis tolerante del documento completo: detecta el diagrama en cualquier
// parte del archivo y las secciones con la estrategia que funcione (cascada
// ATX → Setext → líneas etiqueta → sin estructura). Nunca falla por falta de
// estructura: genera lo mejor posible con lo que haya.
// ============================================================================

export type TipoSeccion = 'titulo' | 'flow' | 'steps' | 'decision' | 'edgeCases' | 'assumptions' | 'generica';
export type Estrategia = 'atx' | 'setext' | 'etiqueta' | 'sin-estructura';

export interface SeccionDetectada {
  tipo: TipoSeccion;
  titulo: string;
  lineas: LineaCard[];     // solo el texto (aplanado), sin las tablas
  bloques: BloqueCard[];   // texto y tablas en orden, para el render de la card
  flujo: FlujoInfo | null; // null = sección global (no pertenece a un flujo puntual)
}

// Un "flujo" = un heading que agrupa un bloque de diagrama (detección
// semántica: heading-con-diagrama, independiente del formato de numeración).
export interface FlujoInfo {
  id: string;             // FLW01, FLW02, ... en orden de aparición
  titulo: string;         // heading sin la numeración inicial ("Flujo principal (happy path)")
  label: string;          // "FLW01 - Flujo principal (happy path)" (o solo el id sin heading)
  heading: string | null; // heading original, para asociar secciones y evitar duplicar texto
}

export interface DiagramaDetectado {
  codigo: string;
  titulo: string | null; // heading ATX más cercano hacia arriba del bloque
  indice: number;        // posición de aparición en el archivo (para nombrar sin heading)
  flujo: FlujoInfo;
}

export interface DocumentoAnalizado {
  secciones: SeccionDetectada[];  // en orden de aparición; cada una será una card
  diagramas: DiagramaDetectado[]; // TODOS los bloques de diagrama; [] = sin diagrama (válido)
  leyendaConectores: Record<string, string>; // "((ID)) → descripción" del archivo, claves en MAYÚSCULAS
  estrategia: Estrategia;
  avisos: string[];
}

// Numeración inicial de un heading de flujo: "1. X", "2) X", "Flujo 1: X", "Flow 2 - X".
// Solo se usa para limpiar el título; la detección de flujos no depende del formato.
const REGEX_NUMERACION_FLUJO = /^\s*(?:\d+\s*[.)]\s*|(?:flujo|flow)\s+\d+\s*[:.\-–]\s*)/i;

// Asigna FLW0N a cada diagrama: un flujo por heading-con-diagrama (los bloques
// que comparten heading comparten flujo; los bloques sin heading van solos).
function asignarFlujos(
  crudos: { codigo: string; titulo: string | null; indice: number }[],
): { diagramas: DiagramaDetectado[]; flujos: FlujoInfo[] } {
  const porHeading = new Map<string, FlujoInfo>();
  const flujos: FlujoInfo[] = [];
  const diagramas = crudos.map((d) => {
    let flujo = d.titulo !== null ? porHeading.get(d.titulo) : undefined;
    if (!flujo) {
      const id = 'FLW' + String(flujos.length + 1).padStart(2, '0');
      const titulo = d.titulo ? d.titulo.replace(REGEX_NUMERACION_FLUJO, '').trim() : '';
      flujo = { id, titulo, label: titulo ? `${id} - ${titulo}` : id, heading: d.titulo };
      flujos.push(flujo);
      if (d.titulo !== null) porHeading.set(d.titulo, flujo);
    }
    return { codigo: d.codigo, titulo: d.titulo, indice: d.indice, flujo };
  });
  return { diagramas, flujos };
}

// Leyenda de puntos de conexión: líneas tipo "`((CO))` → **Descripción**",
// tolerante a backticks, "->"/"→"/"=>" y doble o triple paréntesis. Se escanea
// el texto SIN los bloques de diagrama (una arista mermaid "((X))) --> Y"
// matchearía el patrón por el "-->").
function extraerLeyendaConectores(restante: string): Record<string, string> {
  const leyenda: Record<string, string> = {};
  for (const linea of restante.split(/\r?\n/)) {
    const m = linea.match(/\({2,3}\s*([A-Za-z0-9_-]+)\s*\){2,3}`?\s*(?:→|->|=>)\s*(.+)$/);
    if (m) leyenda[m[1].toUpperCase()] = m[2].replace(/\*\*/g, '').replace(/`/g, '').trim();
  }
  return leyenda;
}

// Último heading ATX antes de la posición dada (para nombrar el diagrama).
function headingMasCercano(texto: string, posicion: number): string | null {
  const antes = texto.slice(0, posicion).split(/\r?\n/);
  for (let i = antes.length - 1; i >= 0; i--) {
    const h = antes[i].match(REGEX_HEADING);
    if (h) return h[2];
  }
  return null;
}

// Extrae TODOS los bloques de diagrama del archivo (independiente de headings)
// y los remueve del texto para que no aparezcan crudos en las cards. Primero
// bloques cercados ```mermaid```; si no hay ninguno, bloques sin cercar que
// empiezan en "flowchart TD"/"graph LR"/etc. hasta línea en blanco o heading.
function extraerDiagramas(texto: string): { crudos: { codigo: string; titulo: string | null; indice: number }[]; restante: string } {
  const diagramas: { codigo: string; titulo: string | null; indice: number }[] = [];

  let restante = texto.replace(/```mermaid[^\n]*\n([\s\S]*?)```/g, (todo, codigo, posicion: number) => {
    diagramas.push({ codigo, titulo: headingMasCercano(texto, posicion), indice: diagramas.length });
    return '';
  });

  if (diagramas.length === 0) {
    const lineas = texto.split(/\r?\n/);
    const fuera: string[] = [];
    let ultimoHeading: string | null = null;
    let i = 0;
    while (i < lineas.length) {
      const h = lineas[i].match(REGEX_HEADING);
      if (h) ultimoHeading = h[2];
      if (/^\s*(flowchart|graph)\s+(TD|LR|BT|RL)\b/.test(lineas[i])) {
        const bloque: string[] = [];
        while (i < lineas.length && lineas[i].trim() !== '' && !/^#{1,6}\s/.test(lineas[i])) {
          bloque.push(lineas[i]);
          i++;
        }
        diagramas.push({ codigo: bloque.join('\n'), titulo: ultimoHeading, indice: diagramas.length });
      } else {
        fuera.push(lineas[i]);
        i++;
      }
    }
    restante = fuera.join('\n');
  }

  return { crudos: diagramas, restante };
}

// Headings Setext: línea de texto seguida de "====" (nivel 1) o "----" (nivel 2).
// Un "---" con línea en blanco arriba es separador, no heading.
function seccionesSetext(lineas: string[]): Seccion[] {
  const headings: { titulo: string; nivel: number; inicio: number }[] = [];
  const subrayados = new Set<number>();
  for (let i = 0; i + 1 < lineas.length; i++) {
    const texto = lineas[i].trim();
    const sub = lineas[i + 1].trim();
    if (!texto || /^[-=#>*]/.test(texto)) continue;
    if (/^=+$/.test(sub)) { headings.push({ titulo: texto, nivel: 1, inicio: i }); subrayados.add(i + 1); }
    else if (/^-+$/.test(sub)) { headings.push({ titulo: texto, nivel: 2, inicio: i }); subrayados.add(i + 1); }
  }
  return cortarSecciones(lineas, headings.map((h) => ({ ...h, lineasOcupadas: 2 })), subrayados);
}

// Líneas etiqueta: línea corta (<60), sola entre líneas en blanco, en
// MAYÚSCULAS o terminada en ":". Todas cuentan como nivel 1.
function seccionesEtiqueta(lineas: string[]): Seccion[] {
  const headings: { titulo: string; nivel: number; inicio: number }[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (!l || l.length >= 60) continue;
    const prevEnBlanco = i === 0 || lineas[i - 1].trim() === '';
    const nextEnBlanco = i === lineas.length - 1 || lineas[i + 1].trim() === '';
    if (!prevEnBlanco || !nextEnBlanco) continue;
    if (/^[-*\d>]/.test(l)) continue; // bullets, numeradas y quotes no son etiquetas
    const esMayusculas = l === l.toUpperCase() && /[A-ZÁÉÍÓÚÜÑ]/.test(l);
    if (esMayusculas || l.endsWith(':')) {
      headings.push({ titulo: l.replace(/:$/, ''), nivel: 1, inicio: i });
    }
  }
  return cortarSecciones(lineas, headings.map((h) => ({ ...h, lineasOcupadas: 1 })), new Set());
}

function cortarSecciones(
  lineas: string[],
  headings: { titulo: string; nivel: number; inicio: number; lineasOcupadas: number }[],
  ignorar: Set<number>,
): Seccion[] {
  const secciones: Seccion[] = [];
  for (let h = 0; h < headings.length; h++) {
    const actual = headings[h];
    let fin = lineas.length;
    for (let j = actual.inicio + actual.lineasOcupadas; j < lineas.length; j++) {
      if (ignorar.has(j)) continue;
      const siguiente = headings.find((x) => x.inicio === j);
      if (siguiente && siguiente.nivel <= actual.nivel) { fin = j; break; }
      if (!siguiente && lineas[j].trim() === '---') { fin = j; break; }
    }
    secciones.push({
      nivel: actual.nivel,
      titulo: actual.titulo,
      contenido: lineas.slice(actual.inicio + actual.lineasOcupadas, fin).join('\n'),
    });
  }
  return secciones;
}

// Normaliza para comparar contra los alias: minúsculas, sin tildes, sin ":" final.
function normalizarTitulo(titulo: string): string {
  return titulo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/:$/, '').trim();
}

function clasificarTitulo(titulo: string): TipoSeccion {
  const t = normalizarTitulo(titulo);
  if (t.startsWith('flow') || t.indexOf('resumen') !== -1 || t.indexOf('summary') !== -1) return 'flow';
  if (t.indexOf('steps') !== -1 || t.indexOf('pasos') !== -1) return 'steps';
  if (t.indexOf('decision') !== -1) return 'decision';
  if (t.indexOf('edge case') !== -1 || t.indexOf('error') !== -1 || t.indexOf('alternate') !== -1) return 'edgeCases';
  if (t.indexOf('assumption') !== -1 || t.indexOf('supuesto') !== -1) return 'assumptions';
  return 'generica';
}

// Pares clave-valor sin negrita markdown ("Type: user flow", típico de .txt):
// se marca la clave en bold igual (buena práctica visual). Las líneas que ya
// traen ** se dejan como están.
function marcarClaves(contenido: string): string {
  return contenido.split(/\r?\n/).map((linea) => {
    if (linea.indexOf('**') !== -1) return linea;
    const m = linea.match(/^(\s*(?:[-*]\s+)?)([^:\n]{1,40}?):\s+(.+)$/);
    return m ? `${m[1]}**${m[2]}:** ${m[3]}` : linea;
  }).join('\n');
}

function lineasDeBloques(bloques: BloqueCard[]): LineaCard[] {
  const lineas: LineaCard[] = [];
  for (const b of bloques) {
    if (b.tipo === 'texto') {
      for (const l of b.lineas) lineas.push(l);
    }
  }
  return lineas;
}

function clasificarSecciones(
  secciones: Seccion[],
  flujosPorHeading: Map<string, FlujoInfo>,
  unicoFlujo: FlujoInfo | null,
  lang: Idioma,
  avisos: string[],
): SeccionDetectada[] {
  let nivelMin = Infinity;
  for (const s of secciones) nivelMin = Math.min(nivelMin, s.nivel);

  const resultado: SeccionDetectada[] = [];
  let tituloAsignado = false;
  // scope de flujo: lo abre la sección cuyo heading agrupa un diagrama, lo
  // heredan las secciones más profundas, y lo cierra cualquier heading de
  // nivel igual o superior (ej. un "Checklist" al final queda global)
  let flujoActual: { flujo: FlujoInfo; nivel: number } | null = null;
  for (const s of secciones) {
    const flujoPropio = flujosPorHeading.get(s.titulo) || null;
    let tipo: TipoSeccion;
    if (!tituloAsignado && s.nivel === nivelMin) {
      tipo = 'titulo'; // el primer heading del nivel más alto es el título del documento
      tituloAsignado = true;
    } else if (flujoPropio) {
      // el heading de un flujo es la card descriptiva de ESE flujo, no una
      // sección conocida — palabras como "edge cases"/"errores" en el título
      // del flujo no deben matchear los alias (bug: FLW03-05 clasificados
      // como "Alternate paths" y perdidos del status)
      tipo = 'generica';
    } else {
      tipo = clasificarTitulo(s.titulo);
    }

    let flujo: FlujoInfo | null = null;
    if (unicoFlujo) {
      flujo = unicoFlujo; // un solo flujo: todo el contenido le pertenece
    } else if (flujoPropio) {
      flujoActual = { flujo: flujoPropio, nivel: s.nivel };
      flujo = flujoPropio;
    } else if (flujoActual && s.nivel > flujoActual.nivel) {
      flujo = flujoActual.flujo;
    } else {
      flujoActual = null; // salió del scope del flujo → sección global
    }

    const contenido = tipo === 'flow' ? marcarClaves(s.contenido) : s.contenido;
    const bloques = contenidoABloques(contenido, lang, avisos);
    // secciones genéricas que quedaron vacías (ej. la que solo tenía el
    // diagrama adentro) no generan card; las conocidas vacías sí, con placeholder
    if (tipo === 'generica' && bloques.length === 0) continue;
    resultado.push({ tipo, titulo: s.titulo, lineas: lineasDeBloques(bloques), bloques, flujo });
  }
  return resultado;
}

// ¿La sección sirve de resumen de Flow? Formato clásico (tipo 'flow') o el
// alternativo: metadatos como texto corrido bajo el H1 ("**User story:** ...").
export function esResumenFlow(seccion: SeccionDetectada): boolean {
  if (seccion.tipo === 'flow') return true;
  return seccion.lineas.filter((l) => /^(?:•\s*)?\*\*[^*]+:\*\*\s/.test(l.texto)).length >= 2;
}

export function analizarDocumento(texto: string, nombreFallback?: string, lang: Idioma = 'en'): DocumentoAnalizado {
  const avisos: string[] = [];
  const { crudos, restante } = extraerDiagramas(texto);
  const { diagramas, flujos } = asignarFlujos(crudos);
  const leyendaConectores = extraerLeyendaConectores(restante);
  const flujosPorHeading = new Map<string, FlujoInfo>();
  for (const f of flujos) {
    if (f.heading !== null) flujosPorHeading.set(f.heading, f);
  }
  const unicoFlujo = flujos.length === 1 ? flujos[0] : null;
  const lineas = restante.split(/\r?\n/);

  // cascada: la primera estrategia que encuentre headings se usa para todo el documento
  let estrategia: Estrategia = 'sin-estructura';
  let secciones: Seccion[] = partirEnSecciones(restante);
  if (secciones.length > 0) {
    estrategia = 'atx';
  } else {
    secciones = seccionesSetext(lineas);
    if (secciones.length > 0) {
      estrategia = 'setext';
    } else {
      secciones = seccionesEtiqueta(lineas);
      if (secciones.length > 0) estrategia = 'etiqueta';
    }
  }

  let detectadas: SeccionDetectada[];
  if (estrategia === 'sin-estructura') {
    const contenido = restante.trim();
    if (contenido === '') {
      detectadas = [];
    } else {
      const bloques = contenidoABloques(contenido, lang, avisos);
      detectadas = [{
        tipo: 'generica',
        titulo: nombreFallback || t('canvas.cardContenido', lang),
        lineas: lineasDeBloques(bloques),
        bloques,
        flujo: unicoFlujo,
      }];
    }
  } else {
    detectadas = clasificarSecciones(secciones, flujosPorHeading, unicoFlujo, lang, avisos);
  }

  return { secciones: detectadas, diagramas, leyendaConectores, estrategia, avisos };
}
