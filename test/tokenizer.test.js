import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, termFrequency, isCjk } from '../src/tokenizer.js';

test('latin text becomes lowercased word tokens', () => {
  assert.deepEqual(tokenize('Retention Default is 30d'), ['retention', 'default', '30d']);
});

test('stopwords and single characters are dropped from latin text', () => {
  assert.deepEqual(tokenize('a I of the and'), []);
});

test('a cjk run becomes overlapping bigrams', () => {
  assert.deepEqual(tokenize('内存占用'), ['内存', '存占', '占用']);
});

test('a single cjk character is kept as its own token', () => {
  assert.deepEqual(tokenize('库'), ['库']);
});

test('mixed cjk and latin text keeps both token streams', () => {
  const terms = tokenize('Orbital 的 memory 预算');
  assert.ok(terms.includes('orbital'));
  assert.ok(terms.includes('memory'));
  assert.ok(terms.includes('预算'));
  // `的` is space-delimited, so it is a single-character run and kept whole
  // rather than bleeding into the `预算` bigram.
  assert.ok(terms.includes('的'));
  assert.ok(!terms.includes('的预'));
});

test('bigrams do not cross a latin word boundary', () => {
  // No spaces: the CJK run is interrupted by the latin word, so `内存` and
  // `占用` are produced but never `存占`-style bridges across `disk`.
  assert.deepEqual(tokenize('内存disk占用'), ['内存', 'disk', '占用']);
});

test('cjk punctuation separates runs', () => {
  assert.deepEqual(tokenize('内存，占用'), ['内存', '占用']);
});

test('kana is tokenized as bigrams too', () => {
  assert.deepEqual(tokenize('テスト'), ['テス', 'スト']);
});

test('empty and non-string input yields no terms', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize(null), []);
});

test('termFrequency counts repeats', () => {
  const counts = termFrequency('retention retention 保留 retention');
  assert.equal(counts.get('retention'), 3);
  assert.equal(counts.get('保留'), 1);
});

test('isCjk recognises cjk and rejects latin', () => {
  assert.equal(isCjk('中'), true);
  assert.equal(isCjk('a'), false);
  assert.equal(isCjk(' '), false);
});
