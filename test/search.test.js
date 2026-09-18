import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIndex, searchIndex, splitIntoChunks, listDocuments } from '../src/search.js';

const PAGES = [
  {
    url: 'https://example.com/docs/',
    path: 'index.md',
    title: 'Orbital DB Documentation',
    description: 'An embeddable time-series database.',
    markdown: [
      '# Orbital DB',
      '',
      'Orbital is an embeddable time-series database for edge devices.',
      '',
      '## Design constraints',
      '',
      'Total memory stays under 8 MB and the write path never blocks longer than a millisecond.',
    ].join('\n'),
  },
  {
    url: 'https://example.com/docs/guide/configuration.html',
    path: 'guide/configuration.md',
    title: 'Configuration',
    description: 'Every option and its default.',
    markdown: [
      '# Configuration',
      '',
      '## Options',
      '',
      'The retention option defaults to 30d. The memory-budget option defaults to 8mb.',
      '',
      '## Durability',
      '',
      'Setting fsync to interval trades durability for write throughput.',
    ].join('\n'),
  },
  {
    url: 'https://example.com/docs/zh/index.html',
    path: 'zh/index.md',
    title: '快速上手',
    description: '中文快速上手。',
    markdown: [
      '# 快速上手',
      '',
      '## 内存占用怎么估算',
      '',
      '内存预算不是软限制，Orbital 会在启动时一次性预留，超出容器限制就直接拒绝启动。',
    ].join('\n'),
  },
];

const index = buildIndex(PAGES, { source: 'https://example.com/docs/' });

test('a section becomes its own passage, addressable by its title', () => {
  const markdown = [
    '# Page',
    '',
    'An introductory sentence that belongs to the page, not to any section.',
    '',
    '## 索引内存占用怎么估算',
    '',
    '中文分词会显著放大索引体积，三百页中文文档的索引大约在 3 到 6 MB 之间。',
    '',
    '## Unrelated closing section',
    '',
    'A closing note.',
  ].join('\n');
  const chunks = splitIntoChunks(markdown);
  const section = chunks.find((chunk) => chunk.includes('索引内存占用怎么估算'));
  // The lead sentence stays with the page title; the section is separate.
  assert.ok(section !== undefined);
  assert.ok(!section.includes('An introductory sentence'));
  assert.ok(section.includes('3 到 6 MB'));
});

test('a section directly under the page title still splits', () => {
  const markdown = [
    '# Page',
    '',
    'A one-line lead-in under the title.',
    '',
    '## First section',
    '',
    'Body text of the first section.',
  ].join('\n');
  const chunks = splitIntoChunks(markdown);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes('A one-line lead-in'));
  assert.ok(chunks[1].startsWith('## First section'));
});

test('a heading with no body above it does not start a passage of its own', () => {
  const markdown = ['# Page', '', '## First section', '', 'Body text.'].join('\n');
  const chunks = splitIntoChunks(markdown);
  // `# Page` and `## First section` are adjacent with no body between them, so
  // there is nothing to separate — one passage carries both headings.
  assert.equal(chunks.length, 1);
});

test('chunking splits on headings rather than raw length', () => {
  const chunks = splitIntoChunks(PAGES[1].markdown, 200);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 260));
});

test('a very long single line is hard split', () => {
  const chunks = splitIntoChunks('x'.repeat(2000), 300);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 320));
});

test('index stats reflect the input', () => {
  assert.equal(index.stats.pages, 3);
  assert.equal(index.docs.length, 3);
  assert.ok(index.stats.chunks >= 3);
  assert.ok(index.stats.terms > 50);
  assert.ok(index.stats.averageLength > 0);
});

test('english queries find the right page', () => {
  const [top] = searchIndex(index, 'retention default', 3);
  assert.equal(top.path, 'guide/configuration.md');
});

test('chinese queries find the chinese page', () => {
  const [top] = searchIndex(index, '内存占用怎么估算', 3);
  assert.equal(top.path, 'zh/index.md');
  assert.ok(top.score > 1);
});

test('a phrase match outranks a bag-of-words match', () => {
  const results = searchIndex(index, 'memory budget', 3);
  assert.ok(results.length >= 1);
  assert.equal(results[0].path, 'guide/configuration.md');
});

test('chunking starts a new chunk at a heading once the current chunk is long', () => {
  const filler = 'word '.repeat(120);
  const chunks = splitIntoChunks(`# A\n\n${filler}\n\n## B\n\n${filler}`, 900);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[1].startsWith('## B'));
});

test('every hit carries a heading', () => {
  const results = searchIndex(index, 'durability', 3);
  assert.ok(results.length >= 1);
  assert.ok(results[0].heading.length > 0);
});

test('results carry a snippet and a source url', () => {
  const [top] = searchIndex(index, 'millisecond', 1);
  assert.ok(top.snippet.length > 0);
  assert.equal(top.url, 'https://example.com/docs/');
});

test('the limit is respected and clamped', () => {
  assert.ok(searchIndex(index, 'option', 1).length <= 1);
  assert.ok(searchIndex(index, 'option', 99).length <= index.stats.chunks);
  assert.ok(searchIndex(index, 'option', 0).length >= 1);
});

test('unknown terms return nothing instead of everything', () => {
  assert.deepEqual(searchIndex(index, 'zzzzqqqq', 5), []);
});

test('an empty query returns nothing', () => {
  assert.deepEqual(searchIndex(index, '   ', 5), []);
});

test('listDocuments is sorted by path', () => {
  const paths = listDocuments(index).map((doc) => doc.path);
  assert.deepEqual(paths, [...paths].sort());
  assert.ok(paths.includes('zh/index.md'));
});

test('scoring is deterministic across rebuilds', () => {
  const again = buildIndex(PAGES, { source: 'https://example.com/docs/' });
  const first = searchIndex(index, 'retention', 3).map((hit) => hit.path);
  const second = searchIndex(again, 'retention', 3).map((hit) => hit.path);
  assert.deepEqual(first, second);
});
