import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createServer } from '../src/mcp-runtime.js';
import { buildIndex } from '../src/search.js';
import { bundleServer } from '../src/bundle.js';

const PAGES = [
  {
    url: 'https://example.com/docs/',
    path: 'index.md',
    title: 'Orbital DB',
    description: 'An embeddable database.',
    markdown: '# Orbital DB\n\nOrbital is an embeddable time-series database for edge devices.',
  },
  {
    url: 'https://example.com/docs/guide/config.html',
    path: 'guide/config.md',
    title: 'Configuration',
    description: 'Options.',
    markdown: '# Configuration\n\n## Memory\n\nThe memory budget defaults to 8mb and retention defaults to 30d.',
  },
];

/**
 * @returns {{dir: string, server: ReturnType<typeof createServer>}}
 */
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hanmcp-mcp-'));
  mkdirSync(path.join(dir, 'docs', 'guide'), { recursive: true });
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify(buildIndex(PAGES, { source: 'https://example.com/docs/' })));
  for (const page of PAGES) {
    writeFileSync(path.join(dir, 'docs', page.path), page.markdown, 'utf8');
  }
  return { dir, server: createServer({ dir, name: 'Orbital docs', version: '9.9.9' }) };
}

test('initialize echoes the requested protocol version and advertises tools', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
  });
  assert.equal(response.result.protocolVersion, '2025-03-26');
  assert.deepEqual(response.result.capabilities.tools, { listChanged: false });
  assert.equal(response.result.serverInfo.name, 'Orbital docs');
  assert.equal(response.result.serverInfo.version, '9.9.9');
});

test('initialize falls back to a default protocol version', () => {
  const { server } = fixture();
  const response = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(response.result.protocolVersion, '2025-06-18');
});

test('notifications never get a response', () => {
  const { server } = fixture();
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(server.handle({ jsonrpc: '2.0', id: null, method: 'tools/list' }), null);
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'something/else' }), null);
});

test('ping answers with an empty result', () => {
  const { server } = fixture();
  assert.deepEqual(server.handle({ jsonrpc: '2.0', id: 7, method: 'ping' }).result, {});
});

test('tools/list exposes three tools with schemas', () => {
  const { server } = fixture();
  const tools = server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ['search_docs', 'get_doc', 'list_docs']);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.ok(tool.description.length > 20);
  }
});

test('search_docs returns passages with source urls', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: 'memory budget' } },
  });
  const text = response.result.content[0].text;
  assert.equal(response.result.isError, undefined);
  assert.ok(text.includes('guide/config.md'));
  assert.ok(text.includes('https://example.com/docs/guide/config.html'));
});

test('search_docs rejects an empty query', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: '  ' } },
  });
  assert.equal(response.result.isError, true);
});

test('search_docs clamps the limit', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'search_docs', arguments: { query: 'or', limit: 9999 } },
  });
  assert.ok(response.result.content[0].text.length > 0);
});

test('get_doc reads the markdown file', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'get_doc', arguments: { path: 'guide/config.md' } },
  });
  assert.ok(response.result.content[0].text.includes('memory budget defaults to 8mb'));
});

test('get_doc refuses path traversal', () => {
  const { server } = fixture();
  for (const candidate of ['../index.json', '/etc/passwd', 'guide/../../x.md', '']) {
    const response = server.handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'get_doc', arguments: { path: candidate } },
    });
    assert.equal(response.result.isError, true, `expected ${candidate} to be rejected`);
  }
});

test('get_doc falls back to the index when a file was deleted', () => {
  const { dir, server } = fixture();
  rmSync(path.join(dir, 'docs', 'guide', 'config.md'));
  const response = server.handle({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'get_doc', arguments: { path: 'guide/config.md' } },
  });
  assert.ok(response.result.content[0].text.includes('memory budget'));
});

test('list_docs lists every page', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'list_docs', arguments: {} },
  });
  const text = response.result.content[0].text;
  assert.ok(text.includes('2 pages'));
  assert.ok(text.includes('index.md'));
  assert.ok(text.includes('guide/config.md'));
});

test('an unknown tool is reported as a tool error, not a protocol crash', () => {
  const { server } = fixture();
  const response = server.handle({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: { name: 'nope', arguments: {} },
  });
  assert.equal(response.result.isError, true);
});

test('an unknown method produces a json-rpc error', () => {
  const { server } = fixture();
  const response = server.handle({ jsonrpc: '2.0', id: 11, method: 'resources/list', params: {} });
  assert.equal(response.error.code, -32601);
});

test('a malformed message is ignored instead of throwing', () => {
  const { server } = fixture();
  assert.equal(server.handle(null), null);
  assert.equal(server.handle({ jsonrpc: '2.0' }), null);
  assert.equal(server.handle('nope'), null);
});

test('the bundled server inlines the runtime instead of importing it', () => {
  const source = bundleServer({ name: 'x', version: '1.2.3' });
  assert.ok(source.startsWith('#!/usr/bin/env node'));
  assert.ok(!source.includes("from './"));
  assert.ok(source.includes("from 'node:fs'"));
  assert.ok(source.includes('createServer({ dir: HANMCP_DIR, name: "x", version: "1.2.3" })'));
  assert.ok(source.includes('new URL('));
  assert.ok(!source.includes('export function'));
});
