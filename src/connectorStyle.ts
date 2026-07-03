// Estilo del conector default de FigJam, replicado en el vector simulado de
// Figma Design para que los dos editores se vean iguales.
//
// PROVISORIO: la Plugin API no documenta los valores default del conector
// (solo que nace con ancho 200 y que el lineType usual es ELBOWED). Al correr
// el plugin en FigJam, renderFigma.ts imprime en consola un dump con las
// propiedades reales del primer conector creado — verificar contra eso y
// corregir estas constantes si difieren.
//
// Límite conocido: FigJam rutea en escuadra (ELBOWED); la línea simulada de
// Design es recta a propósito. Se igualan color, grosor y punta (V abierta
// de líneas, strokeCap ARROW_LINES — la misma familia que usa FigJam).

// Color único para los conectores normales (#9747FF), en ambos editores —
// override intencional sobre el default. Los edge cases se distinguen solo
// por el punteado (dashPattern), no por color.
export const ESTILO_CONECTOR = {
  color: { r: 151 / 255, g: 71 / 255, b: 1 }, // #9747FF
  strokeWeight: 2,
};

// El default real de figma.createConnector() NO es elbowed: se fuerza
// connectorLineType = 'ELBOWED' explícito. El cornerRadius del conector
// nativo es readonly en la API (el redondeo del codo lo dibuja FigJam);
// estos valores aplican al trazado simulado de Figma Design.
export const RADIO_CODO = 8;      // radio de esquina de los codos simulados
export const DESVIO_RETORNO = 60; // cuánto rodea por la derecha un back-edge

// Conectores de salto largo (los desviados por carril): color propio para
// distinguir de un vistazo los "saltos" entre partes distantes del flujo
// de los pasos secuenciales normales (#874FFF).
export const COLOR_SALTO_LARGO = { r: 13 / 255, g: 153 / 255, b: 1 }; // #0D99FF

// Desvío por carril lateral cuando un conector cruzaría otros nodos.
export const MARGEN_OBSTACULO = 24;  // separación de las bandas respecto de los nodos
export const MARGEN_CARRIL = 40;     // distancia del carril al borde del diagrama
export const SEPARACION_CARRIL = 24; // corrimiento entre tramos que comparten franja (mayor que el alto del badge: 22px)
