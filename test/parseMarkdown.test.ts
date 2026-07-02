// Tests del parser genérico de secciones y las cards. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  partirEnSecciones,
  buscarSeccion,
  contenidoALineas,
  construirNegritas,
  extraerDocumentacion,
} from '../src/parseMarkdown.ts';

const md = readFileSync(new URL('../Resources/user-flow-compra-jeans-invitado.md', import.meta.url), 'utf8');

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

test('extraerDocumentacion arma las 6 cards en orden con el archivo de ejemplo', () => {
  const { cards, avisos } = extraerDocumentacion(md);
  assert.equal(cards.length, 6);
  assert.equal(avisos.length, 0);

  assert.equal(cards[0].titulo, 'User Flow — Compra de jeans sin sesión iniciada');
  assert.equal(cards[0].lineas.length, 1); // el blockquote como subtítulo
  assert.ok(cards[0].lineas[0].texto.startsWith('Deliverable de interaction design'));

  assert.ok(cards[1].titulo.startsWith('Flow:'));
  assert.equal(cards[1].lineas.length, 6); // los 6 pares clave-valor
  assert.ok(cards[1].lineas[0].texto.startsWith('• **Type:**'));

  assert.equal(cards[2].titulo, 'Steps (happy path)');
  assert.equal(cards[2].lineas.length, 8);
  assert.ok(cards[2].lineas[0].texto.startsWith('1. **[User]**'));

  assert.equal(cards[3].titulo, 'Decision points');
  assert.equal(cards[3].lineas.filter((l) => l.sangria === 0).length, 5); // D1–D5
  assert.equal(cards[3].lineas.filter((l) => l.sangria === 1).length, 11); // sub-bullets

  assert.equal(cards[4].titulo, 'Alternate paths, errors, and edge cases');
  assert.equal(cards[4].lineas.length, 8);

  assert.equal(cards[5].titulo, 'Assumptions and open questions');
  assert.equal(cards[5].lineas.length, 5);
  assert.ok(cards[5].lineas[0].texto.includes('**Validar con producto.**'));
});

test('secciones ausentes se omiten con aviso y las vacías generan card vacía', () => {
  const minimo = '# Título\n\n> subtítulo\n\n---\n\n### Decision points\n\n---\n\n### Diagram\n\n```mermaid\nflowchart TD\n  A[uno]\n```\n';
  const { cards, avisos } = extraerDocumentacion(minimo);
  assert.equal(cards.length, 2); // Título + Decision points
  assert.equal(avisos.length, 4); // Flow, Steps, Alternate, Assumptions
  assert.equal(cards[1].titulo, 'Decision points');
  assert.equal(cards[1].lineas.length, 0); // presente pero vacía
});
