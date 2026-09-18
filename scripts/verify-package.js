#!/usr/bin/env node
/**
 * Keeps the *package* honest, not just the documents.
 *
 * The other checks all compare a document against a file in the working tree:
 * the numbers in the READMEs against a real run, the flag list against the
 * parser, the quoted tape against the tape. Every one of them passed while the
 * README's first command — `npx hanmcp https://docs.example.com/` — could not
 * be run by anybody, because the package had never been published. Nothing
 * asked whether the command worked; only whether the text matched.
 *
 * That is the gap this closes. It does the thing a user does:
 *
 *   1. packs the working tree the way `npm publish` would,
 *   2. installs that tarball into a throwaway consumer, as a stranger would,
 *   3. runs the CLI that came out of it against a real site,
 *   4. speaks the MCP wire protocol to the server it produced.
 *
 * It catches the failures that live *only* in the shipped artifact: a `files`
 * whitelist that forgot something the generated server needs, a `bin` pointing
 * at a moved file, a name changed in package.json but not in the README,
 * development-only files leaking into the tarball.
 *
 * It also catches something a file listing cannot. `npm pack` ships the `bin`
 * entry point no matter what `files` says — but not the modules that entry
 * point imports. A tarball with a gutted `files` field therefore looks complete
 * and dies on the first `import`. Only running it finds that.
 *
 * Deliberately NOT checked: whether this version is actually on the registry.
 * That needs the network, and between bumping the version and publishing it,
 * "not on the registry yet" is the correct state — asserting it would make the
 * gate fail for the wrong reason. Publishing is a deliberate act; this check
 * only guarantees that the thing being published works.
 *
 * Deliberately not reusing demo/fixture-server.js or demo/mcp-client.js: if the
 * client and the server share a bug, reusing them lets the bug prove itself
 * correct. The client and the static server here are written from scratch
 * against the wire protocol and the HTTP spec.
 *
 * Deliberately crawling `site/` rather than the frozen test fixture: the
 * tarball is what a stranger receives, and `site/` is the content the READMEs
 * show it being used on.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_ROOT = path.join(ROOT, 'site');

/** The same Chinese query the READMEs show, against the same page. It has to
 * come back with the section, not the whole page — that is the claim. */
const QUERY = '索引内存占用怎么估算';

/** Directories that must never travel inside the published tarball. */
const DEV_ONLY = ['test', 'demo', 'site', 'scripts', '.github'];

const results = [];
/**
 * @param {string} label
 * @param {boolean} ok
 * @param {string} [detail]
 */
function check(label, ok, detail = '') {
  results.push({ label, ok });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}\n`);
}

/**
 * npm is a script, not a binary, and on Windows it is a `.cmd`. Run the copy
 * npm told us about when we were started by `npm run`, so the path is always
 * the one already in use, and never a shell-quoting question.
 *
 * The fallbacks matter because CI runs `node scripts/verify-package.js`
 * directly, without `npm run`. Node distributions put npm in one of two
 * places, so try both before falling back to PATH.
 * @returns {{command: string, prefix: string[], shell: boolean}}
 */
function npmInvocation() {
  if (process.env.npm_execpath) {
    return {
      command: process.env.npm_node_execpath || process.execPath,
      prefix: [process.env.npm_execpath],
      shell: false,
    };
  }

  const binDir = path.dirname(process.execPath);
  const candidates = [
    // Windows installs and nvm-windows: npm sits beside node.exe.
    path.join(binDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    // actions/setup-node on Linux and macOS: <root>/bin/node -> <root>/lib/node_modules/npm.
    path.join(binDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { command: process.execPath, prefix: [candidate], shell: false };
    }
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    prefix: [],
    shell: process.platform === 'win32',
  };
}

/**
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{code: number, out: string, err: string}>}
 */
function runNpm(args, cwd) {
  const { command, prefix, shell } = npmInvocation();
  const argv = [...prefix, ...args];
  return new Promise((resolve) => {
    const child = spawn(command, argv, { cwd, shell, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => resolve({ code: -1, out, err: String(error) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/**
 * @param {string[]} args
 * @param {{cwd?: string}} [options]
 * @returns {Promise<{code: number, out: string, err: string}>}
 */
function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', (error) => resolve({ code: -1, out, err: String(error) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/**
 * A static server for `site/`, written here rather than imported, so the crawl
 * under test never shares code with the crawl harness.
 * @returns {Promise<{origin: string, close: () => Promise<void>}>}
 */
async function startSite() {
  const root = path.resolve(SITE_ROOT);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };

  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = path.join(root, pathname);
    if (!target.startsWith(root)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = path.join(target, 'index.html');
      info = await stat(target).catch(() => null);
    }
    if (!info) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': types[path.extname(target)] ?? 'application/octet-stream' });
    response.end(await readFile(target));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * A minimal MCP client over stdio — newline-delimited JSON-RPC, the transport
 * the generated server speaks. Written against the protocol, not against the
 * repository's own client.
 * @param {string} serverPath
 */
function startMcp(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) {
        continue;
      }
      try {
        const message = JSON.parse(line);
        const settle = pending.get(message.id);
        if (settle) {
          pending.delete(message.id);
          settle(message);
        }
      } catch {
        // A non-JSON line on stdout is a protocol violation, not something to
        // swallow quietly.
        process.stdout.write(`\n  unparseable stdout: ${line.slice(0, 120)}\n`);
      }
    }
  });

  let nextId = 1;
  return {
    /**
     * @param {string} method
     * @param {object} [params]
     */
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        const frame = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
        child.stdin.write(`${JSON.stringify(frame)}\n`);
      });
    },
    /** @param {string} method */
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    },
    stop() {
      child.stdin.end();
      child.kill();
    },
  };
}

async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const scratch = await mkdtemp(path.join(tmpdir(), 'hanmcp-package-'));
  const consumer = path.join(scratch, 'consumer');
  let site;
  let mcp;

  try {
    // -- 1. pack exactly what `npm publish` would send -----------------------
    const packed = await runNpm(
      ['pack', '--pack-destination', scratch, '--ignore-scripts', '--loglevel=error'],
      ROOT,
    );
    if (packed.code !== 0) {
      throw new Error(`npm pack failed (exit ${packed.code}): ${packed.err.trim() || packed.out.trim()}`);
    }
    const tarballName = packed.out.trim().split('\n').pop().trim();
    const tarball = path.join(scratch, tarballName);
    check('npm pack succeeds', existsSync(tarball), tarballName);

    // -- 2. install it the way a stranger would -----------------------------
    await mkdir(consumer, { recursive: true });
    await writeFile(
      path.join(consumer, 'package.json'),
      `${JSON.stringify({ name: 'stranger', version: '0.0.0', private: true }, null, 2)}\n`,
    );
    // `--offline`: the tarball is local and the package has no dependencies, so
    // resolving it must not need the registry. Proving that keeps this check
    // honest behind a broken proxy. If the package ever grows a dependency,
    // this fails loudly rather than reaching out silently.
    const installed = await runNpm(
      ['install', tarball, '--no-audit', '--no-fund', '--no-save', '--offline', '--loglevel=error'],
      consumer,
    );
    if (installed.code !== 0) {
      throw new Error(`npm install failed (exit ${installed.code}): ${installed.err.trim()}`);
    }

    const shipped = path.join(consumer, 'node_modules', pkg.name);
    if (!existsSync(shipped)) {
      throw new Error(`${pkg.name} is not in node_modules after installing the tarball`);
    }
    check('the tarball installs into a clean consumer', true, `node_modules/${pkg.name}`);

    // -- 3. what arrived is what we think shipped ---------------------------
    const shippedPkg = JSON.parse(await readFile(path.join(shipped, 'package.json'), 'utf8'));
    check('the installed version matches package.json', shippedPkg.version === pkg.version, shippedPkg.version);

    for (const dir of DEV_ONLY) {
      check(`the tarball does not carry ${dir}/`, !existsSync(path.join(shipped, dir)));
    }

    // The `bin` field is how `npx hanmcp` finds the entry point at all.
    const binTarget = shippedPkg.bin?.[pkg.name];
    if (!binTarget) {
      check('package.json declares a bin entry', false, JSON.stringify(shippedPkg.bin ?? null));
    } else {
      const binPath = path.resolve(shipped, binTarget);
      const binSource = existsSync(binPath) ? await readFile(binPath, 'utf8') : null;
      check('bin points at a file that shipped', binSource !== null, binTarget);
      check('the bin entry point has a node shebang', Boolean(binSource?.startsWith('#!/usr/bin/env node')));
      check(
        'npm generated a bin shim',
        existsSync(path.join(consumer, 'node_modules', '.bin', pkg.name)) ||
          existsSync(path.join(consumer, 'node_modules', '.bin', `${pkg.name}.cmd`)),
      );
    }

    // The READMEs' first command is `npx <name> ...`. A rename that misses the
    // README is invisible to every other check, because each side matches
    // itself.
    for (const name of ['README.md', 'README.zh-CN.md']) {
      const text = await readFile(path.join(ROOT, name), 'utf8');
      const called = [...text.matchAll(/npx\s+(?:--yes\s+)?([a-z0-9][\w.-]*)/gi)].map((match) => match[1]);
      const wrong = [...new Set(called)].filter((found) => found !== pkg.name);
      check(
        `${name}: every npx invocation names ${pkg.name}`,
        called.length > 0 && wrong.length === 0,
        wrong.length > 0 ? `found: ${wrong.join(', ')}` : `${called.length} invocations`,
      );
    }

    // -- 4. run the installed CLI against a real site -----------------------
    // Skipped only when `bin` was missing entirely, which is already recorded
    // as a failure — there is nothing to run, and the summary still reports it.
    if (binTarget) {
      site = await startSite();
      const out = path.join(scratch, 'mcp-docs');
      // No `--max-pages`: the crawl should be bounded by the site, not by us.
      const crawl = await runNode(
        [path.resolve(shipped, binTarget), `${site.origin}/docs/`, '--out', out],
        { cwd: consumer },
      );
      check('the installed CLI crawls successfully', crawl.code === 0, `exit ${crawl.code}`);
      if (crawl.code !== 0) {
        throw new Error(`crawl failed:\n${crawl.err.trim() || crawl.out.trim()}`);
      }

      // Read the stats line, not the `limits` line above it — the latter also
      // contains the words "N pages" and would silently report the cap.
      const pages = Number(/^\s+pages\s+(\d+)\s*$/m.exec(crawl.out)?.[1] ?? NaN);
      check('pages were crawled', pages > 0, `${pages} pages`);
      check('robots.txt is respected', /skip\s+robots\.txt/.test(crawl.out));

      for (const produced of ['index.json', 'llms.txt', 'llms-full.txt', 'server.mjs', 'docs']) {
        check(`produced ${produced}`, existsSync(path.join(out, produced)));
      }

      const manifest = JSON.parse(await readFile(path.join(out, 'index.json'), 'utf8'));
      check(
        'index.json parses',
        Array.isArray(manifest.chunks) && manifest.chunks.length > 0,
        `${manifest.chunks.length} passages`,
      );
      // The number printed to the user and the number stored in the artifact
      // have to be the same number.
      check(
        'the printed page count matches index.json',
        manifest.stats?.pages === pages,
        `printed ${pages}, stored ${manifest.stats?.pages}`,
      );

      // The READMEs say the generated server has no dependencies. Verify that
      // against the artifact a user receives, not against the source.
      const serverSource = await readFile(path.join(out, 'server.mjs'), 'utf8');
      const external = [...serverSource.matchAll(/^\s*import\s[^'"]*from\s+['"]([^'"]+)['"]/gm)]
        .map((match) => match[1])
        .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'));
      check('the generated server.mjs has no external imports', external.length === 0, external.join(', '));

      // -- 5. speak the protocol --------------------------------------------
      mcp = startMcp(path.join(out, 'server.mjs'));
      const initialised = await mcp.call('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'verify-package', version: '1' },
      });
      mcp.notify('notifications/initialized');
      check('MCP initialize handshake', Boolean(initialised.result?.serverInfo?.name));
      check('the protocol version is echoed back', initialised.result?.protocolVersion === '2025-06-18');

      const tools = await mcp.call('tools/list');
      const names = (tools.result?.tools ?? []).map((tool) => tool.name).sort();
      check('tools/list returns the three tools', names.length === 3, names.join(', '));

      const hit = await mcp.call('tools/call', { name: 'search_docs', arguments: { query: QUERY, limit: 3 } });
      const answer = hit.result?.content?.[0]?.text ?? '';
      check('a Chinese query retrieves content', !hit.result?.isError && answer.length > 0, `${answer.length} chars`);
      check('the Chinese query hits the section, not the whole page', answer.includes(QUERY));
      check('results carry source/path/score', /source:/.test(answer) && /path:/.test(answer) && /score:/.test(answer));

      const listed = await mcp.call('tools/call', { name: 'list_docs', arguments: {} });
      check('list_docs works', /pages from/.test(listed.result?.content?.[0]?.text ?? ''));

      const empty = await mcp.call('tools/call', { name: 'search_docs', arguments: { query: '   ' } });
      check('an empty query fails instead of crashing', empty.result?.isError === true);

      const unknown = await mcp.call('tools/call', { name: 'nope', arguments: {} });
      check('an unknown tool fails cleanly', unknown.result?.isError === true);
    }
  } finally {
    mcp?.stop();
    await site?.close();
    await rm(scratch, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    process.stderr.write('\nthe package that would be published does not work:\n');
    for (const failure of failed) {
      process.stderr.write(`  - ${failure.label}\n`);
    }
    process.stderr.write(
      '\nThis check installs the tarball `npm publish` would send into a clean consumer and runs it.\n' +
        'A failure here means a stranger following the README would hit it too.\n' +
        'Files missing from the tarball: check the `files` field in package.json.\n' +
        'Entry point not found: check `bin`.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `package ok: tarball installs clean, ${results.length} assertions pass — ` +
      `the README's \`npx ${pkg.name}\` entry point works end to end\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`package check crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
