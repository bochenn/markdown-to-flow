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

export const ESTILO_CONECTOR = {
  color: { r: 0, g: 0, b: 0 },
  strokeWeight: 2,
};

// Override explícito para los conectores off-path (edge cases): gris tenue.
export const COLOR_CONECTOR_OFFPATH = { r: 0.62, g: 0.62, b: 0.62 };
