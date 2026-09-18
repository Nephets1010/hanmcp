import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLlmsTxt, renderLlmsFullTxt, stripCommonTitleSuffix } from '../src/llms.js';

const PAGES = [
  { path: 'index.md', url: 'https://example.com/docs', title: 'Orbital DB', description: 'An embeddable database.' },
  { path: 'guide/a.md', url: 'https://example.com/docs/guide/a.html', title: 'Getting started · Orbital Docs', description: 'Install it.' },
  { path: 'guide/b.md', url: 'https://example.com/docs/guide/b.html', title: 'Configuration · Orbital Docs', description: '' },
  { path: 'api/c.md', url: 'https://example.com/docs/api/c.html', title: 'API reference · Orbital Docs', description: 'The query surface.' },
];

test('a consistent title suffix is stripped once it dominates the set', () => {
  const result = stripCommonTitleSuffix(PAGES);
  assert.equal(result[0].title, 'Orbital DB');
  assert.equal(result[1].title, 'Getting started');
  assert.equal(result[3].title, 'API reference');
});

test('an inconsistent suffix is left alone', () => {
  const pages = [
    { title: 'A · Docs' },
    { title: 'B | Handbook' },
    { title: 'C — Manual' },
    { title: 'D' },
  ];
  assert.deepEqual(stripCommonTitleSuffix(pages).map((page) => page.title), ['A · Docs', 'B | Handbook', 'C — Manual', 'D']);
});

test('small sets are never rewritten', () => {
  const pages = [{ title: 'A · Docs' }, { title: 'B · Docs' }];
  assert.deepEqual(stripCommonTitleSuffix(pages).map((page) => page.title), ['A · Docs', 'B · Docs']);
});

test('hyphenated page names are not mistaken for a suffix', () => {
  const pages = [
    { title: 'getting-started' },
    { title: 'configuration' },
    { title: 'api-reference' },
  ];
  assert.deepEqual(stripCommonTitleSuffix(pages).map((page) => page.title), ['getting-started', 'configuration', 'api-reference']);
});

test('llms.txt has the expected shape and groups by folder', () => {
  const text = renderLlmsTxt(
    { name: 'Orbital DB', summary: 'An embeddable database.', detail: 'Indexed from example.com.', source: 'https://example.com/docs/' },
    PAGES,
  );
  assert.ok(text.startsWith('# Orbital DB\n'));
  assert.ok(text.includes('> An embeddable database.'));
  assert.ok(text.includes('## Guide'));
  assert.ok(text.includes('## API'));
  assert.ok(text.includes('- [Getting started](https://example.com/docs/guide/a.html): Install it.'));
  assert.ok(text.includes('## About this file'));
});

test('folder names are titleized with acronyms preserved', () => {
  const text = renderLlmsTxt({ name: 'X', summary: 's', source: '' }, [
    { path: 'api-cli/one.md', url: 'https://a.com/1', title: 'One', description: '' },
  ]);
  assert.ok(text.includes('## API CLI'));
});

test('llms-full.txt inlines every page', () => {
  const text = renderLlmsFullTxt(
    { name: 'Orbital DB', summary: 'An embeddable database.', source: 'https://example.com/docs/' },
    [{ url: 'https://example.com/docs', title: 'Orbital DB', markdown: '# Orbital DB\n\nBody text.' }],
  );
  assert.ok(text.includes('## Orbital DB'));
  assert.ok(text.includes('# Orbital DB\n\nBody text.'));
  assert.ok(text.includes('Source: https://example.com/docs/'));
});
