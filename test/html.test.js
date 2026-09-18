import test from 'node:test';
import assert from 'node:assert/strict';

import { extractDocument, extractLinks } from '../src/html.js';

const PAGE = `<!DOCTYPE html>
<html>
<head>
  <title>Getting started · Orbital Docs</title>
  <meta name="description" content="Install Orbital in five minutes.">
</head>
<body>
  <header class="site-header"><nav><a href="/docs/">Docs</a></nav></header>
  <main>
    <h1>Getting started</h1>
    <p>Orbital ships as a <strong>single</strong> binary &amp; has no daemon.</p>
    <ul>
      <li>Install it</li>
      <li>Initialise a file</li>
    </ul>
    <pre><code class="language-bash">orbital init ./telemetry.odb</code></pre>
    <p>Read the <a href="/docs/api/reference.html">API reference</a> next.</p>
  </main>
  <aside class="promo">Buy our cloud plan</aside>
  <footer><p>&copy; 2026 Orbital Labs</p></footer>
  <script>console.log('tracking');</script>
</body>
</html>`;

test('page chrome is dropped and content survives', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.ok(doc.markdown.includes('# Getting started'));
  assert.ok(doc.markdown.includes('single'));
  assert.ok(doc.markdown.includes('orbital init ./telemetry.odb'));
  assert.ok(!doc.markdown.includes('Buy our cloud plan'));
  assert.ok(!doc.markdown.includes('tracking'));
  assert.ok(!doc.markdown.includes('Orbital Labs'));
});

test('title and description are extracted', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.equal(doc.title, 'Getting started · Orbital Docs');
  assert.equal(doc.description, 'Install Orbital in five minutes.');
});

test('entities are decoded and code fences keep their language', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.ok(doc.markdown.includes('binary & has no daemon'));
  assert.ok(doc.markdown.includes('```bash'));
});

test('list items become markdown bullets', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.ok(doc.markdown.includes('- Install it'));
  assert.ok(doc.markdown.includes('- Initialise a file'));
});

test('relative links are resolved against the page url', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.ok(doc.markdown.includes('[API reference](https://example.com/docs/api/reference.html)'));
});

test('link discovery uses the whole page, including the nav', () => {
  const doc = extractDocument(PAGE, { url: 'https://example.com/docs/guide/getting-started.html' });
  assert.ok(doc.links.includes('https://example.com/docs'));
  assert.ok(doc.links.includes('https://example.com/docs/api/reference.html'));
});

test('anchors, mail links and javascript urls are not treated as pages', () => {
  const html = `<a href="#section">x</a><a href="mailto:a@b.com">y</a><a href="javascript:void(0)">z</a>`;
  assert.deepEqual(extractLinks(html, 'https://example.com/'), []);
});

test('a base tag redirects relative resolution', () => {
  const html = `<head><base href="https://cdn.example.com/"></head><a href="page.html">p</a>`;
  assert.deepEqual(extractLinks(html, 'https://example.com/'), ['https://cdn.example.com/page.html']);
});

test('links inside a card do not produce nested heading markup', () => {
  const html = `<main><a href="/x"><h3>Card title</h3><p>Card body</p></a></main>`;
  const doc = extractDocument(html, { url: 'https://example.com/' });
  assert.ok(doc.markdown.includes('Card title'));
  assert.ok(doc.markdown.includes('](https://example.com/x)'));
  assert.ok(!doc.markdown.includes('[###'));
});

test('unbalanced emphasis markers are cleaned up', () => {
  const html = `<main><p>before <strong>bold</p></main>`;
  const doc = extractDocument(html, { url: 'https://example.com/' });
  const markers = doc.markdown.match(/\*\*/g) ?? [];
  assert.equal(markers.length % 2, 0);
});

test('an empty document does not throw', () => {
  const doc = extractDocument('', {});
  assert.equal(doc.markdown, '');
  assert.deepEqual(doc.links, []);
});
