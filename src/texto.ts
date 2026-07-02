// Utilidades de texto compartidas por parsers y render.

// Convierte cualquier variante de <br> (<br>, <br/>, <br />, case-insensitive)
// en un salto de línea real. Aplicar SIEMPRE antes de setear .characters con
// texto que venga del markdown/mermaid de origen.
export function normalizeLineBreaks(texto: string): string {
  return texto.replace(/<br\s*\/?\s*>/gi, '\n');
}
