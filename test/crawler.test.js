import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRobots, pathFromUrl, isInScope, scopePathOf, normalizeUrl } from '../src/crawler.js';

test('robots.txt blocks the disallowed prefix and allows the rest', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /docs/private/\n', 'hanmcp/0.1');
  assert.equal(robots.allowed('/docs/private/roadmap.html'), false);
  assert.equal(robots.allowed('/docs/public/roadmap.html'), true);
});

test('an empty disallow means everything is allowed', () => {
  const robots = parseRobots('User-agent: *\nDisallow:\n', 'hanmcp/0.1');
  assert.equal(robots.allowed('/anything'), true);
});

test('the most specific user-agent group wins', () => {
  const text = ['User-agent: *', 'Disallow: /', '', 'User-agent: hanmcp', 'Disallow: /private/'].join('\n');
  const robots = parseRobots(text, 'hanmcp/0.1');
  assert.equal(robots.allowed('/docs/'), true);
  assert.equal(robots.allowed('/private/x'), false);
});

test('the longest matching rule wins, including allow overrides', () => {
  const text = ['User-agent: *', 'Disallow: /docs/', 'Allow: /docs/public/'].join('\n');
  const robots = parseRobots(text, 'hanmcp/0.1');
  assert.equal(robots.allowed('/docs/private/a'), false);
  assert.equal(robots.allowed('/docs/public/a'), true);
});

test('crawl-delay is parsed and capped', () => {
  const robots = parseRobots('User-agent: *\nCrawl-delay: 30\n', 'hanmcp/0.1');
  assert.equal(robots.crawlDelayMs, 2000);
});

test('comments and blank lines are ignored', () => {
  const robots = parseRobots('# hello\n\nUser-agent: * # all bots\nDisallow: /x\n', 'hanmcp/0.1');
  assert.equal(robots.allowed('/x'), false);
});

test('scope is the containing directory when the url has no trailing slash', () => {
  assert.equal(scopePathOf(new URL('https://a.com/docs/v2/start.html')), '/docs/v2/');
  assert.equal(scopePathOf(new URL('https://a.com/docs/')), '/docs/');
  assert.equal(scopePathOf(new URL('https://a.com/')), '/');
});

test('the entry url itself counts as in scope', () => {
  assert.equal(isInScope('/docs', '/docs/'), true);
  assert.equal(isInScope('/docs/', '/docs/'), true);
  assert.equal(isInScope('/docs/guide/a.html', '/docs/'), true);
  assert.equal(isInScope('/blog/a', '/docs/'), false);
  assert.equal(isInScope('/anything', '/'), true);
});

test('trailing slashes are stripped during normalisation', () => {
  assert.equal(normalizeUrl('https://a.com/docs/'), 'https://a.com/docs');
  assert.equal(normalizeUrl('https://a.com/#frag'), 'https://a.com');
});

test('an explicit index document normalises to its directory', () => {
  assert.equal(normalizeUrl('https://a.com/docs/zh/index.html'), 'https://a.com/docs/zh');
  assert.equal(normalizeUrl('https://a.com/docs/zh/index.htm'), 'https://a.com/docs/zh');
  assert.equal(normalizeUrl('https://a.com/docs/zh/'), 'https://a.com/docs/zh');
  // A site root serves the same page either way, so it collapses too.
  assert.equal(normalizeUrl('https://a.com/index.html'), 'https://a.com');
});

test('an index page and its directory produce one markdown path, not two', () => {
  const viaDirectory = pathFromUrl('https://a.com/docs/', 'https://a.com/docs/zh/');
  const viaIndex = pathFromUrl('https://a.com/docs/', 'https://a.com/docs/zh/index.html');
  assert.equal(viaDirectory, 'zh.md');
  assert.equal(viaIndex, viaDirectory);
});

test('the entry page maps to index.md, not to its folder name', () => {
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docs'), 'index.md');
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docs/'), 'index.md');
});

test('nested pages map to nested markdown paths', () => {
  assert.equal(
    pathFromUrl('https://a.com/docs/', 'https://a.com/docs/guide/getting-started.html'),
    'guide/getting-started.md',
  );
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docs/api/v2.html'), 'api/v2.md');
});

test('cjk path segments are preserved so filenames stay readable', () => {
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docs/指南/快速上手.html'), '指南/快速上手.md');
});

test('a page outside the scope still produces a relative path', () => {
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docs'), 'index.md');
  assert.equal(pathFromUrl('https://a.com/docs/', 'https://a.com/docsx/a.html'), 'docsx/a.md');
});
