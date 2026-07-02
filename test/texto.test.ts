// Tests de utilidades de texto. Correr con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLineBreaks } from '../src/texto.ts';

test('normalizeLineBreaks convierte todas las variantes de <br> en \\n', () => {
  assert.equal(normalizeLineBreaks('a<br>b'), 'a\nb');
  assert.equal(normalizeLineBreaks('a<br/>b'), 'a\nb');
  assert.equal(normalizeLineBreaks('a<br />b'), 'a\nb');
  assert.equal(normalizeLineBreaks('a<BR/>b<Br>c'), 'a\nb\nc');
  assert.equal(normalizeLineBreaks('sin saltos'), 'sin saltos');
});
