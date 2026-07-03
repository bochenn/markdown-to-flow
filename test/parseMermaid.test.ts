// Tests simples contra el archivo de ejemplo original. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsearFlowchart, hexARgb } from '../src/parseMermaid.ts';
import {
  calcularLayout,
  posicionarOffPath,
  esOffPath,
  esFlujoDenso,
  descomponerEnRamas,
  agruparEnCarriles,
  descomposicionATabla,
  SEPARACION_MIN_COLUMNA,
  SEPARACION_MIN_FILA,
} from '../src/layoutDiagram.ts';
import {
  resolverEstilo,
  rutaElbow,
  puntoMedioRuta,
  pathElbow,
  segmentoCruzaCaja,
  crearContextoRuteo,
  rutaEvitandoObstaculos,
} from '../src/renderFigma.ts';
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

  // la clase de error pisa la variante base Y el classDef del archivo
  const conError = parsearFlowchart('flowchart TD\nclassDef error fill:#123456\nA[falla]:::error\n');
  const error = resolverEstilo(conError.nodos.get('A')!, conError.classDefs);
  assert.deepEqual(error.estilo.fill, hexARgb('#FFE2E0'));
  assert.deepEqual(error.estilo.stroke, hexARgb('#BD2915'));
  assert.deepEqual(error.estilo.texto, { r: 0, g: 0, b: 0 }); // negro; el 90% va en el paint
});

test('rutaElbow: recta si están alineados, Z si hay desplazamiento, rodeo en retornos', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };

  // alineados verticalmente → recta simple, sin codo artificial
  const alineado = rutaElbow(a, { x: 0, y: 150, width: 100, height: 50 });
  assert.equal(alineado.length, 2);
  assert.deepEqual(alineado[0], { x: 50, y: 50 });

  // desplazado → Z de 4 puntos con tramo horizontal a mitad de camino
  const z = rutaElbow(a, { x: 200, y: 150, width: 100, height: 50 });
  assert.equal(z.length, 4);
  assert.deepEqual(z[0], { x: 50, y: 50 });    // sale por abajo del origen
  assert.deepEqual(z[3], { x: 250, y: 150 });  // entra por arriba del destino
  assert.equal(z[1].y, z[2].y);                // codo horizontal
  assert.equal(z[1].y, 100);                   // a mitad del hueco vertical

  // retorno (destino arriba) → rodea por la derecha, sin atravesar la columna
  const retorno = rutaElbow(a, { x: 0, y: -200, width: 100, height: 50 });
  assert.equal(retorno.length, 4);
  assert.equal(retorno[0].x, 100);             // sale por el borde derecho
  assert.ok(retorno[1].x >= 100 + 60);         // desvío más allá de las formas
  assert.equal(retorno[1].x, retorno[2].x);    // tramo vertical del rodeo
});

test('pathElbow redondea codos con radio adaptativo; puntoMedioRuta camina el recorrido', () => {
  const puntos = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }];
  const d = pathElbow(puntos, 8);
  assert.ok(d.includes('Q 0 100'), 'curva en el codo');
  assert.ok(d.startsWith('M 0 0 L 0 92'), 'corta el radio antes del codo');

  // tramo corto (10px): el radio se reduce a la mitad del tramo
  const corto = pathElbow([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 200, y: 10 }], 8);
  assert.ok(corto.includes('L 0 5 Q 0 10 5 10'));

  // largo total 300 → la mitad (150) cae 50px adentro del tramo horizontal
  assert.deepEqual(puntoMedioRuta(puntos), { x: 50, y: 100 });
});

test('rutaEvitandoObstaculos: sin cruce queda la default; con cruce desvía por carril', () => {
  const origen = { x: 400, y: 0, width: 100, height: 50 };
  const destino = { x: 0, y: 300, width: 100, height: 50 };
  const enMedio = { x: 150, y: 125, width: 100, height: 50 }; // pisa el tramo horizontal de la Z default

  // sin contexto o sin colisión → exactamente la ruta default (regression de adyacentes)
  assert.equal(rutaEvitandoObstaculos(origen, destino).lado, null);
  const lejano = crearContextoRuteo([origen, destino, { x: 2000, y: 2000, width: 50, height: 50 }]);
  const sinCruce = rutaEvitandoObstaculos(origen, destino, lejano);
  assert.equal(sinCruce.lado, null);
  assert.deepEqual(sinCruce.puntos, rutaElbow(origen, destino));

  // con un nodo en el medio → desvío de 6 puntos por el carril
  const ctx = crearContextoRuteo([origen, destino, enMedio]);
  const ruta = rutaEvitandoObstaculos(origen, destino, ctx);
  assert.ok(ruta.lado !== null);
  assert.equal(ruta.puntos.length, 6);
  // criterio programático de aceptación: la ruta final no cruza el obstáculo
  for (let i = 1; i < ruta.puntos.length; i++) {
    assert.ok(
      !segmentoCruzaCaja(ruta.puntos[i - 1], ruta.puntos[i], enMedio, 4),
      `el tramo ${i} cruza el obstáculo`,
    );
  }
  // el carril queda fuera del diagrama
  const xCarril = ruta.puntos[2].x;
  assert.ok(xCarril > 500 || xCarril < 0);

  // segundo conector: o comparte carril corrido 24px (con la banda separada),
  // o directamente elige el carril opuesto ahora que evalúa ambos lados
  const ruta2 = rutaEvitandoObstaculos(origen, destino, ctx);
  assert.ok(ruta2.lado !== null);
  if (ruta2.lado === ruta.lado) {
    assert.equal(Math.abs(ruta2.puntos[2].x - xCarril), 24);
    assert.ok(Math.abs(ruta2.puntos[1].y - ruta.puntos[1].y) >= 20, 'la banda de salida debe separarse');
  } else {
    assert.notEqual(Math.sign(ruta2.puntos[2].x - 250), Math.sign(xCarril - 250)); // carriles opuestos
  }

  // ruta default (sin desvío) que pisa la franja de otra: también se corre
  const solos = crearContextoRuteo([origen, destino]);
  const primera = rutaEvitandoObstaculos(origen, destino, solos);
  const segunda = rutaEvitandoObstaculos(origen, destino, solos);
  assert.ok(Math.abs(segunda.puntos[1].y - primera.puntos[1].y) >= 20);
  // y un conector solo en su franja queda exactamente como la ruta elbow default
  const unico = crearContextoRuteo([origen, destino]);
  assert.deepEqual(rutaEvitandoObstaculos(origen, destino, unico).puntos, rutaElbow(origen, destino));
});

test('esFlujoDenso: FLW01/02 simples, FLW03/04/05 densos (fan-out > 4)', () => {
  const diagramas = analizarDocumento(edgeMd).diagramas;
  const esperado = [false, false, true, true, true];
  diagramas.forEach((d, i) => {
    assert.equal(esFlujoDenso(parsearFlowchart(d.codigo)), esperado[i], d.flujo.id);
  });
});

test('descomponerEnRamas: FLW03 en 6 tarjetas con reingresos y preámbulo', () => {
  const diagramas = analizarDocumento(edgeMd).diagramas;
  const desc = descomponerEnRamas(parsearFlowchart(diagramas[2].codigo))!;
  assert.ok(desc !== null);
  assert.equal(desc.preambulo.length, 2); // Disparador → "Tipo de edge case" (hub)
  assert.equal(desc.preambulo[1].forma, 'decision');
  assert.equal(desc.ramas.length, 6);

  const porTitulo = new Map(desc.ramas.map((r) => [r.titulo, r]));
  const talla = porTitulo.get('Talla se agota mientras está en carrito')!;
  assert.deepEqual(talla.filas.map((f) => f.tipo), ['paso', 'paso', 'reingreso']);
  assert.ok(talla.filas[2].texto.includes('CO'));

  const precio = porTitulo.get('Cambió el precio antes de pagar')!;
  assert.ok(precio.filas.some((f) => f.tipo === 'decision'));
  assert.ok(precio.filas.some((f) => f.tipo === 'reingreso' && f.label === 'Sí'));

  // grafo sin hub (lineal) → null, cae a Classic
  assert.equal(descomponerEnRamas(parsearFlowchart('flowchart TD\nA[a] --> B[b]\nB --> C[c]\n')), null);

  // ids en orden DFS para los mini-flujos de Swimlanes
  assert.deepEqual(talla.ids, ['B', 'B1', 'CO']);
});

test('descomposicionATabla: FLW03 en 6 filas con proceso, desenlaces y reingreso', () => {
  const diagramas = analizarDocumento(edgeMd).diagramas;
  const desc = descomponerEnRamas(parsearFlowchart(diagramas[2].codigo))!;
  const tabla = descomposicionATabla(desc, 'es');
  assert.deepEqual(tabla.headers, ['Disparador', 'Qué hace el sistema', 'Resultado', 'Reingresa a']);
  assert.equal(tabla.filas.length, 6);

  const porTrigger = new Map(tabla.filas.map((f) => [f[0], f]));
  const precio = porTrigger.get('Cambió el precio antes de pagar')!;
  assert.ok(precio[1].includes('Acepta nuevo precio?')); // la decisión queda en "qué hace"
  assert.equal(precio[2], 'No: Vuelve al carrito');
  assert.equal(precio[3], 'Sí: Reingresa a REV');

  // rama con decisión de dos desenlaces sin reingreso → ambos en "Resultado"
  const sesion = porTrigger.get('Sesión de invitado expira por inactividad')!;
  assert.ok(sesion[2].includes('Sí:') && sesion[2].includes(' / ') && sesion[2].includes('No:'));
  assert.equal(sesion[3], '—');

  // rama lineal: último paso como resultado
  const talla = porTrigger.get('Talla se agota mientras está en carrito')!;
  assert.equal(talla[2], 'Ofrece tallas alternativas o quitar ítem');
  assert.equal(talla[3], 'Reingresa a CO');
});

test('agruparEnCarriles: FLW03 por primer reingreso, y duplicar reparte las ramas multi-reingreso', () => {
  const diagramas = analizarDocumento(edgeMd).diagramas;
  const desc = descomponerEnRamas(parsearFlowchart(diagramas[2].codigo))!;
  const carriles = agruparEnCarriles(desc, false);
  const resumen = new Map(carriles.map((c) => [c.clave, c.ramas.length]));
  assert.equal(resumen.get('Reingresa a CO'), 2);   // talla agotada + email con cuenta
  assert.equal(resumen.get('Reingresa a REV'), 1);  // cambio de precio
  assert.equal(resumen.get(null), 3);               // los que terminan sin reingresar
  assert.equal(carriles[carriles.length - 1].clave, null); // "sin reingreso" siempre al final

  // rama sintética con dos reingresos → con duplicar aparece en ambos carriles
  const grafo = parsearFlowchart(
    'flowchart TD\nS([s]) --> H{hub}\nH -->|a| P1[p1]\nH -->|b| P2[p2]\nP1 --> D{ok?}\nD -->|Sí| R1(((CO)))\nD -->|No| R2(((REV)))\nP2 --> R3(((CO)))\n',
  );
  const desc2 = descomponerEnRamas(grafo)!;
  const unico = agruparEnCarriles(desc2, false);
  assert.equal(unico.filter((c) => c.ramas.some((r) => r.titulo === 'a')).length, 1);
  const duplicado = agruparEnCarriles(desc2, true);
  assert.equal(duplicado.filter((c) => c.ramas.some((r) => r.titulo === 'a')).length, 2);
});

test('barycenter: FLW03 (flujo denso) queda sin cruces de conectores', () => {
  const flw03 = analizarDocumento(edgeMd).diagramas[2];
  const grafo = parsearFlowchart(flw03.codigo);
  const posiciones = calcularLayout(grafo);

  // cuenta cruces entre aristas rectas centro a centro (sin extremos compartidos)
  const orientacion = (p: {x:number;y:number}, q: {x:number;y:number}, r: {x:number;y:number}) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const segmentos = grafo.edges
    .filter((e) => posiciones.has(e.origen) && posiciones.has(e.destino))
    .map((e) => ({ a: posiciones.get(e.origen)!, b: posiciones.get(e.destino)!, e }));
  let cruces = 0;
  for (let i = 0; i < segmentos.length; i++) {
    for (let j = i + 1; j < segmentos.length; j++) {
      const s = segmentos[i], t = segmentos[j];
      if (s.e.origen === t.e.origen || s.e.origen === t.e.destino || s.e.destino === t.e.origen || s.e.destino === t.e.destino) continue;
      if (orientacion(s.a, s.b, t.a) !== orientacion(s.a, s.b, t.b)
        && orientacion(t.a, t.b, s.a) !== orientacion(t.a, t.b, s.b)) cruces++;
    }
  }
  assert.equal(cruces, 0); // el layout anterior tenía 7
});

test('ruta recta que pisa una franja ocupada se convierte en U-jog corrido', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };
  const b = { x: 400, y: 0, width: 100, height: 50 };
  const ctx = crearContextoRuteo([a, b]);
  const primera = rutaEvitandoObstaculos(a, b, ctx);
  assert.equal(primera.puntos.length, 2); // recta simple, registra su franja
  const segunda = rutaEvitandoObstaculos(a, b, ctx);
  assert.equal(segunda.puntos.length, 6); // U-jog con la banda corrida
  assert.ok(Math.abs(segunda.puntos[2].y - primera.puntos[0].y) >= 20, 'la banda del jog debe separarse de la recta');
});

test('el desvío evalúa ambos carriles: elige el lado libre/corto y esquiva badges registrados', () => {
  const origen = { x: 0, y: 0, width: 100, height: 50 };
  const destino = { x: 0, y: 300, width: 100, height: 50 };
  const medio = { x: 0, y: 150, width: 100, height: 40 };    // bloquea la vertical directa
  const lejano = { x: 2000, y: 150, width: 50, height: 40 }; // hace carísimo el carril derecho
  const ctx = crearContextoRuteo([origen, destino, medio, lejano]);
  const ruta = rutaEvitandoObstaculos(origen, destino, ctx);
  assert.equal(ruta.lado, 'izquierda'); // el carril derecho quedó a 2000px: gana el corto

  // un "badge" registrado a posteriori también cuenta como obstáculo
  ctx.obstaculos.push({ x: -60, y: 140, width: 50, height: 22 }); // badge sobre el carril izquierdo
  const ruta2 = rutaEvitandoObstaculos(origen, destino, ctx);
  for (let i = 1; i < ruta2.puntos.length; i++) {
    assert.ok(
      !segmentoCruzaCaja(ruta2.puntos[i - 1], ruta2.puntos[i], { x: -60, y: 140, width: 50, height: 22 }, 4),
      'la ruta no debe atravesar el badge registrado',
    );
  }
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
