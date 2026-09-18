/**
 * End-to-end: crawl a real fixture site over HTTP, build the artifacts, then
 * spawn the generated `server.mjs` and speak real JSON-RPC to it over stdio.
 *
 * The unit tests cover each module in isolation; this file is the one that
 * fails if the pieces stop fitting together.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startFixtureServer, startSiteServer } from '../demo/fixture-server.js';
import { callMcpServer } from '../demo/mcp-client.js';
import { buildProject } from '../src/build.js';

/**
 * @returns {Promise<{outDir: string, manifest: object, close: () => Promise<void>}>}
 */
async function buildFixture() {
  const fixture = await startFixtureServer();
  const outDir = mkdtempSync(path.join(tmpdir(), 'hanmcp-e2e-'));
  try {
    const manifest = await buildProject({
      url: `${fixture.origin}/docs/`,
      out: outDir,
      maxDepth: 2,
      force: true,
    });
    return { outDir, manifest, close: fixture.close };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}

test('a full build crawls the fixture site and writes every artifact', async () => {
  const { outDir, manifest, close } = await buildFixture();
  try {
    for (const file of ['index.json', 'llms.txt', 'llms-full.txt', 'server.mjs', 'manifest.json', '.hanmcp']) {
      assert.ok(existsSync(path.join(outDir, file)), `expected ${file} to exist`);
    }
    assert.equal(manifest.name, 'Orbital DB Documentation');
    assert.ok(manifest.stats.pages >= 5);
    assert.ok(manifest.stats.chunks > 0);
    assert.ok(manifest.stats.terms > 0);
    assert.equal(manifest.generator, 'hanmcp');
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('robots.txt is honoured during a real crawl', async () => {
  const { outDir, manifest, close } = await buildFixture();
  try {
    const paths = manifest.pages.map((page) => page.path);
    assert.ok(
      !paths.some((entry) => entry.includes('roadmap')),
      `robots-disallowed page leaked into the build: ${paths.join(', ')}`,
    );
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('percent-encoded cjk paths become readable filenames, not hex', async () => {
  const { outDir, manifest, close } = await buildFixture();
  try {
    const cjk = manifest.pages.find((page) => page.path.includes('内存'));
    assert.ok(cjk, `expected a decoded cjk path, got: ${manifest.pages.map((p) => p.path).join(', ')}`);
    assert.equal(cjk.path, 'zh/内存调优.md');
    assert.ok(existsSync(path.join(outDir, 'docs', 'zh', '内存调优.md')));
    // The regression this guards against: `%E5%86%85...` slugged into `e5-86-85-...`.
    assert.ok(!manifest.pages.some((page) => /(?:^|\/)[0-9a-f]{2}-[0-9a-f]{2}-[0-9a-f]{2}/.test(page.path)));
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('llms.txt links to source urls and drops the repeated title suffix', async () => {
  const { outDir, close } = await buildFixture();
  try {
    const text = readFileSync(path.join(outDir, 'llms.txt'), 'utf8');
    assert.ok(text.startsWith('# Orbital DB Documentation\n'));
    assert.ok(text.includes('## Guide'));
    // Titles like `Getting started · Orbital Docs` must not repeat in the index.
    assert.ok(!text.includes('· Orbital Docs'));
    assert.match(text, /- \[Getting started\]\(http:\/\/127\.0\.0\.1:\d+\/docs\/guide\/getting-started\.html\)/);
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('llms-full.txt inlines the whole corpus', async () => {
  const { outDir, close } = await buildFixture();
  try {
    const text = readFileSync(path.join(outDir, 'llms-full.txt'), 'utf8');
    assert.ok(text.includes('Source:'));
    assert.ok(text.includes('fsync'));
    assert.ok(text.includes('内存预算'), 'cjk body text must survive extraction');
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the generated server answers a real mcp handshake over stdio', async () => {
  const { outDir, close } = await buildFixture();
  try {
    const { responses, stderr } = await callMcpServer(path.join(outDir, 'server.mjs'), [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_docs', arguments: { query: '内存预算', limit: 2 } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_doc', arguments: { path: 'zh/内存调优.md' } } },
    ]);

    assert.equal(responses.length, 4, `stderr: ${stderr.slice(0, 400)}`);

    assert.equal(responses[0].result.serverInfo.name, 'Orbital DB Documentation');
    assert.equal(responses[0].result.protocolVersion, '2025-06-18');
    assert.deepEqual(
      responses[1].result.tools.map((tool) => tool.name),
      ['search_docs', 'get_doc', 'list_docs'],
    );

    // A Chinese query must actually retrieve Chinese content — the whole point.
    const searchText = responses[2].result.content[0].text;
    assert.equal(responses[2].result.isError, undefined);
    assert.ok(searchText.includes('内存'), `search returned nothing useful: ${searchText.slice(0, 200)}`);

    assert.ok(responses[3].result.content[0].text.includes('内存预算'));

    // stdout must carry nothing but JSON-RPC; human logs belong on stderr. A
    // stray `console.log` in the runtime would corrupt the stream, so the
    // client records anything it could not parse.
    assert.ok(stderr.includes('ready:'), 'expected a startup banner on stderr');
    assert.ok(!stderr.includes('[unparseable]'), 'non-JSON-RPC output leaked onto stdout');
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the generated server refuses to read outside its docs directory', async () => {
  const { outDir, close } = await buildFixture();
  try {
    const { responses } = await callMcpServer(path.join(outDir, 'server.mjs'), [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_doc', arguments: { path: '../index.json' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_doc', arguments: { path: '/etc/passwd' } } },
    ]);
    assert.equal(responses[0].result.isError, true);
    assert.equal(responses[1].result.isError, true);
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

/**
 * The demo recording crawls hanmcp's own documentation in `site/`. That site is
 * edited far more often than the frozen fixture, so it gets its own checks —
 * otherwise a documentation change could quietly break the demo while every
 * other test stays green.
 * @returns {Promise<{outDir: string, manifest: object, close: () => Promise<void>}>}
 */
async function buildSite() {
  const site = await startSiteServer();
  const outDir = mkdtempSync(path.join(tmpdir(), 'hanmcp-site-'));
  try {
    const manifest = await buildProject({
      url: `${site.origin}/docs/`,
      out: outDir,
      maxDepth: 2,
      force: true,
    });
    return { outDir, manifest, close: site.close };
  } catch (error) {
    await site.close();
    throw error;
  }
}

test('the demo site builds cleanly and is wired up the way the demo assumes', async () => {
  const { outDir, manifest, close } = await buildSite();
  try {
    // The demo shows a short page list; if the site grows a lot the crawl gets
    // slower and the 30-second recording stops fitting.
    assert.ok(manifest.stats.pages >= 5, `expected at least 5 pages, got ${manifest.stats.pages}`);
    assert.ok(manifest.stats.pages <= 12, `site grew to ${manifest.stats.pages} pages; revisit the demo pacing`);
    assert.equal(manifest.name, 'hanmcp Documentation');

    // The `skip` line the demo holds on only appears because the site links to
    // a page that robots.txt disallows. Remove either half and the demo loses
    // its cheapest credibility signal.
    const paths = manifest.pages.map((page) => page.path);
    assert.ok(
      !paths.some((entry) => entry.includes('private')),
      `robots-disallowed page leaked into the demo build: ${paths.join(', ')}`,
    );
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the demo query lands on the matching section, not the page intro', async () => {
  const { outDir, close } = await buildSite();
  try {
    const { responses } = await callMcpServer(path.join(outDir, 'server.mjs'), [
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_docs', arguments: { query: '索引内存占用怎么估算', limit: 1 } } },
    ]);
    const text = responses[0].result.content[0].text;

    // This is the shot the whole demo is built around. If the section is no
    // longer its own passage, the answer degrades to the top of the Chinese
    // page — still Chinese, but no longer proof of precise retrieval.
    assert.ok(
      text.includes('## 索引内存占用怎么估算'),
      `the demo query no longer lands on its section:\n${text.slice(0, 500)}`,
    );
    assert.ok(text.includes('二元组'), 'expected the indexed section body, not a summary');
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the demo site keeps its chinese page readable and indexable', async () => {
  const { outDir, manifest, close } = await buildSite();
  try {
    const chinese = manifest.pages.find((page) => page.path === 'zh.md');
    assert.ok(chinese, `expected zh.md, got: ${manifest.pages.map((p) => p.path).join(', ')}`);
    assert.ok(chinese.title.includes('中文文档'), `unexpected chinese page title: ${chinese.title}`);

    // One page must not be indexed under two paths. The site links to the
    // Chinese docs both as `/docs/zh/` and (from itself) as `/docs/zh/index.html`.
    const aliases = manifest.pages.filter((page) => page.path.startsWith('zh'));
    assert.equal(aliases.length, 1, `chinese page indexed twice: ${aliases.map((p) => p.path).join(', ')}`);
  } finally {
    await close();
    rmSync(outDir, { recursive: true, force: true });
  }
});
