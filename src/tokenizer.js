/**
 * Tokenizer for the search index.
 *
 * Western text is split into lowercase word tokens. CJK text has no word
 * boundaries, so it is split into overlapping bigrams — the standard
 * dependency-free approach, and the reason this tool works on Chinese docs
 * where most English-first alternatives quietly return nothing.
 *
 * No imports: this module is inlined into the generated standalone server.
 */

const CJK_CHAR = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const WORD_CHAR = /[0-9A-Za-z_\u00c0-\u024f\uac00-\ud7af]/;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'was', 'were',
  'for', 'on', 'with', 'that', 'this', 'these', 'those', 'it', 'its', 'as',
  'be', 'been', 'by', 'at', 'from', 'you', 'your', 'we', 'our', 'they', 'their',
  'can', 'will', 'would', 'should', 'not', 'no', 'do', 'does', 'did', 'how',
  'what', 'which', 'when', 'where', 'who', 'use', 'using', 'used', 'if', 'then',
  'than', 'so', 'but', 'also', 'into', 'about', 'more', 'most', 'such', 'via',
]);

/**
 * @param {string} ch
 * @returns {boolean}
 */
export function isCjk(ch) {
  return CJK_CHAR.test(ch);
}

/**
 * Tokenize text into index terms. CJK runs become overlapping bigrams; a
 * single-character run is kept as-is.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const terms = [];
  const source = String(text === undefined || text === null ? '' : text);
  let word = '';
  let run = '';

  const flushWord = () => {
    if (word === '') {
      return;
    }
    const lower = word.toLowerCase();
    if (/^[0-9]+$/.test(lower) || (lower.length >= 2 && !STOPWORDS.has(lower))) {
      terms.push(lower);
    }
    word = '';
  };

  const flushRun = () => {
    if (run === '') {
      return;
    }
    if (run.length === 1) {
      terms.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) {
        terms.push(run.slice(i, i + 2));
      }
    }
    run = '';
  };

  for (const ch of source) {
    if (CJK_CHAR.test(ch)) {
      flushWord();
      run += ch;
    } else if (WORD_CHAR.test(ch)) {
      flushRun();
      word += ch;
    } else {
      flushWord();
      flushRun();
    }
  }
  flushWord();
  flushRun();

  return terms;
}

/**
 * Terms with their frequency, used when building an index.
 * @param {string} text
 * @returns {Map<string, number>}
 */
export function termFrequency(text) {
  const counts = new Map();
  for (const term of tokenize(text)) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
}
