/**
 * Index building and retrieval.
 *
 * A compact inverted index with BM25 scoring, plus a phrase bonus. It ships as
 * plain JSON so the generated MCP server can answer queries without any native
 * dependency, model download, or embedding API.
 *
 * No runtime imports beyond the tokenizer: this module is inlined into the
 * generated standalone server.
 */

import { tokenize, termFrequency } from './tokenizer.js';

export const CHUNK_SIZE = 900;
const K1 = 1.2;
const B = 0.75;
const PHRASE_BOOST = 1.6;
const HEADING_BOOST = 1.3;

/**
 * Split markdown into retrieval units, preferring heading boundaries so a chunk
 * rarely mixes two unrelated concepts.
 *
 * Cutting at headings is what makes retrieval precise: a query that matches a
 * section title should return that section, not the page introduction the title
 * happens to sit above. A heading therefore opens a new passage as soon as the
 * current one holds any body text at all. Page titles (`#`) never split, because
 * they are always the first line — and a `##` immediately after one still
 * starts a new passage, which is what keeps the first section addressable.
 * @param {string} markdown
 * @param {number} [size]
 * @returns {string[]}
 */
export function splitIntoChunks(markdown, size = CHUNK_SIZE) {
  const lines = String(markdown).split('\n');
  const chunks = [];
  let current = '';
  let hasBody = false;

  const push = () => {
    const trimmed = current.trim();
    if (trimmed !== '') {
      chunks.push(trimmed);
    }
    current = '';
    hasBody = false;
  };

  for (const line of lines) {
    if (line.length > size) {
      push();
      const pieces = Math.max(2, Math.ceil(line.length / (size * 0.75)));
      const step = Math.ceil(line.length / pieces);
      for (let index = 0; index < line.length; index += step) {
        const piece = line.slice(index, index + step).trim();
        if (piece !== '') {
          chunks.push(piece);
        }
      }
      continue;
    }

    const trimmedLine = line.trim();
    const isSectionHeading = /^#{2,6}\s/.test(trimmedLine);
    const isBlank = trimmedLine === '';
    if (isSectionHeading && hasBody) {
      push();
    }
    // A line counts as body once it is neither blank nor a heading, which is
    // what distinguishes "the intro" from "just the page title so far".
    if (!isBlank && !/^#{1,6}\s/.test(trimmedLine)) {
      hasBody = true;
    }

    current += (current === '' ? '' : '\n') + line;
    if (current.length >= size) {
      push();
    }
  }

  push();
  return chunks;
}

/**
 * @param {string} text
 * @returns {string}
 */
function firstHeading(text) {
  const match = /^#{1,6}\s+(.+)$/m.exec(text);
  return match === null ? '' : match[1].trim();
}

/**
 * Build a serialisable index from crawled pages.
 * @param {Array<{url: string, path: string, title: string, description: string, markdown: string}>} pages
 * @param {{builtAt?: string, source?: string}} [meta]
 * @returns {object}
 */
export function buildIndex(pages, meta = {}) {
  const docs = [];
  const chunks = [];
  const lengths = [];
  const postings = new Map();
  const df = new Map();

  for (const page of pages) {
    const docId = docs.length;
    docs.push({
      id: docId,
      path: page.path,
      url: page.url,
      title: page.title,
      description: page.description || '',
      bytes: Buffer.byteLength(page.markdown, 'utf8'),
    });

    const parts = splitIntoChunks(page.markdown);
    parts.forEach((text, partIndex) => {
      const chunkId = chunks.length;
      const heading = firstHeading(text) || page.title;
      chunks.push({ id: chunkId, doc: docId, part: partIndex, heading, text });

      const counts = termFrequency(`${page.title}\n${page.description || ''}\n${heading}\n${text}`);
      let length = 0;
      for (const [term, count] of counts) {
        length += count;
        if (!postings.has(term)) {
          postings.set(term, []);
        }
        const list = postings.get(term);
        const last = list[list.length - 1];
        if (last !== undefined && last[0] === chunkId) {
          last[1] += count;
        } else {
          list.push([chunkId, count]);
        }
        df.set(term, (df.get(term) || 0) + 1);
      }
      lengths.push(length);
    });
  }

  const totalLength = lengths.reduce((sum, value) => sum + value, 0);
  const postingsObject = {};
  for (const [term, list] of postings) {
    postingsObject[term] = list;
  }
  const dfObject = {};
  for (const [term, count] of df) {
    dfObject[term] = count;
  }

  return {
    version: 1,
    builtAt: meta.builtAt || new Date().toISOString(),
    source: meta.source || '',
    stats: {
      pages: docs.length,
      chunks: chunks.length,
      terms: postings.size,
      averageLength: chunks.length === 0 ? 0 : Number((totalLength / chunks.length).toFixed(2)),
    },
    docs,
    chunks,
    lengths,
    postings: postingsObject,
    df: dfObject,
  };
}

/**
 * @param {string} text
 * @param {string} needle
 * @param {string[]} terms
 * @returns {string}
 */
function makeSnippet(text, needle, terms) {
  const haystack = text.toLowerCase();
  let index = needle.length >= 2 ? haystack.indexOf(needle) : -1;
  if (index === -1) {
    for (const term of terms) {
      const found = haystack.indexOf(term);
      if (found !== -1 && (index === -1 || found < index)) {
        index = found;
      }
    }
  }
  if (index === -1) {
    return text.slice(0, 280).trim();
  }
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + 200);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * @param {object} index
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<{score: number, path: string, url: string, title: string, heading: string, snippet: string, text: string}>}
 */
export function searchIndex(index, query, limit = 5) {
  const terms = tokenize(query);
  if (terms.length === 0 || index.chunks.length === 0) {
    return [];
  }

  const total = index.chunks.length;
  const average = index.stats.averageLength || 1;
  const scores = new Map();

  for (const term of terms) {
    const posting = index.postings[term];
    if (posting === undefined) {
      continue;
    }
    const documentFrequency = index.df[term] || posting.length;
    const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
    for (const [chunkId, frequency] of posting) {
      const length = index.lengths[chunkId] || 1;
      const weight = (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / average));
      scores.set(chunkId, (scores.get(chunkId) || 0) + idf * weight);
    }
  }

  const needle = String(query).trim().toLowerCase();
  const ranked = [];
  for (const [chunkId, baseScore] of scores) {
    const chunk = index.chunks[chunkId];
    let score = baseScore;
    if (needle.length >= 2) {
      if (chunk.text.toLowerCase().includes(needle)) {
        score *= PHRASE_BOOST;
      }
      if (chunk.heading.toLowerCase().includes(needle)) {
        score *= HEADING_BOOST;
      }
    }
    ranked.push({ chunkId, score, chunk });
  }

  ranked.sort((a, b) => b.score - a.score || a.chunkId - b.chunkId);

  return ranked.slice(0, Math.max(1, limit)).map((entry) => {
    const doc = index.docs[entry.chunk.doc];
    return {
      score: Number(entry.score.toFixed(4)),
      path: doc.path,
      url: doc.url,
      title: doc.title,
      heading: entry.chunk.heading,
      snippet: makeSnippet(entry.chunk.text, needle, terms),
      text: entry.chunk.text,
    };
  });
}

/**
 * Documents ordered by path, for listing tools.
 * @param {object} index
 * @returns {Array<{path: string, url: string, title: string, description: string, bytes: number}>}
 */
export function listDocuments(index) {
  return index.docs
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((doc) => ({
      path: doc.path,
      url: doc.url,
      title: doc.title,
      description: doc.description,
      bytes: doc.bytes,
    }));
}
