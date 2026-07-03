// Layout top-down: niveles por BFS desde las raíces. Las aristas hacia nodos
// ya visitados (ciclos, como L --> I) se ignoran, así el cálculo nunca entra
// en loop infinito y el nodo "vuelve" a una fila superior solo con su conector.

import type { Grafo, Nodo } from './parseMermaid.ts';

// Clases mermaid que sacan un nodo del camino feliz cuando el toggle
// "separar edge cases" está activo. Extensible: ['error', 'optional', 'offramp'].
export const OFF_PATH_CLASSES = ['error'];

export function esOffPath(nodo: Nodo): boolean {
  return nodo.clases.some((c) => OFF_PATH_CLASSES.indexOf(c) !== -1);
}

// Las posiciones son el CENTRO de cada celda: el render ubica cada forma
// restando la mitad de su tamaño (las formas ahora tienen tamaños variables).
export const ESPACIADO_X = 400; // el preset más ancho (rombo largo) mide 320
export const ESPACIADO_Y = 300; // el preset más alto (rombo largo) mide 200

// Dirección elegida en el panel; tiene prioridad sobre la del mermaid.
// vertical = niveles en filas (Y); horizontal = niveles en columnas (X).
export type Direccion = 'vertical' | 'horizontal';

export interface Posicion {
  x: number;
  y: number;
  nivel: number;
}

// `excluir` (opcional) saca nodos del cálculo como si no existieran: sus
// aristas se ignoran, así el happy path no deja huecos donde estaban.
export function calcularLayout(grafo: Grafo, excluir?: Set<string>, direccion: Direccion = 'vertical'): Map<string, Posicion> {
  const ids = Array.from(grafo.nodos.keys()).filter((id) => !excluir || !excluir.has(id));
  const salientes = new Map<string, string[]>();
  const entrantes = new Map<string, number>();
  for (const id of ids) {
    salientes.set(id, []);
    entrantes.set(id, 0);
  }
  for (const e of grafo.edges) {
    if (!salientes.has(e.origen) || !salientes.has(e.destino)) continue;
    salientes.get(e.origen)!.push(e.destino);
    entrantes.set(e.destino, entrantes.get(e.destino)! + 1);
  }

  const nivel = new Map<string, number>();
  function bfs(inicio: string, nivelInicial: number) {
    if (nivel.has(inicio)) return;
    nivel.set(inicio, nivelInicial);
    const cola = [inicio];
    while (cola.length > 0) {
      const actual = cola.shift()!;
      for (const destino of salientes.get(actual)!) {
        if (!nivel.has(destino)) {
          nivel.set(destino, nivel.get(actual)! + 1);
          cola.push(destino);
        }
      }
    }
  }

  const maxNivel = () => Math.max(-1, ...Array.from(nivel.values()));

  // Raíces: nodos sin aristas entrantes pero con salientes (si todo es ciclo,
  // arrancamos del primero declarado). Los huérfanos no cuentan como raíz.
  const conEdges = ids.filter((id) => salientes.get(id)!.length > 0 || entrantes.get(id)! > 0);
  const raices = conEdges.filter((id) => entrantes.get(id) === 0);
  for (const raiz of raices.length > 0 ? raices : conEdges.slice(0, 1)) bfs(raiz, 0);

  // Componentes cíclicos no alcanzados: filas nuevas debajo de todo.
  for (const id of conEdges) {
    if (!nivel.has(id)) bfs(id, maxNivel() + 1);
  }

  // Huérfanos (sin ninguna arista): todos juntos en una fila aparte al final.
  const filaHuerfanos = maxNivel() + 1;
  for (const id of ids) {
    if (!nivel.has(id)) nivel.set(id, filaHuerfanos);
  }

  // Ordenar cada nivel minimizando cruces (barycenter, familia Sugiyama) y
  // repartir con espaciado adaptativo: los niveles densos respiran más.
  const filas = ordenarPorBarycenter(ids, nivel, grafo);

  const posiciones = new Map<string, Posicion>();
  const espacioCruzadoBase = direccion === 'vertical' ? ESPACIADO_X : ESPACIADO_Y;
  filas.forEach((fila, n) => {
    const reales = fila.filter((id) => !esDummy(id)).length;
    const espacio = reales >= 5 ? espacioCruzadoBase * 1.25 : espacioCruzadoBase;
    fila.forEach((id, i) => {
      if (esDummy(id)) return; // los dummies solo participan del ordenamiento
      const cruzado = (i - (fila.length - 1) / 2) * espacio;
      posiciones.set(id, direccion === 'vertical'
        ? { x: cruzado, y: n * ESPACIADO_Y, nivel: n }
        : { x: n * ESPACIADO_X, y: cruzado, nivel: n });
    });
  });
  return posiciones;
}

const esDummy = (id: string) => id.charCodeAt(0) === 126; // '~'

// Minimización de cruces por barycenter: en cada pasada, cada nivel se
// reordena según la posición promedio de sus vecinos en el nivel de al lado
// (bajada y subida, ×4). Los edges que saltan más de un nivel se expanden con
// nodos dummy que ocupan lugar en los niveles intermedios — participan del
// ordenamiento (y del espaciado) pero no se posicionan: el trazado real de
// esos edges largos lo resuelve el carril anti-obstáculos del render.
function ordenarPorBarycenter(ids: string[], nivelBase: Map<string, number>, grafo: Grafo): string[][] {
  let maxNivel = 0;
  for (const n of nivelBase.values()) maxNivel = Math.max(maxNivel, n);

  const niveles = new Map(nivelBase);
  const aristas: [string, string][] = [];
  const dummies: string[] = [];
  let nDummy = 0;
  for (const e of grafo.edges) {
    const na = niveles.get(e.origen);
    const nb = niveles.get(e.destino);
    if (na === undefined || nb === undefined) continue; // nodos excluidos (off-path)
    if (Math.abs(nb - na) <= 1) {
      aristas.push([e.origen, e.destino]);
      continue;
    }
    const paso = nb > na ? 1 : -1;
    let previo = e.origen;
    for (let n = na + paso; n !== nb; n += paso) {
      const d = '~' + nDummy++;
      niveles.set(d, n);
      dummies.push(d);
      aristas.push([previo, d]);
      previo = d;
    }
    aristas.push([previo, e.destino]);
  }

  const filas: string[][] = [];
  for (let n = 0; n <= maxNivel; n++) filas.push([]);
  for (const id of ids) filas[niveles.get(id)!].push(id); // orden inicial: declaración
  for (const d of dummies) filas[niveles.get(d)!].push(d);

  const vecinos = new Map<string, string[]>();
  const agregarVecino = (a: string, b: string) => {
    const lista = vecinos.get(a);
    if (lista) lista.push(b);
    else vecinos.set(a, [b]);
  };
  for (const [a, b] of aristas) {
    agregarVecino(a, b);
    agregarVecino(b, a);
  }

  const indice = new Map<string, number>();
  const reindexar = () => {
    for (const fila of filas) fila.forEach((id, i) => indice.set(id, i));
  };
  reindexar();

  const ordenar = (fila: string[], nivelVecino: number) => {
    const bary = new Map<string, number>();
    for (const id of fila) {
      const vs = (vecinos.get(id) || []).filter((v) => niveles.get(v) === nivelVecino);
      bary.set(id, vs.length === 0
        ? indice.get(id)! // sin vecinos de ese lado: conserva su lugar
        : vs.reduce((suma, v) => suma + indice.get(v)!, 0) / vs.length);
    }
    fila.sort((a, b) => bary.get(a)! - bary.get(b)!);
    reindexar();
  };

  for (let pasada = 0; pasada < 4; pasada++) {
    for (let n = 1; n <= maxNivel; n++) ordenar(filas[n], n - 1);
    for (let n = maxNivel - 1; n >= 0; n--) ordenar(filas[n], n + 1);
  }
  return filas;
}

export const SEPARACION_MIN_COLUMNA = 220;          // centro a centro en Y (alturas ≤ 200)
export const SEPARACION_MIN_FILA = 340;             // centro a centro en X (anchos ≤ 320)
export const OFFSET_COLUMNA_OFFPATH = ESPACIADO_X + 150; // ≈250px de aire entre bordes reales

// Ubica los nodos off-path fuera del flujo principal: columna a la derecha en
// modo vertical, fila debajo en modo horizontal. Cada uno hereda la posición
// (Y o X según dirección) del nodo principal que origina su rama (caminando
// hacia atrás por predecesores off-path si es una cadena de errores); los
// solapamientos se resuelven empujando lo mínimo necesario.
export function posicionarOffPath(
  grafo: Grafo,
  offPath: Set<string>,
  principal: Map<string, Posicion>,
  direccion: Direccion = 'vertical',
): Map<string, Posicion> {
  const vertical = direccion === 'vertical';
  let maxEje = 0; // x en vertical (columna a la derecha), y en horizontal (fila debajo)
  for (const p of principal.values()) maxEje = Math.max(maxEje, vertical ? p.x : p.y);
  const posicionFija = maxEje + OFFSET_COLUMNA_OFFPATH;
  const separacionMin = vertical ? SEPARACION_MIN_COLUMNA : SEPARACION_MIN_FILA;

  function origenPrincipal(id: string, visitados: Set<string>): string | null {
    if (visitados.has(id)) return null;
    visitados.add(id);
    for (const e of grafo.edges) {
      if (e.destino === id && principal.has(e.origen)) return e.origen;
    }
    for (const e of grafo.edges) {
      if (e.destino === id && offPath.has(e.origen)) {
        const encontrado = origenPrincipal(e.origen, visitados);
        if (encontrado) return encontrado;
      }
    }
    return null; // huérfano u offramp sin origen: va al tope de la columna
  }

  const ids = Array.from(grafo.nodos.keys()).filter((id) => offPath.has(id));
  const orden = new Map<string, number>();
  ids.forEach((id, i) => orden.set(id, i));

  const tentativos = ids.map((id) => {
    const origen = origenPrincipal(id, new Set());
    const pos = origen ? principal.get(origen)! : null;
    return { id, valor: pos ? (vertical ? pos.y : pos.x) : 0 };
  });
  tentativos.sort((a, b) => a.valor - b.valor || orden.get(a.id)! - orden.get(b.id)!);

  const posiciones = new Map<string, Posicion>();
  let anterior = -Infinity;
  for (const t of tentativos) {
    const valor = Math.max(t.valor, anterior + separacionMin);
    posiciones.set(t.id, vertical
      ? { x: posicionFija, y: valor, nivel: -1 }  // nivel -1 = fuera del happy path
      : { x: valor, y: posicionFija, nivel: -1 });
    anterior = valor;
  }
  return posiciones;
}
