#!/usr/bin/env node

/**
 * hanmcp CLI.
 *
 * Commands:
 *   hanmcp <url>            crawl and build the MCP server
 *   hanmcp serve [dir]      run the generated server on stdio
 *   hanmcp help | version
 */

import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildProject, formatManifest, GENERATOR_VERSION } from './build.js';
import { createServer } from './mcp-runtime.js';
import { groupDigits } from './util.js';

const VALUE_FLAGS = new Set(['--out', '--max-pages', '--max-depth', '--name', '--delay', '--timeout']);

const HELP = `hanmcp ${GENERATOR_VERSION} - turn a documentation site into an MCP server

usage
  hanmcp <url> [options]        crawl a docs site and build the server
  hanmcp serve [dir]            run the generated server (stdio)
  hanmcp help | version

options
  --out <dir>          output directory (default: mcp-docs)
  --max-pages <n>      page ceiling (default: 50)
  --max-depth <n>      link depth from the entry URL (default: 2)
  --name <name>        server name (default: derived from the site title)
  --delay <ms>         pause between requests (default: 120)
  --timeout <ms>       give up on a single request after this long (default: 15000)
  --no-robots          skip the robots.txt check
  --force              overwrite --out even if hanmcp did not create it
  --quiet              only print the final summary

examples
  hanmcp https://docs.example.com/
  hanmcp https://docs.example.com/ --out ./docs-mcp --max-pages 120
  hanmcp serve ./docs-mcp

The build writes markdown, llms.txt, llms-full.txt, index.json, and a
standalone server.mjs that runs with plain Node and no dependencies.`;

/**
 * @param {string[]} argv
 * @returns {{flags: Record<string, string|boolean>, positional: string[]}}
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const equals = token.indexOf('=');
      if (equals !== -1) {
        flags[token.slice(0, equals)] = token.slice(equals + 1);
        continue;
      }
      if (VALUE_FLAGS.has(token)) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith('--')) {
          throw new Error(`${token} requires a value`);
        }
        flags[token] = next;
        index += 1;
        continue;
      }
      flags[token] = true;
    } else if (token.startsWith('-') && token.length > 1) {
      flags[token] = true;
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

/**
 * @param {Record<string, string|boolean>} flags
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numberFlag(flags, key, fallback) {
  const raw = flags[key];
  if (raw === undefined || raw === true) {
    return fallback;
  }
  const value = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

/**
 * @param {string[]} lines
 * @returns {void}
 */
function print(lines) {
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * @param {object} flags
 * @returns {Promise<number>}
 */
async function runBuild(flags, url) {
  const out = typeof flags['--out'] === 'string' ? flags['--out'] : 'mcp-docs';
  const quiet = flags['--quiet'] === true;
  const maxPages = numberFlag(flags, '--max-pages', 50);
  const maxDepth = numberFlag(flags, '--max-depth', 2);
  const delay = numberFlag(flags, '--delay', 120);
  const timeout = numberFlag(flags, '--timeout', 15000);

  if (!quiet) {
    print([
      `hanmcp ${GENERATOR_VERSION}  documentation -> MCP`,
      '',
      `  source   ${url}`,
      `  output   ${out}`,
      `  limits   depth ${maxDepth}, ${maxPages} pages, ${delay}ms delay, ${
        flags['--no-robots'] === true ? 'robots.txt ignored' : 'robots.txt respected'
      }`,
      '',
    ]);
  }

  let counter = 0;
  const manifest = await buildProject({
    url,
    out,
    maxPages,
    maxDepth,
    delayMs: delay,
    timeoutMs: timeout,
    force: flags['--force'] === true,
    respectRobots: flags['--no-robots'] !== true,
    name: typeof flags['--name'] === 'string' ? flags['--name'] : undefined,
    onPage: (page, pageUrl, title) => {
      if (quiet) {
        return;
      }
      counter = page;
      process.stdout.write(`  [${String(page).padStart(2, ' ')}]  ${title}\n`);
    },
    onSkip: (message) => {
      if (!quiet) {
        process.stdout.write(`  skip  ${message}\n`);
      }
    },
  });

  if (counter > 0) {
    process.stdout.write('\n');
  }

  const setupPath = path.join(path.resolve(manifest.outDir), 'server.mjs').replace(/\\/g, '/');

  print([
    `  done in ${(manifest.durationMs / 1000).toFixed(1)}s`,
    formatManifest(manifest),
    '',
    '  files    docs/, llms.txt, llms-full.txt, index.json, server.mjs',
    '',
    '  next',
    `    try it       hanmcp serve ${out}`,
    `    claude code  claude mcp add ${manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'docs'} -- node ${setupPath}`,
    `    any client   { "command": "node", "args": ["${setupPath}"] }`,
    '',
  ]);

  return 0;
}

/**
 * @param {string} directory
 * @returns {number}
 */
function runServe(directory) {
  const dir = path.resolve(directory);
  const server = createServer({ dir, name: path.basename(dir), version: GENERATOR_VERSION });
  const index = server.loadIndex();
  process.stdout.write(
    `hanmcp serve  ${groupDigits(index.stats.pages)} pages, ${groupDigits(index.stats.chunks)} passages -> ${dir}\n`,
  );
  server.start();
  return 0;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { flags, positional } = parseArgs(argv);

  if (flags['--help'] === true || flags['-h'] === true || positional[0] === 'help') {
    print([HELP]);
    return 0;
  }
  if (flags['--version'] === true || flags['-v'] === true || positional[0] === 'version') {
    print([GENERATOR_VERSION]);
    return 0;
  }

  const command = positional[0];

  if (command === 'serve') {
    return runServe(positional[1] || 'mcp-docs');
  }

  if (command === undefined) {
    print([HELP]);
    return 1;
  }

  let url;
  try {
    url = new URL(command).href;
  } catch {
    process.stderr.write(`error: "${command}" is not a valid URL.\n\n${HELP}\n`);
    return 1;
  }

  return runBuild(flags, url);
}

/**
 * Is this file the process entry point, or was it imported?
 *
 * Node resolves the main module through symlinks, so `import.meta.url` is a
 * real path while `process.argv[1]` is whatever the caller typed. Comparing them
 * directly fails whenever the CLI is reached through a symlinked component —
 * which is not exotic: macOS resolves `/tmp` and `/var`, a symlinked home
 * directory is common, and package managers create these links routinely. When
 * the comparison fails the CLI is never invoked at all, so it prints nothing
 * and exits 0 — a silent no-op, which is the worst way to be wrong.
 *
 * Resolving both sides through `realpathSync` makes the comparison mean what it
 * was meant to mean.
 */
const isDirectRun = (() => {
  if (process.argv[1] === undefined) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) {
        process.exitCode = code;
      }
    })
    .catch((error) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
