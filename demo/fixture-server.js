/**
 * Zero-dependency static file server, used to serve a documentation site over
 * localhost during the demo and during the end-to-end test.
 *
 * It serves two different roots, and the distinction matters:
 *
 * - `site/` — hanmcp's own documentation site. The demo crawls this, so the
 *   recording shows the tool being used on a real site with real content.
 * - `demo/fixture/` — a frozen fixture site. The test suite crawls this, so the
 *   tests do not break every time someone edits the docs.
 *
 * Both are served by the same code path, so a page that works in the demo works
 * in the test and vice versa.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** hanmcp's own docs, crawled by the demo recording. */
export const SITE_ROOT = path.join(REPO_ROOT, 'site');

/** The frozen fixture site, crawled by the test suite. */
export const FIXTURE_ROOT = path.join(REPO_ROOT, 'demo', 'fixture');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * @param {{port?: number, root?: string}} [options]
 * @returns {Promise<{port: number, origin: string, root: string, close: () => Promise<void>}>}
 */
export async function startStaticServer(options = {}) {
  const root = path.resolve(options.root ?? SITE_ROOT);

  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let target = path.join(root, pathname);

    if (!target.startsWith(root)) {
      response.writeHead(403, { 'content-type': 'text/plain' });
      response.end('forbidden');
      return;
    }

    try {
      const info = await stat(target);
      if (info.isDirectory()) {
        target = path.join(target, 'index.html');
      }
      const body = await readFile(target);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      // A pinned demo port colliding with something else is a common enough
      // mistake to be worth naming, rather than surfacing a bare EADDRINUSE.
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`port ${options.port} is already in use; set DEMO_PORT=0 to pick a free one`));
        return;
      }
      reject(error);
    });
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    port,
    root,
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * Start a server on hanmcp's own documentation site.
 * @param {{port?: number}} [options]
 */
export function startSiteServer(options = {}) {
  return startStaticServer({ ...options, root: SITE_ROOT });
}

/**
 * Start a server on the frozen fixture site.
 * @param {{port?: number}} [options]
 */
export function startFixtureServer(options = {}) {
  return startStaticServer({ ...options, root: FIXTURE_ROOT });
}
