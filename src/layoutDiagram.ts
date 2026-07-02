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

export interface Posicion {
  x: number;
  y: number;
  nivel: number;
}

// `excluir` (opcional) saca nodos del cálculo como si no existieran: sus
// aristas se ignoran, así el happy path no deja huecos donde estaban.
export function calcularLayout(grafo: Grafo, excluir?: Set<string>): Map<string, Posicion> {
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

  // Agrupar por nivel (en orden de declaración) y repartir en X centrado en 0.
  const porNivel = new Map<number, string[]>();
  for (const id of ids) {
    const n = nivel.get(id)!;
    const fila = porNivel.get(n);
    if (fila) fila.push(id);
    else porNivel.set(n, [id]);
  }

  const posiciones = new Map<string, Posicion>();
  for (const [n, fila] of porNivel) {
    fila.forEach((id, i) => {
      posiciones.set(id, {
        x: (i - (fila.length - 1) / 2) * ESPACIADO_X,
        y: n * ESPACIADO_Y,
        nivel: n,
      });
    });
  }
  return posiciones;
}

export const SEPARACION_MIN_COLUMNA = 220;          // centro a centro, dentro de la columna off-path
export const OFFSET_COLUMNA_OFFPATH = ESPACIADO_X + 150; // ≈250px de aire entre bordes reales

// Ubica los nodos off-path en una columna a la derecha del flujo principal.
// Cada uno hereda el Y del nodo principal que origina su rama (caminando hacia
// atrás por predecesores off-path si es una cadena de errores); los
// solapamientos se resuelven empujando hacia abajo lo mínimo necesario.
export function posicionarOffPath(
  grafo: Grafo,
  offPath: Set<string>,
  principal: Map<string, Posicion>,
): Map<string, Posicion> {
  let maxX = 0;
  for (const p of principal.values()) maxX = Math.max(maxX, p.x);
  const columnaX = maxX + OFFSET_COLUMNA_OFFPATH;

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
    return { id, y: origen ? principal.get(origen)!.y : 0 };
  });
  tentativos.sort((a, b) => a.y - b.y || orden.get(a.id)! - orden.get(b.id)!);

  const posiciones = new Map<string, Posicion>();
  let yAnterior = -Infinity;
  for (const t of tentativos) {
    const y = Math.max(t.y, yAnterior + SEPARACION_MIN_COLUMNA);
    posiciones.set(t.id, { x: columnaX, y, nivel: -1 }); // nivel -1 = fuera del happy path
    yAnterior = y;
  }
  return posiciones;
}
