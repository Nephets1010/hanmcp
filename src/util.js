/**
 * Shared helpers. Deliberately dependency-free: this module is inlined into the
 * generated standalone MCP server, so it must not import anything.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '\u00a9',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  laquo: '\u00ab',
  raquo: '\u00bb',
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
};

const CODE_POINT_MAX = 0x10ffff;

/**
 * Decode the HTML entities that actually show up in documentation sites.
 * Unknown entities are left untouched so nothing is silently destroyed.
 * @param {string} input
 * @returns {string}
 */
export function decodeEntities(input) {
  return String(input).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body.charAt(0) === '#') {
      const isHex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > CODE_POINT_MAX) {
        return match;
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Collapse runs of whitespace into single spaces.
 * @param {string} input
 * @returns {string}
 */
export function collapseSpaces(input) {
  return String(input).replace(/[ \t\f\v\u00a0]+/g, ' ');
}

/**
 * Strip tags, decode entities and collapse whitespace. Used for titles and
 * meta descriptions.
 * @param {string} input
 * @returns {string}
 */
export function plainText(input) {
  return collapseSpaces(decodeEntities(String(input).replace(/<[^>]*>/g, ' '))).trim();
}

/**
 * Normalise the markdown that comes out of the HTML walker: trim trailing
 * spaces, collapse excess blank lines, drop empty list items.
 * @param {string} input
 * @returns {string}
 */
export function tidyMarkdown(input) {
  return String(input)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?:^|\n)[-*]\s*\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * `URL.pathname` keeps percent-encoding, so a Chinese docs path arrives as
 * `/docs/%E6%8C%87%E5%8D%97/...`. Slugs built from that turn into unreadable
 * hex (`e6-8c-87-e5-8d-97`) — the exact problem this tool exists to avoid.
 * Malformed sequences are returned untouched rather than throwing.
 * @param {string} segment
 * @returns {string}
 */
export function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Turn an arbitrary label into a filesystem-safe, human-readable slug. Any
 * Unicode letter or digit survives, so CJK, kana and Hangul filenames stay
 * legible instead of being transliterated away.
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  const slug = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'index' : slug;
}

/**
 * Group integers with thousands separators for CLI output.
 * @param {number} value
 * @returns {string}
 */
export function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Render milliseconds as a short human duration.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
