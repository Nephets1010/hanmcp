#!/usr/bin/env node
/**
 * Syntax gate for CI.
 *
 * Runs `node --check` over every source file *and* over the artifact that
 * `bundleServer()` emits. The bundled server is generated code that only ever
 * runs after a user installs the package, so a syntax error there would ship
 * silently — `node --test` cannot catch it because no test imports the string.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleServer } from '../src/bundle.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECKED_DIRS = ['src', 'test', 'demo', 'scripts'];
const CHECKED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/**
 * @param {string} directory
 * @returns {string[]}
 */
function collect(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) {
      continue;
    }
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (CHECKED_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

const targets = [];
for (const directory of CHECKED_DIRS) {
  try {
    targets.push(...collect(path.join(ROOT, directory)));
  } catch {
    // A missing optional directory is not a failure.
  }
}

const failures = [];
for (const file of targets) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${path.relative(ROOT, file)}\n${message.split('\n').slice(0, 6).join('\n')}`);
  }
}

// The generated server is the one file users actually execute. It is checked
// from disk rather than via `-e`, because the shebang line is only stripped
// when Node parses a file.
const bundle = bundleServer({ name: 'syntax-check', version: '0.0.0' });
const bundleBytes = Buffer.byteLength(bundle, 'utf8');
const scratch = mkdtempSync(path.join(tmpdir(), 'hanmcp-syntax-'));
try {
  const bundlePath = path.join(scratch, 'server.mjs');
  writeFileSync(bundlePath, bundle, 'utf8');
  execFileSync(process.execPath, ['--check', bundlePath], { stdio: 'pipe' });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  failures.push(`bundleServer() output\n${message.split('\n').slice(0, 8).join('\n')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  process.stderr.write(`syntax check failed for ${failures.length} target(s):\n\n`);
  for (const failure of failures) {
    process.stderr.write(`${failure}\n\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `syntax ok: ${targets.length} source files + bundled server (${(bundleBytes / 1024).toFixed(1)} KB)\n`,
  );
}
