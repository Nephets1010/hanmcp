/**
 * CLI-level tests.
 *
 * The CLI is the only surface most users touch, so its argument parsing and its
 * exit codes are tested as a contract. The end-to-end run spawns a child
 * process on purpose: an in-process `execFileSync` would block the event loop
 * and starve the fixture server the command is fetching from.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../src/cli.js';
import { startFixtureServer } from '../demo/fixture-server.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

/**
 * @param {string[]} args
 * @param {string} [cliPath] Where to reach the CLI from; defaults to its real path.
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
function runCli(args, cliPath = CLI) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('flags parse with space, equals and boolean forms', () => {
  const { flags, positional } = parseArgs([
    'https://a.com/docs/',
    '--out', './x',
    '--max-pages=120',
    '--force',
    '--quiet',
  ]);
  assert.deepEqual(positional, ['https://a.com/docs/']);
  assert.equal(flags['--out'], './x');
  assert.equal(flags['--max-pages'], '120');
  assert.equal(flags['--force'], true);
  assert.equal(flags['--quiet'], true);
});

test('a value flag with no value is rejected instead of silently ignored', () => {
  assert.throws(() => parseArgs(['https://a.com', '--out', '--force']), /--out requires a value/);
});

test('a flag that looks like a value is not swallowed', () => {
  const { flags } = parseArgs(['https://a.com', '--max-depth', '3']);
  assert.equal(flags['--max-depth'], '3');
});

test('version prints a bare semver and exits 0', async () => {
  const { code, stdout } = await runCli(['--version']);
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('help exits 0 and documents every documented flag', async () => {
  const { code, stdout } = await runCli(['help']);
  assert.equal(code, 0);
  for (const flag of ['--out', '--max-pages', '--max-depth', '--name', '--delay', '--timeout', '--no-robots', '--force', '--quiet']) {
    assert.ok(stdout.includes(flag), `help text is missing ${flag}`);
  }
});

test('no arguments prints help and exits non-zero', async () => {
  const { code, stdout } = await runCli([]);
  assert.equal(code, 1);
  assert.ok(stdout.includes('usage'));
});

test('runs when reached through a symlinked path', async () => {
  // Node resolves the main module through symlinks, so `import.meta.url` is a
  // real path while `process.argv[1]` is whatever the caller typed. Comparing
  // the two directly fails whenever the CLI is reached through a symlinked
  // component, and that is not exotic: macOS resolves `/tmp` and `/var`, a
  // symlinked home directory is common, package managers create these links.
  // It fails silently, too — the entry point is judged to be an import, so
  // `main()` never runs and the process prints nothing and exits 0.
  const scratch = mkdtempSync(path.join(tmpdir(), 'hanmcp-symlink-'));
  const link = path.join(scratch, 'linked-src');
  try {
    symlinkSync(path.dirname(CLI), link, process.platform === 'win32' ? 'junction' : 'dir');
    const { code, stdout } = await runCli(['--version'], path.join(link, 'cli.js'));
    assert.equal(code, 0);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/, 'the CLI printed nothing: it decided it was being imported');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('a malformed url fails with a readable message, not a stack trace', async () => {
  const { code, stderr } = await runCli(['not-a-url']);
  assert.equal(code, 1);
  assert.ok(stderr.includes('is not a valid URL'));
  assert.ok(!stderr.includes('    at '), 'users should not see a stack trace for a typo');
});

test('a real build from the cli writes the artifacts and prints next steps', async () => {
  const fixture = await startFixtureServer();
  const outDir = mkdtempSync(path.join(tmpdir(), 'hanmcp-cli-'));
  try {
    const { code, stdout, stderr } = await runCli([
      `${fixture.origin}/docs/`,
      '--out', outDir,
      '--force',
      '--max-depth', '2',
    ]);
    assert.equal(code, 0, `stderr: ${stderr}`);
    assert.ok(stdout.includes('documentation -> MCP'));
    assert.ok(stdout.includes('hanmcp serve'));
    assert.ok(stdout.includes('claude mcp add'));
    assert.ok(existsSync(path.join(outDir, 'server.mjs')));
    assert.ok(existsSync(path.join(outDir, 'docs', 'zh', '内存调优.md')));
    assert.ok(stderr === '');
  } finally {
    await fixture.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('--quiet suppresses the crawl log but keeps the summary', async () => {
  const fixture = await startFixtureServer();
  const outDir = mkdtempSync(path.join(tmpdir(), 'hanmcp-cli-q-'));
  try {
    const { code, stdout } = await runCli([
      `${fixture.origin}/docs/`,
      '--out', outDir,
      '--force',
      '--quiet',
    ]);
    assert.equal(code, 0);
    assert.ok(!stdout.includes('skip  '));
    assert.ok(stdout.includes('pages'));
  } finally {
    await fixture.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('an unreachable url fails with the page-ceiling hint', async () => {
  // A reachable-but-empty output path in the temp directory, so the test never
  // litters the repository root.
  const outDir = path.join(mkdtempSync(path.join(tmpdir(), 'hanmcp-cli-dead-')), 'out');
  const { code, stderr } = await runCli(['http://127.0.0.1:1/docs/', '--out', outDir, '--quiet']);
  assert.equal(code, 1);
  assert.ok(stderr.includes('no readable pages found'), `stderr was: ${stderr}`);
});

test('--timeout reaches the crawler instead of being a dead flag', async () => {
  // `--timeout` was accepted by the parser but never passed down, so raising it
  // for a slow host silently did nothing. A ceiling of 0 aborts every page
  // request immediately — this can only fail if the value actually gets through
  // and the crawl gives up. With the 15s default the fixtures would be fetched
  // comfortably and the build would succeed.
  const fixture = await startFixtureServer();
  const outDir = path.join(mkdtempSync(path.join(tmpdir(), 'hanmcp-cli-timeout-')), 'out');
  try {
    const { code, stderr } = await runCli([
      `${fixture.origin}/docs/`,
      '--out', outDir,
      '--quiet',
      '--timeout', '0',
    ]);
    assert.equal(code, 1, 'a 0ms timeout should make every page request give up');
    assert.ok(stderr.includes('no readable pages found'), `stderr was: ${stderr}`);
  } finally {
    await fixture.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a negative --timeout is rejected rather than silently ignored', async () => {
  const { code, stderr } = await runCli(['https://a.com/docs/', '--timeout', '-1']);
  assert.equal(code, 1);
  assert.ok(stderr.includes('--timeout must be a non-negative integer'), `stderr was: ${stderr}`);
});
