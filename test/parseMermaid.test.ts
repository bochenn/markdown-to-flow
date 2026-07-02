// Tests simples contra el archivo de ejemplo original. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsearFlowchart, hexARgb } from '../src/parseMermaid.ts';
import { calcularLayout, posicionarOffPath, esOffPath, SEPARACION_MIN_COLUMNA, SEPARACION_MIN_FILA } from '../src/layoutDiagram.ts';
import { resolverEstilo } from '../src/renderFigma.ts';
import { analizarDocumento } from '../src/parseMarkdown.ts';

const md = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado.md', import.meta.url), 'utf8');
const mmd = readFileSync(new URL('../Resources/user-flow-compra-jeans-diagrama.mmd', import.meta.url), 'utf8');
const edgeMd = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado_edge.md', import.meta.url), 'utf8');
// la extracción del bloque desde el documento vive en parseMarkdown (analizarDocumento)
const codigoMd = analizarDocumento(md).diagramas[0].codigo;

test('parsea los 22 nodos con sus formas y clases', () => {
  const grafo = parsearFlowchart(codigoMd);
  assert.equal(grafo.direccion, 'TD');
  assert.equal(grafo.nodos.size, 22);
  assert.equal(grafo.warnings.length, 0);

  assert.equal(grafo.nodos.get('A')!.forma, 'inicioFin');
  assert.equal(grafo.nodos.get('V')!.forma, 'inicioFin');
  assert.equal(grafo.nodos.get('B')!.forma, 'proceso');
  assert.equal(grafo.nodos.get('E')!.forma, 'decision');
  assert.equal(grafo.nodos.get('H')!.forma, 'decision');
  assert.equal(grafo.nodos.get('I')!.forma, 'inputOutput');
  assert.equal(grafo.nodos.get('B')!.texto, 'Navega y filtra jeans');
  // el texto del paralelogramo con "/" internos se extrae completo
  assert.equal(grafo.nodos.get('I')!.texto, 'Opciones: Iniciar sesion / Crear cuenta / Invitado');

  for (const id of ['F', 'L', 'Q', 'S']) {
    assert.ok(grafo.nodos.get(id)!.clases.includes('error'), `${id} debería tener clase error`);
  }
  assert.ok(grafo.classDefs.has('error'));
});

test('parsea los edges con labels y el loop de reintento', () => {
  const grafo = parsearFlowchart(codigoMd);
  assert.equal(grafo.edges.length, 28);

  const buscar = (o: string, d: string) => grafo.edges.find((e) => e.origen === o && e.destino === d);
  assert.equal(buscar('E', 'G')!.label, 'Si');
  assert.equal(buscar('E', 'F')!.label, 'No');
  assert.equal(buscar('H', 'I')!.label, 'No');
  assert.equal(buscar('R', 'T')!.label, 'Si');
  assert.equal(buscar('I', 'N')!.label, 'Continuar como invitado');
  assert.ok(buscar('L', 'I'), 'debe existir el loop L --> I');
  assert.equal(buscar('A', 'B')!.label, undefined);
});

test('reconoce el círculo doble (((texto))) y el simple ((texto)) como conector', () => {
  const grafo = parsearFlowchart('flowchart TD\nJ[Login] --> CO(((CO))):::conector\nP[Pago] --> PAY((PAY))\n');
  assert.equal(grafo.warnings.length, 0);
  const co = grafo.nodos.get('CO')!;
  assert.equal(co.forma, 'conector');
  assert.equal(co.texto, 'CO'); // el triple no se matchea como doble con paréntesis colgando
  assert.ok(co.clases.includes('conector'));
  assert.equal(grafo.nodos.get('PAY')!.forma, 'conector');
  assert.equal(grafo.nodos.get('PAY')!.texto, 'PAY');
  assert.ok(grafo.edges.find((e) => e.origen === 'J' && e.destino === 'CO'), 'el edge J --> CO debe existir');
});

test('forma no soportada: rectángulo default + warning, sin perder el edge', () => {
  const grafo = parsearFlowchart(
    'flowchart TD\nA[a] --> H{{Hexágono}}\nB[b] --> S[[Subrutina]]\nC[c] --> D[(Base de datos)]\n',
  );
  assert.equal(grafo.nodos.get('H')!.forma, 'proceso');
  assert.equal(grafo.warnings.length, 3);
  assert.ok(grafo.warnings[0].includes("'H'"));
  assert.ok(grafo.warnings[0].includes('{{Hexágono}}'));

  for (const [id, texto] of [['H', 'Hexágono'], ['S', 'Subrutina'], ['D', 'Base de datos']] as const) {
    assert.equal(grafo.nodos.get(id)!.forma, 'proceso'); // fallback
    assert.equal(grafo.nodos.get(id)!.texto, texto);     // texto limpio, sin delimitadores
  }
  assert.equal(grafo.edges.length, 3); // ningún edge perdido
});

test('los 5 bloques del _edge.md parsean sin líneas perdidas', () => {
  const diagramas = analizarDocumento(edgeMd).diagramas;
  assert.equal(diagramas.length, 5);
  for (const d of diagramas) {
    const grafo = parsearFlowchart(d.codigo);
    const perdidas = grafo.warnings.filter((w) => w.includes('Unrecognized mermaid line'));
    assert.equal(perdidas.length, 0, `líneas perdidas en "${d.titulo}": ${perdidas.join(' | ')}`);
  }
  // los conectores del flujo principal, con sus edges de entrada
  const principal = parsearFlowchart(diagramas[0].codigo);
  assert.equal(principal.nodos.get('CO')!.forma, 'conector');
  assert.ok(principal.edges.find((e) => e.origen === 'J' && e.destino === 'CO'));
  assert.ok(principal.edges.find((e) => e.origen === 'V' && e.destino === 'OK'));
});

test('<br/> en textos y labels de mermaid se vuelve salto de línea real', () => {
  const grafo = parsearFlowchart('flowchart TD\nA[Muestra opciones:<br/>Iniciar sesión] -->|No<br>autenticado| B[b]\n');
  assert.equal(grafo.nodos.get('A')!.texto, 'Muestra opciones:\nIniciar sesión');
  assert.equal(grafo.edges[0].label, 'No\nautenticado');
});

test('tolera líneas desconocidas y comentarios sin crashear', () => {
  const grafo = parsearFlowchart('flowchart TD\n%% comentario\nA[uno] --> B[dos]\nesto no es mermaid válido !!\n');
  assert.equal(grafo.nodos.size, 2);
  assert.equal(grafo.warnings.length, 1);
});

test('el layout asigna niveles top-down sin colgarse con ciclos', () => {
  const grafo = parsearFlowchart(codigoMd);
  const posiciones = calcularLayout(grafo);
  assert.equal(posiciones.size, 22);

  assert.equal(posiciones.get('A')!.nivel, 0);
  assert.equal(posiciones.get('B')!.nivel, 1);
  // el flujo avanza hacia abajo aunque existan los back-edges L-->I, Q-->N, S-->P y F-->C
  assert.ok(posiciones.get('I')!.nivel < posiciones.get('J')!.nivel);
  assert.ok(posiciones.get('N')!.nivel < posiciones.get('O')!.nivel);
  // nodos del mismo nivel comparten Y y no comparten X
  const g = posiciones.get('G')!;
  const f = posiciones.get('F')!;
  assert.equal(g.y, f.y);
  assert.notEqual(g.x, f.x);
});

test('parsea los estilos de classDef en un mapa', () => {
  const grafo = parsearFlowchart(codigoMd);
  assert.deepEqual(grafo.classDefs.get('error'), { fill: '#fde', stroke: '#c33', color: '#900' });

  const conDash = parsearFlowchart('flowchart TD\nA[uno]\nclassDef optional fill:#f3e9ff,stroke:#8e5fd6,stroke-dasharray:4 2;\n');
  assert.equal(conDash.classDefs.get('optional')!.dashed, true);
});

test('soporta la sentencia "class A,B,C nombre;" del .mmd canónico', () => {
  const grafo = parsearFlowchart(mmd);
  assert.equal(grafo.nodos.size, 23); // A–V más el nodo W opcional
  assert.equal(grafo.edges.length, 30);
  assert.equal(grafo.warnings.length, 0);

  for (const id of ['E', 'H', 'K', 'O', 'R']) {
    assert.ok(grafo.nodos.get(id)!.clases.includes('decision'), `${id} debería tener clase decision`);
  }
  for (const id of ['T', 'U', 'V']) {
    assert.ok(grafo.nodos.get(id)!.clases.includes('success'));
  }
  assert.ok(grafo.nodos.get('N')!.clases.includes('guest'));
  assert.deepEqual(grafo.classDefs.get('success'), { fill: '#DCFCE7', stroke: '#16A34A', color: '#166534' });
});

test('hexARgb convierte hex de 3 y 6 dígitos y rechaza inválidos', () => {
  assert.deepEqual(hexARgb('#DCFCE7'), { r: 0xdc / 255, g: 0xfc / 255, b: 0xe7 / 255 });
  assert.deepEqual(hexARgb('#fde'), { r: 1, g: 0xdd / 255, b: 0xee / 255 });
  assert.equal(hexARgb('rojo'), null);
});

test('resolverEstilo aplica el classDef y avisa si la clase no existe', () => {
  const grafo = parsearFlowchart(mmd);

  const conClase = resolverEstilo(grafo.nodos.get('T')!, grafo.classDefs);
  assert.equal(conClase.aviso, null);
  assert.deepEqual(conClase.estilo.fill, hexARgb('#DCFCE7'));

  const sinClase = resolverEstilo(grafo.nodos.get('A')!, grafo.classDefs);
  assert.equal(sinClase.aviso, null); // sin clase → default por forma, sin aviso

  const claseInexistente = parsearFlowchart('flowchart TD\nA[uno]:::fantasma\n');
  const resultado = resolverEstilo(claseInexistente.nodos.get('A')!, claseInexistente.classDefs);
  assert.ok(resultado.aviso !== null && resultado.aviso.includes('fantasma'));
});

test('un nodo huérfano va a una fila aparte', () => {
  const grafo = parsearFlowchart('flowchart TD\nA[uno] --> B[dos]\nX[huérfano]\n');
  const posiciones = calcularLayout(grafo);
  assert.equal(posiciones.size, 3);
  assert.ok(posiciones.get('X')!.nivel > posiciones.get('B')!.nivel);
});

test('calcularLayout con exclusión: el happy path queda sin huecos', () => {
  const grafo = parsearFlowchart(codigoMd);
  const offPath = new Set(Array.from(grafo.nodos.values()).filter(esOffPath).map((n) => n.id));
  assert.deepEqual(Array.from(offPath).sort(), ['F', 'L', 'Q', 'S']);

  const principal = calcularLayout(grafo, offPath);
  assert.equal(principal.size, 18);
  assert.ok(!principal.has('F'));
  // E conserva su fila y G lo sigue directo, sin fila fantasma donde estaba F
  assert.equal(principal.get('G')!.nivel, principal.get('E')!.nivel + 1);
  // no quedan filas vacías: todos los niveles 0..max tienen al menos un nodo
  const niveles = new Set(Array.from(principal.values()).map((p) => p.nivel));
  const maxNivel = Math.max(...niveles);
  for (let n = 0; n <= maxNivel; n++) {
    assert.ok(niveles.has(n), `la fila ${n} quedó vacía`);
  }
});

test('posicionarOffPath alinea cada error con su decisión de origen', () => {
  const grafo = parsearFlowchart(codigoMd);
  const offPath = new Set(['F', 'L', 'Q', 'S']);
  const principal = calcularLayout(grafo, offPath);
  const columna = posicionarOffPath(grafo, offPath, principal);

  assert.equal(columna.size, 4);
  assert.equal(columna.get('F')!.y, principal.get('E')!.y);
  assert.equal(columna.get('S')!.y, principal.get('R')!.y);
  assert.equal(columna.get('L')!.y, principal.get('K')!.y);
  // K y O comparten fila: Q (de O) se empuja lo mínimo para no pisar a L
  assert.equal(columna.get('Q')!.y, columna.get('L')!.y + SEPARACION_MIN_COLUMNA);

  // todos en la misma columna, a la derecha del flujo principal
  let maxX = 0;
  for (const p of principal.values()) maxX = Math.max(maxX, p.x);
  for (const p of columna.values()) {
    assert.equal(p.x, columna.get('F')!.x);
    assert.ok(p.x > maxX);
  }
});

test('layout horizontal: niveles en columnas (X) y filas distribuidas en Y', () => {
  const grafo = parsearFlowchart(codigoMd);
  const posV = calcularLayout(grafo);
  const posH = calcularLayout(grafo, undefined, 'horizontal');

  // mismos niveles en ambas direcciones, solo cambia el eje
  assert.equal(posH.get('B')!.nivel, posV.get('B')!.nivel);
  // A→B avanza en X (no en Y) y comparten fila
  assert.ok(posH.get('B')!.x > posH.get('A')!.x);
  assert.equal(posH.get('B')!.y, posH.get('A')!.y);
  // F y G comparten nivel: misma columna X, distinta Y
  assert.equal(posH.get('F')!.x, posH.get('G')!.x);
  assert.notEqual(posH.get('F')!.y, posH.get('G')!.y);
});

test('posicionarOffPath horizontal: fila debajo, alineada al X de la decisión de origen', () => {
  const grafo = parsearFlowchart(codigoMd);
  const offPath = new Set(['F', 'L', 'Q', 'S']);
  const principal = calcularLayout(grafo, offPath, 'horizontal');
  const fila = posicionarOffPath(grafo, offPath, principal, 'horizontal');

  assert.equal(fila.get('F')!.x, principal.get('E')!.x);
  assert.equal(fila.get('S')!.x, principal.get('R')!.x);
  assert.equal(fila.get('L')!.x, principal.get('K')!.x);
  // K y O comparten columna: Q se empuja en X lo mínimo para no pisar a L
  assert.equal(fila.get('Q')!.x, fila.get('L')!.x + SEPARACION_MIN_FILA);

  // todos en la misma fila, debajo del flujo principal
  let maxY = 0;
  for (const p of principal.values()) maxY = Math.max(maxY, p.y);
  for (const p of fila.values()) {
    assert.equal(p.y, fila.get('F')!.y);
    assert.ok(p.y > maxY);
  }
});

test('cadena de errores se apila desde su origen y el error huérfano va arriba', () => {
  const grafo = parsearFlowchart(
    'flowchart TD\nA[a] --> B{b?}\nB -->|No| E1[e1]:::error\nE1 --> E2[e2]:::error\nX[x]:::error\nclassDef error fill:#fde;\n',
  );
  const offPath = new Set(['E1', 'E2', 'X']);
  const principal = calcularLayout(grafo, offPath);
  const columna = posicionarOffPath(grafo, offPath, principal);

  assert.equal(columna.get('E1')!.y, principal.get('B')!.y); // hereda el Y de B
  assert.equal(columna.get('E2')!.y, columna.get('E1')!.y + SEPARACION_MIN_COLUMNA); // apilado, no anidado
  assert.equal(columna.get('X')!.y, 0); // sin origen: tope de la columna
});
