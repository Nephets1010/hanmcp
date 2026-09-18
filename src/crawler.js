/**
 * Polite same-origin crawler.
 *
 * Defaults are deliberately conservative: depth 2, 50 pages, ~120ms between
 * requests, robots.txt respected. A docs-to-MCP tool that hammers someone's
 * site is a tool nobody wants to recommend.
 */

import { decodePathSegment, slugify, sleep } from './util.js';
import { extractDocument } from './html.js';

const SKIPPED_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|css|js|mjs|cjs|map|json|xml|txt|md|zip|tgz|tar|gz|7z|rar|pdf|docx?|xlsx?|pptx?|mp4|mov|avi|mp3|wav|ogg|woff2?|ttf|otf|eot|wasm|exe|dmg)$/i;

const MAX_LINKS_PER_PAGE = 500;

/**
 * Minimal robots.txt evaluation. Prefix matching only — wildcards and `$`
 * anchors are not supported, which is noted in the README.
 * @param {string} text
 * @param {string} userAgent
 * @returns {{allowed: (pathname: string) => boolean, crawlDelayMs: number}}
 */
export function parseRobots(text, userAgent) {
  const uaToken = String(userAgent || '').split('/')[0].toLowerCase();
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [], crawlDelay: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (current === null) {
      continue;
    }
    lastWasAgent = false;
    if (field === 'disallow') {
      current.rules.push({ allow: false, path: value });
    } else if (field === 'allow') {
      current.rules.push({ allow: true, path: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelay = seconds;
      }
    }
  }

  let chosen = null;
  let bestScore = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      let score = -1;
      if (agent === '*') {
        score = 0;
      } else if (uaToken !== '' && (agent === uaToken || uaToken.includes(agent))) {
        score = agent.length;
      }
      if (score > bestScore) {
        bestScore = score;
        chosen = group;
      }
    }
  }

  if (chosen === null) {
    return { allowed: () => true, crawlDelayMs: 0 };
  }

  const rules = chosen.rules
    .filter((rule) => rule.path !== '')
    .slice()
    .sort((a, b) => b.path.length - a.path.length);

  const allowed = (pathname) => {
    for (const rule of rules) {
      if (pathname.startsWith(rule.path)) {
        return rule.allow;
      }
    }
    return true;
  };

  const crawlDelayMs = Math.min(2000, Math.round((chosen.crawlDelay || 0) * 1000));
  return { allowed, crawlDelayMs };
}

/**
 * With no trailing slash the scope is the containing directory, so pointing at
 * `https://site/docs/v2/start.html` does not drag in the whole site.
 * @param {URL} url
 * @returns {string}
 */
export function scopePathOf(url) {
  if (url.pathname === '' || url.pathname === '/') {
    return '/';
  }
  if (url.pathname.endsWith('/')) {
    return url.pathname;
  }
  return `${url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)}`;
}

/**
 * The entry URL itself normalises to `scope` without its trailing slash, so a
 * plain `startsWith(scope)` test would reject the very page we were asked to
 * index.
 * @param {string} pathname
 * @param {string} scope
 * @returns {boolean}
 */
export function isInScope(pathname, scope) {
  if (scope === '/') {
    return true;
  }
  if (pathname === scope || pathname === scope.replace(/\/$/, '')) {
    return true;
  }
  return pathname.startsWith(scope);
}

/**
 * Normalise for de-duplication: no hash, no trailing slash, and no explicit
 * index document.
 *
 * The index collapse matters more than it looks. `/docs/zh/` and
 * `/docs/zh/index.html` are the same page, and sites link to both — a nav bar
 * uses one, a body link uses the other. Without collapsing them the same page
 * is fetched twice and indexed twice under two different paths, which then
 * shows up as duplicate search results.
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  let href = parsed.href;
  if (href.length > 1 && href.endsWith('/')) {
    href = href.slice(0, -1);
  }
  // `…/dir/index.html` and `…/dir/` are one page. A root-level `index.html` is
  // left alone: it is a file someone linked to explicitly, not a directory alias.
  const collapsed = href.replace(/(\/[^/]+)\/index\.html?$/i, '$1');
  // A root-level `index.html` collapses to an empty string, which is not a URL.
  return collapsed === '' ? href : collapsed;
}

/**
 * @param {string} startUrl
 * @param {string} pageUrl
 * @returns {string} relative markdown path, e.g. `guide/getting-started.md`
 */
export function pathFromUrl(startUrl, pageUrl) {
  const scope = scopePathOf(new URL(startUrl));
  const scopeWithoutSlash = scope === '/' ? '' : scope.replace(/\/$/, '');
  let relative = new URL(pageUrl).pathname;

  if (scopeWithoutSlash !== '' && (relative === scopeWithoutSlash || relative === scope)) {
    relative = '/';
  } else if (scopeWithoutSlash !== '' && relative.startsWith(scope)) {
    relative = relative.slice(scope.length);
  }

  relative = relative.replace(/^\/+/, '');
  // A trailing slash means "the index page of this directory". Drop the slash
  // and let the segment naming below produce `zh.md`, which is the same path a
  // link to `/docs/zh` (no slash) produces — otherwise the two aliases of one
  // page write two files.
  if (relative.endsWith('/')) {
    relative = relative.slice(0, -1);
  }
  // An explicit `index.html` names the same page as its directory.
  relative = relative.replace(/(^|\/)(index|default)\.html?$/i, '$1');
  if (relative === '') {
    relative = 'index';
  }
  relative = relative.replace(/\.(html?|php|aspx?|md)$/i, '');
  // Percent-encoded segments are decoded before slugging, so `/docs/%E6%8C%87%E5%8D%97/`
  // becomes `docs/指南/` rather than a run of hex bytes.
  const segments = relative
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => slugify(decodePathSegment(segment)));
  if (segments.length === 0) {
    segments.push('index');
  }
  return `${segments.join('/')}.md`;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function looksLikeDocumentation(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (SKIPPED_EXTENSIONS.test(parsed.pathname)) {
    return false;
  }
  if (parsed.search !== '') {
    return false;
  }
  return true;
}

/**
 * @param {string} url
 * @param {string} userAgent
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status: number, html: string, contentType: string}>}
 */
async function fetchPage(url, userAgent, timeoutMs) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get('content-type') || '';
  const html = response.ok && contentType.includes('html') ? await response.text() : '';
  return { ok: response.ok, status: response.status, html, contentType };
}

/**
 * @param {string} startUrl
 * @param {object} [options]
 * @param {number} [options.maxPages]
 * @param {number} [options.maxDepth]
 * @param {boolean} [options.respectRobots]
 * @param {number} [options.delayMs]
 * @param {number} [options.timeoutMs]
 * @param {string} [options.userAgent]
 * @param {(page: number, url: string, title: string) => void} [options.onPage]
 * @param {(message: string) => void} [options.onSkip]
 * @returns {Promise<Array<{url: string, path: string, title: string, description: string, markdown: string, depth: number}>>}
 */
export async function crawl(startUrl, options = {}) {
  const maxPages = options.maxPages ?? 50;
  const maxDepth = options.maxDepth ?? 2;
  const respectRobots = options.respectRobots !== false;
  const userAgent = options.userAgent || 'hanmcp/0.1 (+https://github.com/Nephets1010/hanmcp)';
  const timeoutMs = options.timeoutMs ?? 15000;
  const onPage = options.onPage || (() => {});
  const onSkip = options.onSkip || (() => {});

  const start = new URL(startUrl);
  const origin = start.origin;
  const scope = scopePathOf(start);

  let delayMs = options.delayMs ?? 120;
  let robotsAllowed = () => true;

  if (respectRobots) {
    try {
      const response = await fetch(new URL('/robots.txt', origin).href, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const robots = parseRobots(await response.text(), userAgent);
        robotsAllowed = robots.allowed;
        if (options.delayMs === undefined && robots.crawlDelayMs > 0) {
          delayMs = robots.crawlDelayMs;
        }
      }
    } catch {
      onSkip('robots.txt unavailable, continuing');
    }
  }

  const seen = new Set();
  const queue = [{ url: normalizeUrl(start.href), depth: 0 }];
  const pages = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const item = queue.shift();
    if (item === undefined || seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);

    const parsed = new URL(item.url);
    if (parsed.origin !== origin || !isInScope(parsed.pathname, scope)) {
      continue;
    }
    if (!robotsAllowed(parsed.pathname)) {
      onSkip(`robots.txt disallows ${parsed.pathname}`);
      continue;
    }

    let page;
    try {
      page = await fetchPage(item.url, userAgent, timeoutMs);
    } catch (error) {
      onSkip(`${item.url} failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!page.ok || page.html === '') {
      onSkip(`${item.url} skipped (status ${page.status}${page.contentType ? `, ${page.contentType.split(';')[0]}` : ''})`);
      continue;
    }

    const document = extractDocument(page.html, { url: item.url });
    if (document.markdown.length < 80) {
      onSkip(`${item.url} had too little content`);
      continue;
    }

    const record = {
      url: item.url,
      path: pathFromUrl(startUrl, item.url),
      title: document.title || item.url,
      description: document.description,
      markdown: document.markdown,
      depth: item.depth,
    };
    pages.push(record);
    onPage(pages.length, record.url, record.title);

    if (item.depth < maxDepth) {
      const links = document.links.slice(0, MAX_LINKS_PER_PAGE);
      for (const link of links) {
        if (!looksLikeDocumentation(link)) {
          continue;
        }
        const normalized = normalizeUrl(link);
        if (seen.has(normalized)) {
          continue;
        }
        const target = new URL(normalized);
        if (target.origin !== origin || !isInScope(target.pathname, scope)) {
          continue;
        }
        queue.push({ url: normalized, depth: item.depth + 1 });
      }
    }

    if (queue.length > 0 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return pages.sort((a, b) => a.path.localeCompare(b.path));
}
