/**
 * Output-directory safety.
 *
 * `--out` takes a user-supplied path and the build clears that directory, so
 * these are the tests standing between a typo and somebody's data. The rules
 * are documented in SECURITY.md; this file is what enforces them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prepareOutputDir, formatManifest } from '../src/build.js';

/**
 * @returns {string} a temporary directory removed when the test finishes
 */
function scratch() {
  return mkdtempSync(path.join(tmpdir(), 'hanmcp-build-'));
}

test('a filesystem root is refused as an output directory', () => {
  const root = path.parse(process.cwd()).root;
  assert.throws(() => prepareOutputDir(root), /refusing to use a filesystem root/);
});

test('the current working directory is refused as an output directory', () => {
  assert.throws(() => prepareOutputDir('.'), /refusing to use the current working directory/);
  assert.throws(() => prepareOutputDir(process.cwd()), /refusing to use the current working directory/);
});

test('a brand new directory is created along with docs/', () => {
  const base = scratch();
  try {
    const target = path.join(base, 'fresh');
    const resolved = prepareOutputDir(target);
    assert.equal(resolved, path.resolve(target));
    assert.ok(existsSync(path.join(target, 'docs')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('an empty existing directory is treated as ours', () => {
  const base = scratch();
  try {
    const target = path.join(base, 'empty');
    mkdirSync(target);
    assert.doesNotThrow(() => prepareOutputDir(target));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a directory hanmcp created is cleared and rebuilt', () => {
  const base = scratch();
  try {
    const target = path.join(base, 'ours');
    mkdirSync(path.join(target, 'docs'), { recursive: true });
    writeFileSync(path.join(target, '.hanmcp'), '0.1.0\n');
    writeFileSync(path.join(target, 'stale.txt'), 'old build\n');

    prepareOutputDir(target);

    assert.ok(existsSync(path.join(target, 'docs')));
    assert.ok(!existsSync(path.join(target, 'stale.txt')), 'stale artifacts must be removed');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a foreign directory is refused rather than deleted', () => {
  const base = scratch();
  try {
    const target = path.join(base, 'someone-elses');
    mkdirSync(target);
    const precious = path.join(target, 'work.txt');
    writeFileSync(precious, 'do not delete me\n');

    assert.throws(() => prepareOutputDir(target), /was not created by hanmcp/);
    assert.ok(existsSync(precious), 'the refusal must happen before anything is removed');

    const survived = readdirSync(target);
    assert.deepEqual(survived, ['work.txt']);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('--force overwrites a foreign directory, but only when asked', () => {
  const base = scratch();
  try {
    const target = path.join(base, 'force-me');
    mkdirSync(target);
    writeFileSync(path.join(target, 'old.txt'), 'gone after force\n');

    prepareOutputDir(target, true);

    assert.ok(existsSync(path.join(target, 'docs')));
    assert.ok(!existsSync(path.join(target, 'old.txt')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the marker file is written by a real build', async () => {
  const { startFixtureServer } = await import('../demo/fixture-server.js');
  const { buildProject } = await import('../src/build.js');
  const fixture = await startFixtureServer();
  const outDir = scratch();
  try {
    await buildProject({ url: `${fixture.origin}/docs/`, out: outDir, maxDepth: 1, force: true });
    assert.ok(existsSync(path.join(outDir, '.hanmcp')));
    // A second build into the same directory must succeed without --force,
    // because the marker now proves ownership.
    await buildProject({ url: `${fixture.origin}/docs/`, out: outDir, maxDepth: 1 });
    assert.ok(existsSync(path.join(outDir, 'server.mjs')));
  } finally {
    await fixture.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('a failed build leaves a directory the next build can reuse', async () => {
  const { startFixtureServer } = await import('../demo/fixture-server.js');
  const { buildProject } = await import('../src/build.js');
  const fixture = await startFixtureServer();
  const outDir = scratch();
  try {
    // Port 1 is reliably unreachable, so this build fails part-way through.
    await assert.rejects(
      buildProject({ url: 'http://127.0.0.1:1/docs/', out: outDir, maxDepth: 1 }),
      /no readable pages found/,
    );
    assert.ok(existsSync(path.join(outDir, '.hanmcp')), 'ownership is claimed before the crawl');

    // No --force: a failed run must not make the user clean up by hand.
    await buildProject({ url: `${fixture.origin}/docs/`, out: outDir, maxDepth: 1 });
    assert.ok(existsSync(path.join(outDir, 'server.mjs')));
  } finally {
    await fixture.close();
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('the manifest summary formats every stat with thousands separators', () => {
  const text = formatManifest({ stats: { pages: 1234, chunks: 5678, terms: 91011, indexBytes: 204800, serverBytes: 17408 } });
  assert.ok(text.includes('1,234'));
  assert.ok(text.includes('5,678'));
  assert.ok(text.includes('91,011'));
  assert.ok(text.includes('200.0 KB'));
  assert.ok(text.includes('17.0 KB'));
});
