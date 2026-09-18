/**
 * The `build` pipeline: crawl → extract → index → emit artifacts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { crawl } from './crawler.js';
import { buildIndex } from './search.js';
import { renderLlmsTxt, renderLlmsFullTxt, stripCommonTitleSuffix } from './llms.js';
import { bundleServer } from './bundle.js';
import { groupDigits } from './util.js';

export const GENERATOR_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

const MARKER = '.hanmcp';

/**
 * `.hanmcp` records *ownership* of the output directory and is written the
 * moment the directory is created — see `prepareOutputDir`. `manifest.json` is
 * written last and records *completion*. A failed build therefore leaves an
 * owned directory with no manifest, which the next run may freely reuse.
 */

/**
 * Only ever clear a directory that hanmcp created, or an empty one. Deleting a
 * user's folder because they mistyped `--out` is not an acceptable failure mode.
 *
 * The ownership marker is written here rather than at the end of the build on
 * purpose. A crawl that fails — bad URL, no network, Ctrl-C — must not leave
 * behind a half-populated directory that the *next* run then refuses to touch
 * and that the user has to delete by hand. Claiming the directory the moment it
 * is created keeps failed builds retryable.
 * @param {string} directory
 * @param {boolean} force
 * @returns {string}
 */
export function prepareOutputDir(directory, force = false) {
  const resolved = path.resolve(directory);

  if (resolved === path.parse(resolved).root) {
    throw new Error(`refusing to use a filesystem root as output: ${resolved}`);
  }
  if (resolved === path.resolve(process.cwd())) {
    throw new Error('refusing to use the current working directory as output; pass --out <dir>');
  }

  if (existsSync(resolved)) {
    const entries = readdirSync(resolved);
    const ours = entries.length === 0 || existsSync(path.join(resolved, MARKER));
    if (!ours && !force) {
      throw new Error(
        `${directory} already exists and was not created by hanmcp. Choose another --out directory, or pass --force to overwrite it.`,
      );
    }
    rmSync(resolved, { recursive: true, force: true });
  }

  mkdirSync(path.join(resolved, 'docs'), { recursive: true });
  writeFileSync(path.join(resolved, MARKER), `${GENERATOR_VERSION}\n`, 'utf8');
  return resolved;
}

/**
 * @param {Array<{path: string}>} pages
 * @returns {void}
 */
function dedupePaths(pages) {
  const used = new Set();
  for (const page of pages) {
    if (!used.has(page.path)) {
      used.add(page.path);
      continue;
    }
    const base = page.path.replace(/\.md$/, '');
    let counter = 2;
    while (used.has(`${base}-${counter}.md`)) {
      counter += 1;
    }
    page.path = `${base}-${counter}.md`;
    used.add(page.path);
  }
}

/**
 * @param {Array<{path: string, title: string}>} pages
 * @param {string} sourceUrl
 * @returns {string}
 */
function deriveName(pages, sourceUrl) {
  const root = pages.find((page) => page.path === 'index.md') || pages[0];
  if (root !== undefined && root.title !== '') {
    return root.title;
  }
  return new URL(sourceUrl).hostname;
}

/**
 * @param {object} options
 * @param {string} options.url documentation entry point
 * @param {string} [options.out] output directory
 * @param {number} [options.maxPages]
 * @param {number} [options.maxDepth]
 * @param {string} [options.name]
 * @param {boolean} [options.respectRobots]
 * @param {number} [options.delayMs]
 * @param {boolean} [options.force]
 * @param {(page: number, url: string, title: string) => void} [options.onPage]
 * @param {(message: string) => void} [options.onSkip]
 * @returns {Promise<object>} manifest
 */
export async function buildProject(options) {
  const outDir = prepareOutputDir(options.out || 'mcp-docs', options.force === true);
  const startedAt = Date.now();

  const pages = await crawl(options.url, {
    maxPages: options.maxPages,
    maxDepth: options.maxDepth,
    respectRobots: options.respectRobots,
    delayMs: options.delayMs,
    onPage: options.onPage,
    onSkip: options.onSkip,
  });

  if (pages.length === 0) {
    throw new Error(
      `no readable pages found at ${options.url}. Check the URL, or raise --max-depth if the content is nested deeper.`,
    );
  }

  dedupePaths(pages);
  const titled = stripCommonTitleSuffix(pages);

  for (const page of titled) {
    const target = path.join(outDir, 'docs', page.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${page.markdown}\n`, 'utf8');
  }

  const source = new URL(options.url).href;
  const name = options.name || deriveName(titled, source);
  const root = titled.find((page) => page.path === 'index.md');
  const summary =
    root !== undefined && root.description !== ''
      ? root.description
      : `Documentation for ${name}, indexed for AI assistants.`;

  const index = buildIndex(titled, { source });
  const meta = { name, summary, source };
  const detail = `Indexed from ${source} (${titled.length} pages). Use \`llms-full.txt\` for the complete text, or \`server.mjs\` to expose the same content as MCP tools.`;

  writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index), 'utf8');
  writeFileSync(path.join(outDir, 'llms.txt'), renderLlmsTxt({ ...meta, detail }, titled), 'utf8');
  writeFileSync(path.join(outDir, 'llms-full.txt'), renderLlmsFullTxt(meta, titled), 'utf8');

  const serverPath = path.join(outDir, 'server.mjs');
  writeFileSync(serverPath, bundleServer({ name, version: GENERATOR_VERSION }), { encoding: 'utf8', mode: 0o755 });

  const documentBytes = titled.reduce((sum, page) => sum + Buffer.byteLength(page.markdown, 'utf8'), 0);
  const manifest = {
    generator: 'hanmcp',
    version: GENERATOR_VERSION,
    source,
    name,
    builtAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    stats: {
      pages: titled.length,
      chunks: index.stats.chunks,
      terms: index.stats.terms,
      documentBytes,
      indexBytes: statSync(path.join(outDir, 'index.json')).size,
      serverBytes: statSync(serverPath).size,
    },
    files: {
      docs: 'docs/',
      llms: 'llms.txt',
      llmsFull: 'llms-full.txt',
      index: 'index.json',
      server: 'server.mjs',
    },
  };

  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { ...manifest, outDir, pages: titled.map((page) => ({ path: page.path, url: page.url, title: page.title })) };
}

/**
 * @param {object} manifest
 * @returns {string}
 */
export function formatManifest(manifest) {
  return [
    `  pages   ${groupDigits(manifest.stats.pages)}`,
    `  chunks  ${groupDigits(manifest.stats.chunks)}`,
    `  terms   ${groupDigits(manifest.stats.terms)}`,
    `  index   ${(manifest.stats.indexBytes / 1024).toFixed(1)} KB`,
    `  server  ${(manifest.stats.serverBytes / 1024).toFixed(1)} KB`,
  ].join('\n');
}
