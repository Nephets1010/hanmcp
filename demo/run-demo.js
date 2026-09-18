/**
 * The 30-second demo, in one command: `npm run demo`.
 *
 * It crawls hanmcp's own documentation site and then talks to the generated
 * server over the real MCP wire protocol, so what you record is exactly what a
 * user gets. The site is served from `site/` over localhost, which keeps the
 * recording reproducible — but the content is the project's real documentation,
 * not placeholder text.
 *
 * `npm run demo` passes `--pace`, which inserts the holds the storyboard in
 * docs/DEMO.md asks for. Without that flag the same output prints as fast as
 * the machine allows, which is the form CI runs — the holds exist to make a
 * recording readable, and nobody is watching CI.
 *
 * To record against a deployed domain instead, set DEMO_URL:
 *
 *   DEMO_URL=https://hanmcp.dev/docs/ npm run demo
 *
 * To pin the localhost port so retakes match frame for frame, set DEMO_PORT:
 *
 *   DEMO_PORT=8904 npm run demo
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startSiteServer } from './fixture-server.js';
import { callMcpServer } from './mcp-client.js';
import { buildProject, GENERATOR_VERSION } from '../src/build.js';

const OUT_DIR = fileURLToPath(new URL('./.out', import.meta.url));
const SERVER_PATH = path.join(OUT_DIR, 'server.mjs');

/** The port the demo binds when DEMO_PORT is set. Chosen because it is unlikely
 * to collide and short enough to read on screen in a recording. */
const DEFAULT_DEMO_PORT = 8904;

/** The Chinese query the demo asks. Chosen because it is the title of a real
 * section in the project's own Chinese docs, and because a Chinese query
 * returning Chinese content is the claim no English-first competitor can make. */
const QUERY = '索引内存占用怎么估算';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const write = (text = '') => process.stdout.write(`${text}\n`);

/**
 * Whether to insert the storyboard's holds.
 *
 * Every pause in this file goes through `hold` below, so there is one switch
 * for the pacing rather than a `sleep` in every section that nobody remembers
 * to tune. `npm run demo` passes the flag; CI calls this script directly and
 * gets the unpaced run.
 */
const PACED = process.argv.includes('--pace');
const hold = (ms) => (PACED ? sleep(ms) : Promise.resolve());

/**
 * The demo binds a fixed port by default. A random port would make every take
 * of the recording show a different URL, which looks careless and makes two
 * takes impossible to compare. Override with DEMO_PORT, or set it to 0 for a
 * random port when the default is already in use.
 * @returns {number}
 */
function demoPort() {
  const raw = process.env.DEMO_PORT;
  if (raw === undefined || raw === '') {
    return DEFAULT_DEMO_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`DEMO_PORT must be a port number between 0 and 65535, got "${raw}"`);
  }
  return parsed;
}

/**
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function clip(text, limit) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit).trimEnd()}\n  ... [truncated for the demo]`;
}

async function main() {
  const externalUrl = process.env.DEMO_URL;

  write(`hanmcp ${GENERATOR_VERSION}`);
  write('a documentation site becomes an MCP server, in one command');
  write('');
  await hold(600);

  const site = externalUrl ? null : await startSiteServer({ port: demoPort() });
  const entry = externalUrl ?? `${site.origin}/docs/`;

  write(`  $ npx hanmcp ${entry}`);
  write('');
  await hold(500);

  const manifest = await buildProject({
    url: entry,
    out: OUT_DIR,
    maxPages: 50,
    maxDepth: 2,
    // The demo's output directory is scratch space it owns, so re-recording a
    // take must not fail on the leftovers of the previous one.
    force: true,
    onPage: (page, url, title) => {
      write(`  [${String(page).padStart(2, ' ')}]  ${title}`);
    },
    onSkip: (message) => {
      write(`  skip  ${message}`);
    },
  });

  // Shot 2's hold. The page list arrives in under a second, and two lines in it
  // are the whole point — `中文文档 · hanmcp`, where a Chinese page title
  // survives intact, and the robots.txt skip line, which is the cheapest signal
  // that the tool behaves. Both need a moment on screen.
  await hold(4000);

  write('');
  write(`  done in ${(manifest.durationMs / 1000).toFixed(1)}s`);
  write(`  ${manifest.stats.pages} pages  ->  ${manifest.stats.chunks} passages  ->  ${manifest.stats.terms} terms`);
  write(`  index.json ${(manifest.stats.indexBytes / 1024).toFixed(1)} KB   server.mjs ${(manifest.stats.serverBytes / 1024).toFixed(1)} KB`);
  write('  wrote docs/, llms.txt, llms-full.txt, index.json, server.mjs');
  write('');

  // Shot 3's hold. Three numbers carry the value proposition — small, fast,
  // self-contained — and cutting away before they are read wastes all three.
  await hold(3500);

  write(`  $ claude mcp add hanmcp-docs -- node server.mjs`);
  write('');
  await hold(2500); // Shot 5's hold: markdown files are not a product; this is.

  write(`  an AI client asks, in Chinese:  ${QUERY}`);
  write('');
  await hold(2500); // Shot 4 opens. Let the question, in Chinese, be read first.

  const { responses } = await callMcpServer(SERVER_PATH, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'hanmcp-demo', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'search_docs', arguments: { query: QUERY, limit: 1 } },
    },
  ]);

  const serverInfo = responses[0]?.result?.serverInfo;
  const toolNames = (responses[1]?.result?.tools ?? []).map((tool) => tool.name);
  const answer = responses[2]?.result?.content?.[0]?.text ?? '(no answer)';

  write(`  server   ${serverInfo?.name} ${serverInfo?.version}`);
  write(`  tools    ${toolNames.join(', ')}`);
  write('');
  write('  answer');
  write(`  ${clip(answer, 620).split('\n').join('\n  ')}`);
  write('');

  // The longest hold in the demo, and the reason the rest exists. The answer is
  // roughly twenty lines of Chinese; the claim being made is that the section
  // whose *title* matches the query came back, not the top of the page. That is
  // only visible if there is time to look at it.
  await hold(6500);

  write('  no API key. no embeddings. no cloud. everything above ran on this machine.');
  write('');

  // Shot 6's hold. The line reframes the previous half minute from "a demo"
  // into "something that runs on your laptop, on your private docs". It is the
  // sentence that makes someone click through, so it gets to stand alone.
  await hold(4000);

  if (site) {
    await site.close();
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    process.stderr.write(`demo failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
