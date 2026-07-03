// Diccionario de textos que el plugin genera: status/avisos del main thread y
// etiquetas escritas en el canvas. El contenido extraído del archivo del
// usuario NUNCA pasa por acá (no se traduce). Los textos de la UI del iframe
// viven duplicados en ui.html (el iframe no tiene bundler) — mantener sincronía.

export type Idioma = 'en' | 'es';

const DICCIONARIO: Record<string, { en: string; es: string }> = {
  // status (resumen de la corrida)
  'status.diagramas': { en: 'Diagram: {flows} flow(s) detected, {total} nodes total.', es: 'Diagrama: {flows} flujo(s) detectado(s), {total} nodos en total.' },
  'status.edgeCases': { en: 'Edge cases separated: {count} nodes.', es: 'Edge cases separados: {count} nodos.' },
  'status.sinDiagrama': { en: 'No flow diagram block was found in this file.', es: 'No se encontró bloque de diagrama en este archivo.' },
  'status.docsOmitida': { en: 'Documentation skipped (toggle off).', es: 'Documentación omitida (toggle desactivado).' },
  'status.docs': { en: 'Documentation: {known} of 6 known sections found{extra}.', es: 'Documentación: {known} de 6 secciones conocidas encontradas{extra}.' },
  'status.docsExtra': { en: ' + {count} additional section(s) ({names})', es: ' + {count} sección(es) adicional(es) ({names})' },

  // avisos
  'aviso.sinSeccionesDocs': { en: 'No documentation sections were found to generate cards.', es: 'No se encontraron secciones de documentación para generar cards.' },
  'aviso.sinEdgeCases': { en: 'There are no edge case/error nodes to separate (no off-path class is assigned in the diagram).', es: 'No hay nodos de edge case/error para separar (ninguna clase off-path está asignada en el diagrama).' },
  'aviso.diagramaSinNodos': { en: 'The detected diagram block has no recognizable nodes; it was skipped.', es: 'El bloque de diagrama detectado no tiene nodos reconocibles; se omitió.' },
  'aviso.lineaNoReconocida': { en: 'Unrecognized mermaid line: "{linea}"', es: 'Línea de mermaid no reconocida: "{linea}"' },
  'aviso.formaNoReconocida': { en: "Unrecognized node shape for '{id}', defaulting to rectangle: {forma}", es: "Forma de nodo no reconocida para '{id}', se usa rectángulo: {forma}" },
  'aviso.claseSinDef': { en: 'Class "{clase}" has no classDef; using the shape\'s default color.', es: 'Clase "{clase}" sin classDef; se usa el color default de la forma.' },
  'aviso.negritaSinCerrar': { en: 'Unclosed bold marker, kept as plain text: "{linea}"', es: 'Negrita sin cerrar, se deja como texto plano: "{linea}"' },
  'aviso.sinFlowParaRepetir': { en: 'The Flow summary card was not repeated (no Flow section was detected in the file).', es: 'No se repitió la card de resumen del Flow (no se detectó sección Flow en el archivo).' },
  'aviso.tablaIrregular': { en: 'Table row with {found} column(s) adjusted to the {expected} header column(s).', es: 'Fila de tabla con {found} columna(s) ajustada a las {expected} del header.' },
  'aviso.filaCACruda': { en: 'Bullet without the CA pattern, added as a raw row: "{linea}"', es: 'Bullet sin el patrón CA, agregado como fila cruda: "{linea}"' },
  'aviso.modoNoDisponible': { en: "The '{modo}' layout is not available yet; Classic was used.", es: "El layout '{modo}' todavía no está disponible; se usó Classic." },
  'aviso.edgeCasesEnCards': { en: "In simplified layouts (Cards/Swimlanes), edge cases are already integrated; the 'separate edge cases' toggle was ignored for those flows.", es: 'En los layouts simplificados (Cards/Swimlanes) los edge cases ya están integrados; el toggle de separarlos se ignoró en esos flujos.' },
  'canvas.laneSinReingreso': { en: 'No re-entry — flow ends here', es: 'Sin reingreso — termina el flujo' },

  // etiquetas del canvas
  'canvas.seccionDiagrama': { en: 'Flow diagram', es: 'Diagrama de flujo' },
  'canvas.seccionDocs': { en: 'Documentation', es: 'Documentación' },
  'canvas.seccionEdgeCases': { en: 'Edge cases and errors', es: 'Edge cases y errores' },
  'canvas.seccionComponentes': { en: '🧩 Base components', es: '🧩 Componentes base' },
  'canvas.cardSteps': { en: 'Steps', es: 'Pasos' },
  'canvas.cardDecision': { en: 'Decision points', es: 'Puntos de decisión' },
  'canvas.cardEdgeCases': { en: 'Alternate paths, errors and edge cases', es: 'Rutas alternativas, errores y casos límite' },
  'canvas.cardAssumptions': { en: 'Assumptions and open questions', es: 'Supuestos y preguntas abiertas' },
  'canvas.cardContenido': { en: 'Content', es: 'Contenido' },
  'canvas.thCA': { en: 'CA', es: 'CA' },
  'canvas.thDescripcion': { en: 'Description', es: 'Descripción' },
  'canvas.thReferencia': { en: 'Reference', es: 'Referencia' },
  'canvas.sinContenido': { en: '(no content)', es: '(sin contenido)' },
  // los nombres del Component Set y sus variantes (user-flow-elements,
  // Type=Start / End, etc.) son convención funcional de Figma: no se traducen
  'canvas.capaFlecha': { en: 'arrow ({label})', es: 'flecha ({label})' },
  'canvas.capaFlechaSimple': { en: 'arrow', es: 'flecha' },
};

// Devuelve el texto de la clave en el idioma pedido, con interpolación {var}.
// Fallback: idioma sin la clave → inglés; clave inexistente → la clave misma.
export function t(clave: string, lang: Idioma, vars?: Record<string, string | number>): string {
  const entrada = DICCIONARIO[clave];
  let texto = entrada ? (entrada[lang] !== undefined ? entrada[lang] : entrada.en) : clave;
  if (vars) {
    for (const nombre of Object.keys(vars)) {
      texto = texto.split('{' + nombre + '}').join(String(vars[nombre]));
    }
  }
  return texto;
}
