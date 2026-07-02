// Tests simples contra el archivo de ejemplo original. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extraerMermaid, parsearFlowchart, hexARgb } from '../src/parseMermaid.ts';
import { calcularLayout, posicionarOffPath, esOffPath, SEPARACION_MIN_COLUMNA } from '../src/layoutDiagram.ts';
import { resolverEstilo } from '../src/renderFigma.ts';

const md = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado.md', import.meta.url), 'utf8');
const mmd = readFileSync(new URL('../Resources/user-flow-compra-jeans-diagrama.mmd', import.meta.url), 'utf8');

test('extrae el bloque mermaid de la sección ### Diagram', () => {
  const { codigo, warnings } = extraerMermaid(md);
  assert.ok(codigo.includes('flowchart TD'));
  assert.equal(warnings.length, 0);
});

test('falla con mensaje claro si no hay sección Diagram o bloque mermaid', () => {
  assert.throws(() => extraerMermaid('# Solo un título'), /### Diagram/);
  assert.throws(() => extraerMermaid('### Diagram\n\nsin bloque'), /mermaid/);
});

test('avisa si hay más de un bloque mermaid y usa el primero', () => {
  const doble = '### Diagram\n\n```mermaid\nflowchart TD\n  A[uno]\n```\n\n```mermaid\nflowchart TD\n  B[dos]\n```\n';
  const { codigo, warnings } = extraerMermaid(doble);
  assert.ok(codigo.includes('A[uno]'));
  assert.equal(warnings.length, 1);
});

test('parsea los 22 nodos con sus formas y clases', () => {
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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

test('tolera líneas desconocidas y comentarios sin crashear', () => {
  const grafo = parsearFlowchart('flowchart TD\n%% comentario\nA[uno] --> B[dos]\nesto no es mermaid válido !!\n');
  assert.equal(grafo.nodos.size, 2);
  assert.equal(grafo.warnings.length, 1);
});

test('el layout asigna niveles top-down sin colgarse con ciclos', () => {
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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
  const grafo = parsearFlowchart(extraerMermaid(md).codigo);
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
