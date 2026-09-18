#!/usr/bin/env node
/**
 * Portability gate for CI.
 *
 * The README claims that `server.mjs`, `index.json` and `docs/` are all you
 * need to move a built index to another machine. Every other test in this repo
 * runs the server *inside* the output directory, where the rest of the tree is
 * still reachable — so none of them would notice if the generated server
 * quietly depended on something outside its bundle.
 *
 * This script copies only those three things into a bare temporary directory,
 * deletes nothing else because there is nothing else, and then performs a real
 * JSON-RPC handshake over stdio.
 */

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startFixtureServer } from '../demo/fixture-server.js';
import { callMcpServer } from '../demo/mcp-client.js';
import { buildProject } from '../src/build.js';

const PORTABLE = ['server.mjs', 'index.json', 'docs'];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const built = mkdtempSync(path.join(tmpdir(), 'hanmcp-built-'));
  const bare = mkdtempSync(path.join(tmpdir(), 'hanmcp-bare-'));
  const fixture = await startFixtureServer();

  try {
    const manifest = await buildProject({
      url: `${fixture.origin}/docs/`,
      out: built,
      maxDepth: 2,
      force: true,
    });

    // Copy the three portable artifacts and nothing else.
    for (const entry of PORTABLE) {
      cpSync(path.join(built, entry), path.join(bare, entry), { recursive: true });
    }

    const { responses, stderr } = await callMcpServer(path.join(bare, 'server.mjs'), [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'portable', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_docs', arguments: { query: '内存预算', limit: 1 } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_doc', arguments: { path: '../manifest.json' } } },
    ]);

    const problems = [];
    if (responses.length !== 3) {
      problems.push(`expected 3 responses, got ${responses.length}. stderr: ${stderr.slice(0, 300)}`);
    } else {
      if (responses[0].result?.serverInfo?.name === undefined) {
        problems.push('initialize did not report serverInfo');
      }
      const searchText = responses[1].result?.content?.[0]?.text ?? '';
      if (!searchText.includes('内存')) {
        problems.push(`search returned no cjk content from the bare bundle: ${searchText.slice(0, 160)}`);
      }
      if (responses[2].result?.isError !== true) {
        problems.push('path traversal out of the bare bundle was not rejected');
      }
    }

    if (problems.length > 0) {
      for (const problem of problems) {
        fail(`portable bundle check failed: ${problem}`);
      }
      return;
    }

    process.stdout.write(
      `portable bundle ok: ${manifest.stats.pages} pages, ${manifest.stats.chunks} passages, served from a bare directory\n`,
    );
  } finally {
    await fixture.close();
    rmSync(built, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
}

main().catch((error) => {
  fail(`portable bundle check crashed: ${error instanceof Error ? error.stack : String(error)}`);
});
