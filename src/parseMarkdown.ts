// Extracción genérica de secciones del markdown y normalización del contenido
// a líneas planas para las cards de documentación. Todo puro y testeable en Node.
// El parseo específico de mermaid vive en parseMermaid.ts y usa buscarSeccion() de acá.

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

export interface CardDoc {
  titulo: string;
  lineas: LineaCard[];
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

// Normaliza el contenido crudo de una sección a líneas planas:
// bullets (con anidamiento aplanado a una sola sangría extra), listas
// numeradas (conservando el número), blockquotes y párrafos sueltos.
export function contenidoALineas(contenido: string): LineaCard[] {
  const resultado: LineaCard[] = [];
  for (const cruda of contenido.split(/\r?\n/)) {
    if (!cruda.trim() || cruda.trim() === '---') continue;

    let m = cruda.match(/^(\s*)[-*]\s+(.*)$/);
    if (m) {
      resultado.push({ sangria: m[1].length > 0 ? 1 : 0, texto: '• ' + m[2] });
      continue;
    }
    m = cruda.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (m) {
      resultado.push({ sangria: m[1].length > 0 ? 1 : 0, texto: m[2] + '. ' + m[3] });
      continue;
    }
    m = cruda.match(/^>\s?(.*)$/);
    if (m) {
      resultado.push({ sangria: 0, texto: m[1] });
      continue;
    }
    resultado.push({ sangria: 0, texto: cruda.trim() });
  }
  return resultado;
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

// Extrae las 6 secciones de documentación en orden. Las ausentes se omiten
// con un aviso informativo; nunca es un error.
export function extraerDocumentacion(markdown: string): { cards: CardDoc[]; avisos: string[] } {
  const secciones = partirEnSecciones(markdown);
  const cards: CardDoc[] = [];
  const avisos: string[] = [];

  let h1: Seccion | null = null;
  for (const s of secciones) {
    if (s.nivel === 1) { h1 = s; break; }
  }

  const buscadas: { seccion: Seccion | null; nombre: string }[] = [
    { seccion: h1, nombre: 'Título (H1)' },
    { seccion: buscarSeccion(secciones, 2, 'Flow:', { prefijo: true }), nombre: '## Flow: ...' },
    { seccion: buscarSeccion(secciones, 3, 'Steps (happy path)'), nombre: '### Steps (happy path)' },
    { seccion: buscarSeccion(secciones, 3, 'Decision points'), nombre: '### Decision points' },
    { seccion: buscarSeccion(secciones, 3, 'Alternate paths, errors, and edge cases'), nombre: '### Alternate paths, errors, and edge cases' },
    { seccion: buscarSeccion(secciones, 3, 'Assumptions and open questions'), nombre: '### Assumptions and open questions' },
  ];

  for (const { seccion, nombre } of buscadas) {
    if (!seccion) {
      avisos.push(`Sección "${nombre}" no encontrada; se omite su card.`);
      continue;
    }
    cards.push({ titulo: seccion.titulo, lineas: contenidoALineas(seccion.contenido) });
  }
  return { cards, avisos };
}
