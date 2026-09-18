/**
 * HTML → Markdown extraction.
 *
 * Regex-driven rather than parser-driven, on purpose: the whole tool stays
 * dependency-free, which is what lets `npx hanmcp <url>` finish in one
 * command with no install step. The trade-off is documented in the README.
 */

import { decodeEntities, collapseSpaces, plainText, tidyMarkdown } from './util.js';

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

/** Structural chrome that is noise once we have the content. */
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'template', 'iframe', 'canvas', 'form',
  'button', 'select', 'option', 'textarea', 'nav', 'header', 'footer', 'aside',
  'link', 'meta', 'figure', 'picture', 'video', 'audio', 'object', 'embed',
  'dialog', 'menu',
]);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * @param {string} token
 * @returns {{name: string, attrs: string, isClosing: boolean, selfClosing: boolean}}
 */
function parseTag(token) {
  const isClosing = token.charAt(1) === '/';
  const inner = token.slice(isClosing ? 2 : 1, token.endsWith('/>') ? -2 : -1);
  const match = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(inner.trim());
  if (match === null) {
    return { name: '', attrs: '', isClosing, selfClosing: false };
  }
  const name = match[1].toLowerCase();
  return {
    name,
    attrs: inner.trim().slice(match[1].length),
    isClosing,
    selfClosing: token.endsWith('/>') || VOID_TAGS.has(name),
  };
}

/**
 * @param {string} attrs
 * @param {string} key
 * @returns {string}
 */
function attr(attrs, key) {
  const pattern = new RegExp(`(?:^|\\s)${key}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const match = pattern.exec(attrs);
  if (match === null) {
    return '';
  }
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
}

/**
 * @param {string} html
 * @returns {string}
 */
function effectiveBase(html, baseUrl) {
  const baseTag = /<base\b([^>]*)>/i.exec(html);
  if (baseTag === null) {
    return baseUrl;
  }
  const href = attr(baseTag[1], 'href');
  if (href === '') {
    return baseUrl;
  }
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return baseUrl;
  }
}

/**
 * Pick the most content-like region of the page. Prefers <main>, then the
 * longest <article>, then <body>.
 * @param {string} html
 * @returns {string}
 */
function pickRoot(html) {
  const candidates = [];
  for (const tag of ['main', 'article']) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match;
    while ((match = re.exec(html)) !== null) {
      candidates.push({ tag, text: match[1] });
    }
  }
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.text.length - a.text.length);
    return candidates[0].text;
  }
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return body === null ? html : body[1];
}

/**
 * Convert an HTML fragment to Markdown. Markers are suppressed inside anchors
 * so that link-wrapped cards do not produce `[### Title](url)` garbage.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string}
 */
function htmlToMarkdown(html, baseUrl) {
  const tokens = String(html).split(/(<[^>]*>)/);
  const out = [];
  const skipStack = [];
  const listStack = [];

  let inPre = false;
  let preFenceOpen = false;
  let preLang = '';
  let strongDepth = 0;
  let emDepth = 0;
  let link = null;

  const emitText = (text) => {
    if (text === '') {
      return;
    }
    if (link !== null) {
      link.text += text;
      return;
    }
    out.push(text);
  };

  const emitMark = (marker) => {
    if (link !== null) {
      return;
    }
    out.push(marker);
  };

  for (const token of tokens) {
    if (token === '') {
      continue;
    }

    if (token.startsWith('<')) {
      const tag = parseTag(token);
      if (tag.name === '') {
        continue;
      }

      if (skipStack.length > 0) {
        if (tag.isClosing) {
          const index = skipStack.lastIndexOf(tag.name);
          if (index !== -1) {
            skipStack.splice(index);
          }
        } else if (!tag.selfClosing && DROP_TAGS.has(tag.name)) {
          skipStack.push(tag.name);
        }
        continue;
      }

      if (!tag.isClosing && DROP_TAGS.has(tag.name)) {
        if (!tag.selfClosing) {
          skipStack.push(tag.name);
        }
        continue;
      }

      if (inPre) {
        if (tag.name === 'pre' && tag.isClosing) {
          if (preFenceOpen) {
            out.push('\n```\n\n');
            preFenceOpen = false;
          }
          inPre = false;
          preLang = '';
        } else if (tag.name === 'code' && !tag.isClosing) {
          const className = attr(tag.attrs, 'class');
          const lang = /(?:language|lang)-([a-zA-Z0-9+#]+)/.exec(className);
          if (lang !== null && preLang === '' && !preFenceOpen) {
            preLang = lang[1].toLowerCase();
          }
        }
        continue;
      }

      if (tag.name === 'pre' && !tag.isClosing) {
        inPre = true;
        preFenceOpen = false;
        preLang = '';
        continue;
      }

      if (tag.name === 'a') {
        if (tag.isClosing) {
          if (link !== null) {
            const text = collapseSpaces(link.text).trim();
            const href = link.href;
            if (text !== '' && href !== '') {
              out.push(`[${text}](${href})`);
            } else if (text !== '') {
              out.push(text);
            }
            link = null;
          }
        } else if (link === null) {
          const raw = attr(tag.attrs, 'href');
          let href = '';
          if (raw !== '' && !/^(#|javascript:|mailto:)/i.test(raw)) {
            try {
              href = new URL(raw, baseUrl).href;
            } catch {
              href = '';
            }
          }
          link = { href, text: '' };
        }
        continue;
      }

      if (tag.name === 'img') {
        const alt = plainText(attr(tag.attrs, 'alt'));
        const src = attr(tag.attrs, 'src');
        if (src !== '' && !src.startsWith('data:')) {
          let absolute = src;
          try {
            absolute = new URL(src, baseUrl).href;
          } catch {
            absolute = src;
          }
          emitMark(`![${alt}](${absolute})`);
        }
        continue;
      }

      if (HEADING_TAGS.has(tag.name)) {
        const level = Number.parseInt(tag.name.slice(1), 10);
        if (tag.isClosing) {
          emitMark('\n\n');
        } else {
          emitMark(`\n\n${'#'.repeat(level)} `);
        }
        continue;
      }

      if (tag.name === 'code') {
        if (link === null) {
          emitMark('`');
        }
        continue;
      }

      if (tag.name === 'strong' || tag.name === 'b') {
        if (tag.isClosing) {
          if (strongDepth > 0) {
            strongDepth -= 1;
            emitMark('**');
          }
        } else if (link === null) {
          strongDepth += 1;
          emitMark('**');
        }
        continue;
      }

      if (tag.name === 'em' || tag.name === 'i') {
        if (tag.isClosing) {
          if (emDepth > 0) {
            emDepth -= 1;
            emitMark('*');
          }
        } else if (link === null) {
          emDepth += 1;
          emitMark('*');
        }
        continue;
      }

      if (tag.name === 'br') {
        emitMark('\n');
        continue;
      }

      if (tag.name === 'hr') {
        emitMark('\n\n---\n\n');
        continue;
      }

      if (tag.name === 'ul' || tag.name === 'ol') {
        if (tag.isClosing) {
          listStack.pop();
          emitMark('\n');
        } else {
          listStack.push(tag.name);
          emitMark('\n');
        }
        continue;
      }

      if (tag.name === 'li') {
        if (tag.isClosing) {
          emitMark('\n');
        } else {
          const depth = Math.max(0, listStack.length - 1);
          emitMark(`\n${'  '.repeat(depth)}- `);
        }
        continue;
      }

      if (tag.name === 'td' || tag.name === 'th') {
        emitMark(tag.isClosing ? ' ' : ' | ');
        continue;
      }

      if (tag.name === 'tr') {
        if (tag.isClosing) {
          emitMark('\n');
        }
        continue;
      }

      if (tag.name === 'table') {
        emitMark('\n\n');
        continue;
      }

      if (tag.name === 'p' || tag.name === 'div' || tag.name === 'section' ||
          tag.name === 'blockquote' || tag.name === 'dl' || tag.name === 'dd' ||
          tag.name === 'dt' || tag.name === 'main' || tag.name === 'article') {
        emitMark('\n\n');
        continue;
      }

      continue;
    }

    if (skipStack.length > 0) {
      continue;
    }

    const decoded = decodeEntities(token);

    if (inPre) {
      if (!preFenceOpen) {
        out.push(`\n\n\`\`\`${preLang}\n`);
        preFenceOpen = true;
      }
      out.push(decoded);
    } else {
      emitText(decoded.replace(/\s+/g, ' '));
    }
  }

  let markdown = out.join('');
  const boldMarkers = markdown.match(/\*\*/g);
  if (boldMarkers !== null && boldMarkers.length % 2 === 1) {
    const lastIndex = markdown.lastIndexOf('**');
    markdown = markdown.slice(0, lastIndex) + markdown.slice(lastIndex + 2);
  }
  return markdown;
}

/**
 * Every http(s) link on the page, de-duplicated and normalised.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function extractLinks(html, baseUrl) {
  const base = effectiveBase(html, baseUrl);
  const found = [];
  const seen = new Set();
  const re = /<a\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const raw = attr(match[1], 'href');
    if (raw === '' || /^(#|javascript:|mailto:|tel:)/i.test(raw)) {
      continue;
    }
    let resolved;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      continue;
    }
    resolved.hash = '';
    const url = resolved.href.replace(/\/$/, '');
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    found.push(url);
    if (found.length >= 500) {
      break;
    }
  }
  return found;
}

/**
 * @param {string} html
 * @returns {string}
 */
function extractTitle(html) {
  const og = /<meta\b[^>]*property=["']og:title["'][^>]*>/i.exec(html);
  if (og !== null) {
    const content = plainText(attr(og[0].slice(og[0].indexOf(' ') + 1), 'content'));
    if (content !== '') {
      return content;
    }
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (titleTag !== null) {
    const text = plainText(titleTag[1]);
    if (text !== '') {
      return text;
    }
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h1 === null ? '' : plainText(h1[1]);
}

/**
 * @param {string} html
 * @returns {string}
 */
function extractDescription(html) {
  for (const pattern of [
    /<meta\b[^>]*name=["']description["'][^>]*>/i,
    /<meta\b[^>]*property=["']og:description["'][^>]*>/i,
  ]) {
    const match = pattern.exec(html);
    if (match !== null) {
      const content = plainText(attr(match[0].slice(match[0].indexOf(' ') + 1), 'content'));
      if (content !== '') {
        return content;
      }
    }
  }
  return '';
}

/**
 * Extract the readable part of an HTML document.
 * @param {string} html
 * @param {{url?: string}} [options]
 * @returns {{title: string, description: string, markdown: string, links: string[]}}
 */
export function extractDocument(html, options = {}) {
  const source = String(html === undefined || html === null ? '' : html);
  const baseUrl = options.url || '';
  const root = pickRoot(source);
  return {
    title: extractTitle(source),
    description: extractDescription(source),
    markdown: tidyMarkdown(htmlToMarkdown(root, baseUrl)),
    links: extractLinks(source, baseUrl),
  };
}
