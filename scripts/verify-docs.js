#!/usr/bin/env node
/**
 * Keeps the documentation honest about the tool.
 *
 * Two things are checked, both because they rot silently:
 *
 * 1. THE NUMBERS. The README opens with two blocks of output and says, in as
 *    many words, that they are real and not mock-ups. That claim is only worth
 *    anything while the numbers still match what the tool prints — and they
 *    move every time `site/` is edited, because the term count, the index size
 *    and the BM25 score are all functions of the content. This was caught by
 *    hand once, drifting behind a stale port and two renames. A claim nobody
 *    checks is a claim that eventually becomes false.
 *
 * 2. THE FLAGS. Every flag the parser accepts has to appear in four places:
 *    `--help`, both READMEs, and the CLI reference page on the docs site.
 *    `--timeout` was accepted by the parser and documented in none of them, so
 *    the only way to learn it existed was to read the source — and it turned
 *    out nothing downstream used it either.
 *
 * Both sets of facts are deterministic — same content in, same numbers and the
 * same flag list out — which is exactly why they can be asserted.
 *
 * Deliberately not checked: the `done in 0.8s` line. It is wall-clock time and
 * moves on every machine; the README's claim is "fast", not a specific
 * duration. Asserting it would make the gate flaky for no gain.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSiteServer } from '../demo/fixture-server.js';
import { callMcpServer } from '../demo/mcp-client.js';
import { buildProject } from '../src/build.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The demo pins this port so the recording is reproducible, and the README
 * quotes it. If either side moves, they have to move together. */
const PORT = 8904;

/** The same query the README shows, against the same section of the same
 * Chinese page. The score is BM25 over the site's own content. */
const QUERY = '索引内存占用怎么估算';

const groupDigits = (value) => value.toLocaleString('en-US');
const asKb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const problems = [];

/** @param {string} message */
function fail(message) {
  problems.push(message);
}

/**
 * @param {string} label
 * @param {string} claimed
 * @param {string} actual
 */
function compare(label, claimed, actual) {
  if (claimed === null) {
    fail(`${label}: could not find the claim in the document`);
    return;
  }
  if (claimed !== actual) {
    fail(`${label}: document says "${claimed}", reality is "${actual}"`);
  }
}

/**
 * Reads a `  name   value` line, the shape the CLI prints its stats in.
 * @param {string} text
 * @param {string} name
 * @returns {string|null}
 */
function statLine(text, name) {
  const match = new RegExp(`^\\s+${name}\\s+([^\\s].*?)\\s*$`, 'm').exec(text);
  return match ? match[1] : null;
}

/** `--help` and `--version` are commands, not configuration; the reference
 * tables list the things you set. */
const NON_CONFIGURATION_FLAGS = new Set(['--help', '--version']);

/**
 * Reads the flag list out of the parser rather than out of a document, so that
 * the code stays the source of truth. `VALUE_FLAGS` is the explicit
 * declaration; boolean flags are found where they are read.
 * @returns {string[]}
 */
function acceptedFlags() {
  const source = readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');

  const declared = /VALUE_FLAGS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(source);
  if (!declared) {
    fail('could not find VALUE_FLAGS in src/cli.js — did the parser change shape?');
    return [];
  }

  const valueFlags = [...declared[1].matchAll(/'(--[a-z-]+)'/g)].map((m) => m[1]);
  const booleanFlags = [...source.matchAll(/flags\['(--[a-z-]+)'\]\s*===\s*true/g)].map((m) => m[1]);

  return [...new Set([...valueFlags, ...booleanFlags])]
    .filter((flag) => !NON_CONFIGURATION_FLAGS.has(flag))
    .sort();
}

/**
 * Adding a flag to the parser without adding it to the four places a reader
 * looks is the exact mistake this catches — it is how `--timeout` stayed
 * invisible while being accepted on the command line.
 */
function checkFlagsAreDocumented() {
  const flags = acceptedFlags();
  if (flags.length === 0) {
    return;
  }

  const source = readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
  const help = /const HELP = `([\s\S]*?)`;/.exec(source);
  if (!help) {
    fail('could not find the HELP text in src/cli.js');
  } else {
    for (const flag of flags) {
      if (!help[1].includes(flag)) {
        fail(`--help does not list ${flag}`);
      }
    }
  }

  for (const name of ['README.md', 'README.zh-CN.md', 'site/docs/guide/cli.html']) {
    const text = readFileSync(path.join(ROOT, name), 'utf8');
    for (const flag of flags) {
      if (!text.includes(flag)) {
        fail(`${name} does not document ${flag}`);
      }
    }
  }
}

async function main() {
  checkFlagsAreDocumented();

  const out = mkdtempSync(path.join(tmpdir(), 'hanmcp-readme-'));
  const site = await startSiteServer({ port: PORT });

  let actual;
  try {
    const manifest = await buildProject({
      url: `${site.origin}/docs/`,
      out,
      maxPages: 50,
      maxDepth: 2,
      force: true,
    });

    const { responses } = await callMcpServer(path.join(out, 'server.mjs'), [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'readme-check', version: '1' } },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'search_docs', arguments: { query: QUERY, limit: 1 } },
      },
    ]);

    const answer = responses[1]?.result?.content?.[0]?.text ?? '';
    const score = /score:\s*([\d.]+)/.exec(answer);

    actual = {
      pages: String(manifest.stats.pages),
      chunks: String(manifest.stats.chunks),
      terms: groupDigits(manifest.stats.terms),
      // DEMO.md quotes `npm run demo`, which prints the raw count; the READMEs
      // quote the CLI, which groups thousands. Same number, two renderings.
      termsRaw: String(manifest.stats.terms),
      index: asKb(manifest.stats.indexBytes),
      server: asKb(manifest.stats.serverBytes),
      score: score ? score[1] : null,
    };
  } finally {
    await site.close();
    rmSync(out, { recursive: true, force: true });
  }

  if (actual.score === null) {
    fail(`the server returned no score for "${QUERY}" — the search itself is broken`);
  }

  // --- the two READMEs -----------------------------------------------------
  for (const name of ['README.md', 'README.zh-CN.md']) {
    const text = readFileSync(path.join(ROOT, name), 'utf8');
    const at = `${name}`;

    compare(`${at} pages`, statLine(text, 'pages'), actual.pages);
    compare(`${at} chunks`, statLine(text, 'chunks'), actual.chunks);
    compare(`${at} terms`, statLine(text, 'terms'), actual.terms);
    compare(`${at} index size`, statLine(text, 'index'), actual.index);
    compare(`${at} server size`, statLine(text, 'server'), actual.server);

    const score = /score:\s*([\d.]+)/.exec(text);
    compare(`${at} score`, score ? score[1] : null, actual.score ?? '');

    // The URL the README prints has to be the port the demo actually binds,
    // otherwise the first command a reader copies does not match the output
    // shown underneath it.
    const urls = [...text.matchAll(/http:\/\/127\.0\.0\.1:(\d+)\/docs\//g)].map((m) => m[1]);
    if (urls.length === 0) {
      fail(`${at}: no localhost docs URL found`);
    }
    for (const port of new Set(urls)) {
      compare(`${at} port`, port, String(PORT));
    }
  }

  // --- the storyboard ------------------------------------------------------
  // DEMO.md quotes the same run in its own layout, so it rots for the same
  // reason and gets the same treatment.
  const demo = readFileSync(path.join(ROOT, 'docs', 'DEMO.md'), 'utf8');

  const numbers = /(\d+) pages\s+->\s+(\d+) passages\s+->\s+([\d,]+) terms/.exec(demo);
  if (!numbers) {
    fail('docs/DEMO.md: could not find the stats block');
  } else {
    compare('docs/DEMO.md pages', numbers[1], actual.pages);
    compare('docs/DEMO.md passages', numbers[2], actual.chunks);
    compare('docs/DEMO.md terms', numbers[3], actual.termsRaw);
  }

  const sizes = /index\.json ([\d.]+ KB)\s+server\.mjs ([\d.]+ KB)/.exec(demo);
  if (!sizes) {
    fail('docs/DEMO.md: could not find the artifact sizes');
  } else {
    compare('docs/DEMO.md index size', sizes[1], actual.index);
    compare('docs/DEMO.md server size', sizes[2], actual.server);
  }

  if (problems.length > 0) {
    process.stderr.write('the documentation no longer matches the tool:\n');
    for (const problem of problems) {
      process.stderr.write(`  - ${problem}\n`);
    }
    process.stderr.write(
      '\nNumbers: re-run `npm run demo` and take the values from README.md, README.zh-CN.md and docs/DEMO.md.\n' +
        'Flags: add the flag to `--help` and to every reference table.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `docs ok: ${acceptedFlags().length} flags documented everywhere; ` +
      `${actual.pages} pages, ${actual.chunks} passages, ${actual.terms} terms, ` +
      `index ${actual.index}, score ${actual.score} — all match\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`readme demo check crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
