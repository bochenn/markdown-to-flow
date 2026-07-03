// Tests del parser genérico de secciones y las cards. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  partirEnSecciones,
  buscarSeccion,
  contenidoALineas,
  construirNegritas,
  construirRico,
  analizarDocumento,
  esResumenFlow,
} from '../src/parseMarkdown.ts';

const md = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado.md', import.meta.url), 'utf8');
const txt = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado.txt', import.meta.url), 'utf8');
const notas = readFileSync(new URL('../Resources/notas-sin-estructura.txt', import.meta.url), 'utf8');
const edgeMd = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado_edge.md', import.meta.url), 'utf8');

test('partirEnSecciones corta en headings y separadores ---', () => {
  const secciones = partirEnSecciones(md);
  const flow = buscarSeccion(secciones, 2, 'Flow:', { prefijo: true })!;
  assert.ok(flow.titulo.startsWith('Flow: Completar la compra'));
  assert.ok(flow.contenido.includes('**Type:**'));
  // el "---" corta la sección: los Steps no se cuelan adentro del Flow
  assert.ok(!flow.contenido.includes('Steps'));
});

test('ignora headings y --- adentro de bloques de código', () => {
  const conFence = '### Diagram\n\n```mermaid\nflowchart TD\n# esto no es heading\n---\nA[uno]\n```\n';
  const seccion = buscarSeccion(partirEnSecciones(conFence), 3, 'Diagram')!;
  assert.ok(seccion.contenido.includes('A[uno]'));
});

test('contenidoALineas: bullets, numeradas, sangría aplanada y blockquote', () => {
  const lineas = contenidoALineas('> cita\n\n1. primero\n- padre\n  - hijo\n    - nieto\ntexto suelto');
  assert.deepEqual(lineas, [
    { sangria: 0, texto: 'cita' },
    { sangria: 0, texto: '1. primero' },
    { sangria: 0, texto: '• padre' },
    { sangria: 1, texto: '• hijo' },
    { sangria: 1, texto: '• nieto' }, // más de 2 niveles se aplana a una sola sangría
    { sangria: 0, texto: 'texto suelto' },
  ]);
});

test('construirNegritas resuelve rangos y tolera ** sin cerrar', () => {
  const ok = construirNegritas('• **D1 ·** ¿tiene **sesión**?');
  assert.equal(ok.texto, '• D1 · ¿tiene sesión?');
  assert.deepEqual(ok.rangos, [
    { inicio: 2, fin: 6 },
    { inicio: 14, fin: 20 },
  ]);
  assert.equal(ok.malCerrado, false);

  const roto = construirNegritas('texto **sin cierre');
  assert.equal(roto.texto, 'texto **sin cierre');
  assert.equal(roto.rangos.length, 0);
  assert.equal(roto.malCerrado, true);
});

test('construirRico: quita backticks, marca rangos de código y convive con la negrita', () => {
  const simple = construirRico('Estadio `([ ])` en verde');
  assert.equal(simple.texto, 'Estadio ([ ]) en verde');
  assert.deepEqual(simple.codigo.map((r) => simple.texto.slice(r.inicio, r.fin)), ['([ ])']);
  assert.equal(simple.negritas.length, 0);

  // combinado: **`((CO))`** → ambos formatos sobre el mismo rango, sin backticks ni asteriscos
  const combinado = construirRico('**`((CO))`** → **Checkout / opciones**');
  assert.equal(combinado.texto, '((CO)) → Checkout / opciones');
  assert.deepEqual(combinado.codigo.map((r) => combinado.texto.slice(r.inicio, r.fin)), ['((CO))']);
  assert.deepEqual(combinado.negritas.map((r) => combinado.texto.slice(r.inicio, r.fin)), ['((CO))', 'Checkout / opciones']);

  // backtick sin cerrar → texto plano, sin romper la línea (ni la negrita ya resuelta)
  const roto = construirRico('**ok** y `sin cerrar queda igual');
  assert.equal(roto.texto, 'ok y `sin cerrar queda igual');
  assert.equal(roto.codigo.length, 0);
  assert.deepEqual(roto.negritas, [{ inicio: 0, fin: 2 }]);
});

test('la leyenda de conectores también limpia los backticks de la descripción', () => {
  const doc = analizarDocumento('- `((XX))` → `Pantalla` de **pago**\n');
  assert.equal(doc.leyendaConectores.XX, 'Pantalla de pago');
});

test('regression: el .md original produce las mismas 6 cards en orden vía analizarDocumento', () => {
  const doc = analizarDocumento(md);
  assert.equal(doc.estrategia, 'atx');
  assert.equal(doc.diagramas.length, 1);
  assert.ok(doc.diagramas[0].codigo.includes('flowchart TD'));
  assert.equal(doc.diagramas[0].titulo, 'Diagram');
  assert.equal(doc.avisos.length, 0);

  const cards = doc.secciones;
  assert.equal(cards.length, 6); // la sección Diagram queda vacía al remover el bloque y no genera card
  assert.deepEqual(cards.map((c) => c.tipo), ['titulo', 'flow', 'steps', 'decision', 'edgeCases', 'assumptions']);

  assert.equal(cards[0].titulo, 'User Flow — Compra de jeans sin sesión iniciada');
  assert.equal(cards[0].lineas.length, 1); // el blockquote como subtítulo
  assert.ok(cards[0].lineas[0].texto.startsWith('Deliverable de interaction design'));

  assert.equal(cards[1].lineas.length, 6); // los 6 pares clave-valor, sin doble marcado
  assert.ok(cards[1].lineas[0].texto.startsWith('• **Type:**'));

  assert.equal(cards[2].lineas.length, 8);
  assert.ok(cards[2].lineas[0].texto.startsWith('1. **[User]**'));

  assert.equal(cards[3].lineas.filter((l) => l.sangria === 0).length, 5); // D1–D5
  assert.equal(cards[3].lineas.filter((l) => l.sangria === 1).length, 11); // sub-bullets

  assert.equal(cards[4].lineas.length, 8);
  assert.equal(cards[5].lineas.length, 5);
  assert.ok(cards[5].lineas[0].texto.includes('**Validar con producto.**'));
});

test('sección conocida presente pero vacía genera card vacía; sin diagrama no es error', () => {
  const minimo = '# Título\n\n> subtítulo\n\n---\n\n### Decision points\n';
  const doc = analizarDocumento(minimo);
  assert.equal(doc.diagramas.length, 0); // sin diagrama: resultado válido
  assert.equal(doc.secciones.length, 2);
  assert.equal(doc.secciones[1].tipo, 'decision');
  assert.equal(doc.secciones[1].lineas.length, 0); // presente pero vacía → placeholder al renderizar
});

test('.txt con líneas etiqueta: mismas secciones y mismo diagrama que el .md', () => {
  const doc = analizarDocumento(txt);
  assert.equal(doc.estrategia, 'etiqueta');
  assert.deepEqual(doc.secciones.map((s) => s.tipo), ['titulo', 'flow', 'steps', 'decision', 'edgeCases', 'assumptions']);

  const flow = doc.secciones[1];
  assert.equal(flow.lineas.length, 6);
  assert.equal(flow.lineas[0].texto, '**Type:** user flow'); // clave-valor sin markdown → bold igual

  assert.equal(doc.secciones[2].lineas.length, 8); // los 8 steps
  assert.equal(doc.secciones[3].lineas.filter((l) => l.sangria === 1).length, 11);

  // el bloque flowchart sin cercar se detecta igual (sin heading ATX cerca)
  assert.equal(doc.diagramas.length, 1);
  assert.equal(doc.diagramas[0].titulo, null);
});

test('texto plano sin estructura: una sola card con todo y sin diagrama', () => {
  const doc = analizarDocumento(notas, 'notas-sin-estructura');
  assert.equal(doc.estrategia, 'sin-estructura');
  assert.equal(doc.diagramas.length, 0);
  assert.equal(doc.secciones.length, 1);
  assert.equal(doc.secciones[0].titulo, 'notas-sin-estructura');
  assert.ok(doc.secciones[0].lineas.some((l) => l.texto.includes('checkout de invitados')));
});

test('_edge.md: 5 bloques mermaid sin heading "Diagram" → uno por bloque, con su heading', () => {
  const doc = analizarDocumento(edgeMd);
  assert.equal(doc.estrategia, 'atx');
  assert.equal(doc.diagramas.length, 5); // ya no se descartan: uno por bloque
  assert.equal(doc.avisos.length, 0);
  assert.equal(doc.diagramas[0].titulo, '1. Flujo principal (happy path)');
  assert.equal(doc.diagramas[1].titulo, '2. Flujo alterno — Autenticación durante el checkout');

  assert.equal(doc.secciones[0].tipo, 'titulo');
  assert.ok(doc.secciones.some((s) => s.tipo === 'generica' && s.titulo.includes('Convención visual')));
  // ningún mermaid crudo quedó adentro de una card
  for (const s of doc.secciones) {
    for (const l of s.lineas) {
      assert.ok(!l.texto.includes('-->'), `mermaid crudo en card "${s.titulo}"`);
    }
  }
});

test('flujos FLW0N: heading-con-diagrama, numeración limpiada y scope por niveles', () => {
  const doc = analizarDocumento(edgeMd);
  // 5 flujos, en orden, con la numeración inicial removida del título
  assert.equal(doc.diagramas[0].flujo.id, 'FLW01');
  assert.equal(doc.diagramas[0].flujo.titulo, 'Flujo principal (happy path)');
  assert.equal(doc.diagramas[0].flujo.label, 'FLW01 - Flujo principal (happy path)');
  assert.equal(doc.diagramas[4].flujo.id, 'FLW05');

  // secciones globales (mismo nivel que los flujos o antes del primero): sin flujo
  const porTitulo = new Map(doc.secciones.map((s) => [s.titulo, s]));
  assert.equal(porTitulo.get('Convención visual (leyenda)')!.flujo, null);
  assert.equal(porTitulo.get('Checklist de revisión aplicado')!.flujo, null);
  // la sección que ES el heading del flujo lleva su propio flujo
  const seccionFlujo1 = porTitulo.get('1. Flujo principal (happy path)');
  if (seccionFlujo1) assert.equal(seccionFlujo1.flujo!.id, 'FLW01');

  // los headings de flujo NO pasan por el clasificador de alias: "edge cases"
  // o "errores" en el título del flujo no los convierte en sección conocida
  for (const titulo of ['3. Flujo de edge cases', '4. Flujo de errores del sistema', '5. Flujo de errores del usuario']) {
    const s = porTitulo.get(titulo)!;
    assert.equal(s.tipo, 'generica', `"${titulo}" debería ser generica`);
    assert.ok(s.flujo !== null);
  }
});

test('esResumenFlow: reconoce la sección Flow clásica y los metadatos bajo el H1', () => {
  const doc = analizarDocumento(edgeMd);
  const titulo = doc.secciones.find((s) => s.tipo === 'titulo')!;
  assert.ok(esResumenFlow(titulo)); // "**User story:** ..." etc. como texto corrido

  const docMd = analizarDocumento(md);
  const flow = docMd.secciones.find((s) => s.tipo === 'flow')!;
  assert.ok(esResumenFlow(flow));
  const steps = docMd.secciones.find((s) => s.tipo === 'steps')!;
  assert.ok(!esResumenFlow(steps));
});

test('un solo flujo: todo el contenido pertenece a FLW01 (prefijo siempre)', () => {
  const doc = analizarDocumento(md);
  assert.equal(doc.diagramas[0].flujo.id, 'FLW01');
  assert.equal(doc.diagramas[0].flujo.titulo, 'Diagram'); // el heading más cercano disponible
  for (const s of doc.secciones) {
    assert.equal(s.flujo!.id, 'FLW01');
  }
});

test('leyenda de conectores: "`((ID))` → **Descripción**" parseada y limpiada', () => {
  const doc = analizarDocumento(edgeMd);
  assert.deepEqual(doc.leyendaConectores, {
    CO: 'Checkout / opciones de autenticación',
    PAY: 'Pantalla de pago',
    REV: 'Revisión y confirmación del pedido',
    OK: 'Confirmación de pedido',
  });
  // archivo sin leyenda → diccionario vacío, sin error
  assert.deepEqual(analizarDocumento(md).leyendaConectores, {});
});

test('tablas markdown: parseadas a bloques con headers/filas, sin pipes en el texto', () => {
  const doc = analizarDocumento(edgeMd);
  const checklist = doc.secciones.find((s) => s.titulo === 'Checklist de revisión aplicado')!;
  const tablas = checklist.bloques.filter((b) => b.tipo === 'tabla');
  assert.equal(tablas.length, 1);
  const tabla = tablas[0].tipo === 'tabla' ? tablas[0].tabla : null;
  assert.deepEqual(tabla!.headers, ['Criterio', 'Estado', 'Cómo se cumple']);
  assert.equal(tabla!.filas.length, 6);
  assert.equal(tabla!.filas[0][0], 'Un objetivo por flujo');
  // el texto plano de la card (lineas) ya no arrastra las filas con pipes
  assert.ok(!checklist.lineas.some((l) => l.texto.includes('|---')));
});

test('tabla irregular: filas ajustadas al header con aviso; <br/> en celdas', () => {
  const avisos: string[] = [];
  const doc = analizarDocumento('### Checklist\n\n| A | B |\n|---|---|\n| solo una celda |\n| x<br/>y | z | extra |\n');
  const tabla = doc.secciones[0].bloques.find((b) => b.tipo === 'tabla')!;
  if (tabla.tipo !== 'tabla') throw new Error('no es tabla');
  assert.deepEqual(tabla.tabla.filas[0], ['solo una celda', '']); // rellenada
  assert.deepEqual(tabla.tabla.filas[1], ['x\ny', 'z']);          // truncada + <br/> normalizado
  assert.equal(doc.avisos.filter((a) => a.includes('column')).length, 2);
});

test('bullets con patrón CA se convierten en tabla de 3 columnas', () => {
  const doc = analizarDocumento(edgeMd);
  const cobertura = doc.secciones.find((s) => s.titulo === 'Cobertura de criterios de aceptación')!;
  const tabla = cobertura.bloques.find((b) => b.tipo === 'tabla')!;
  if (tabla.tipo !== 'tabla') throw new Error('no es tabla');
  assert.deepEqual(tabla.tabla.headers, ['CA', 'Description', 'Reference']); // idioma default: en
  assert.equal(tabla.tabla.filas.length, 6);
  assert.deepEqual(tabla.tabla.filas[0], ['CA1', 'invitado inicia compra', 'Flujo 1, nodos K–L']);

  // bullet que no matchea → fila cruda + aviso, sin descartar la tabla
  const conRaro = analizarDocumento('### Cobertura\n\n- **CA1** (a) → r1\n- **CA2** (b) -> r2\n- bullet raro\n');
  const t2 = conRaro.secciones[0].bloques.find((b) => b.tipo === 'tabla')!;
  if (t2.tipo !== 'tabla') throw new Error('no es tabla');
  assert.equal(t2.tabla.filas.length, 3);
  assert.deepEqual(t2.tabla.filas[2], ['bullet raro', '', '']);
  assert.equal(conRaro.avisos.length, 1);
});

test('regression: secciones sin tablas tienen un único bloque de texto igual a lineas', () => {
  const doc = analizarDocumento(md);
  for (const s of doc.secciones) {
    assert.ok(s.bloques.every((b) => b.tipo === 'texto'));
    assert.deepEqual(s.lineas, s.bloques.length === 1 && s.bloques[0].tipo === 'texto' ? s.bloques[0].lineas : s.lineas);
  }
});

test('diagrama sin cercar y sin headings: diagrama + una card genérica con el resto', () => {
  const doc = analizarDocumento('Notas previas de contexto\n\nflowchart TD\nA[a] --> B[b]\n');
  assert.equal(doc.estrategia, 'sin-estructura');
  assert.equal(doc.diagramas.length, 1);
  assert.ok(doc.diagramas[0].codigo.includes('A[a]'));
  assert.equal(doc.diagramas[0].titulo, null);
  assert.equal(doc.secciones.length, 1);
  assert.equal(doc.secciones[0].titulo, 'Content'); // idioma default: inglés
  assert.equal(doc.secciones[0].lineas[0].texto, 'Notas previas de contexto');

  const docEs = analizarDocumento('solo texto\n', undefined, 'es');
  assert.equal(docEs.secciones[0].titulo, 'Contenido');
});

test('headings Setext: se detectan como estrategia propia', () => {
  const doc = analizarDocumento('Mi flujo\n========\n\nintro\n\n---\n\nSteps del proceso\n-----------------\n\n1. paso uno\n');
  assert.equal(doc.estrategia, 'setext');
  assert.equal(doc.secciones.length, 2);
  assert.equal(doc.secciones[0].tipo, 'titulo');
  assert.deepEqual(doc.secciones[0].lineas, [{ sangria: 0, texto: 'intro' }]);
  assert.equal(doc.secciones[1].tipo, 'steps');
  assert.deepEqual(doc.secciones[1].lineas, [{ sangria: 0, texto: '1. paso uno' }]);
});

test('varios bloques mermaid cercados: usa el primero y avisa', () => {
  const doc = analizarDocumento('```mermaid\nflowchart TD\nA[uno]\n```\n\ntexto suelto\n\n```mermaid\nflowchart TD\nB[dos]\n```\n');
  assert.equal(doc.diagramas.length, 2); // ambos bloques, en orden
  assert.ok(doc.diagramas[0].codigo.includes('A[uno]'));
  assert.equal(doc.avisos.length, 0);
  assert.equal(doc.secciones.length, 1); // el texto restante, como card única
});
