// Tests del diccionario de idiomas. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../src/i18n.ts';

test('t() devuelve el texto en el idioma pedido', () => {
  assert.equal(t('canvas.seccionDocs', 'en'), 'Documentation');
  assert.equal(t('canvas.seccionDocs', 'es'), 'Documentación');
  assert.equal(t('canvas.cardSteps', 'en'), 'Steps');
  assert.equal(t('canvas.cardSteps', 'es'), 'Pasos');
});

test('t() interpola variables', () => {
  assert.equal(t('status.diagramas', 'en', { flows: 5, total: 92 }), 'Diagram: 5 flow(s) detected, 92 nodes total.');
  assert.equal(t('status.diagramas', 'es', { flows: 5, total: 92 }), 'Diagrama: 5 flujo(s) detectado(s), 92 nodos en total.');
  assert.equal(
    t('status.docs', 'en', { known: 4, extra: t('status.docsExtra', 'en', { count: 1, names: "'Notas'" }) }),
    "Documentation: 4 of 6 known sections found + 1 additional section(s) ('Notas').",
  );
});

test('t() con clave inexistente devuelve la clave (nunca string vacío)', () => {
  assert.equal(t('clave.que.no.existe', 'es'), 'clave.que.no.existe');
});
