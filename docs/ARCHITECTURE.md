# Architecture

A tour of the module map and, more usefully, the decisions behind it. Read this before a large change: most of the code is shaped by constraints that are easy to violate accidentally.

## The shape of the thing

```
  URL ──► crawl ──► extract ──► index ──► emit ──► bundle
          │          │           │         │        │
     crawler.js   html.js    search.js  build.js  bundle.js
                                 │        │
                          tokenizer.js  llms.js
                                 └────────┴── util.js
```

Every box is plain JavaScript with **no runtime imports except each other**, and a subset is special:

> `util.js`, `tokenizer.js`, `search.js`, `llms.js` and `mcp-runtime.js` are **inlined verbatim** into the generated `server.mjs`. They must not import anything — not `node:fs`, not a relative path. `scripts/syntax-check.js` fails the build if a broken bundle is produced, because no unit test would catch it.

| File | Responsibility | Inlined? |
| --- | --- | --- |
| `src/cli.js` | Argument parsing, terminal output, exit codes | No |
| `src/crawler.js` | Polite same-origin BFS, `robots.txt`, URL → path mapping | No |
| `src/html.js` | HTML → title, description, markdown, links | No |
| `src/tokenizer.js` | Latin words, CJK bigrams | **Yes** |
| `src/search.js` | Chunking, index build, BM25 scoring | **Yes** |
| `src/llms.js` | `llms.txt` and `llms-full.txt` rendering | **Yes** |
| `src/mcp-runtime.js` | JSON-RPC over stdio, the three tools | **Yes** |
| `src/bundle.js` | Concatenates the above into `server.mjs` | No |
| `src/build.js` | Orchestration, output-directory safety, manifest | No |
| `src/util.js` | Entities, slugs, formatting | **Yes** |

## Decisions worth knowing

### Zero dependencies is a product requirement, not a preference

The promise is that the generated `server.mjs` runs on a machine with Node installed and nothing else. A dependency anywhere in the inlined set breaks that promise at the worst possible moment — on the user's machine, not in CI.

So the toolkit is hand-written: an HTML-to-markdown walker instead of a parser library, a BM25 index instead of a search engine, a bigram tokenizer instead of a segmenter. CI fails the build if `dependencies` or `devDependencies` becomes non-empty.

### CJK is tokenized as overlapping bigrams

Chinese, Japanese and Korean have no spaces. The standard dependency-free approach is to cut every run of CJK characters into overlapping two-character tokens: `内存占用` → `内存`, `存占`, `占用`.

It is crude and it works. `占用` is a real query term that a whole-run token would miss entirely. A proper segmenter would be more precise and would mean shipping a dictionary — a dependency, and a large one.

Two behaviours that follow from this and are easy to break:

- A **single-character run is kept whole**, not dropped. `的` is a legitimate term.
- Bigrams **do not cross a boundary**. In `内存disk占用`, the latin word ends the run, so there is no `存d` or `k占` token. The tokenizer flushes the run on any non-CJK character.

CJK characters are kept in generated filenames for the same reason they are indexed: a user has to be able to read `zh/内存调优.md`. `URL.pathname` keeps percent-encoding, so a Chinese path arrives as `%E5%86%85...` and must be decoded **before** slugging — otherwise the slug is `e5-86-85-...`. This is the bug the fixture page `demo/fixture/docs/zh/内存调优.html` exists to prevent from returning.

### The crawler is deliberately conservative

Defaults are depth 2, 50 pages, ~120 ms between requests, `robots.txt` respected. A docs-to-MCP tool that hammers someone's site is a tool nobody recommends, and the cost of a wider default is that one user's first run looks slightly slow. Losing the benefit of the doubt is much more expensive.

`robots.txt` evaluation is prefix matching only — no wildcards, no `$` anchors. This is documented in the README rather than left as a surprise, and ambiguous cases are treated as allowed, matching common crawler behaviour.

**Scope rule:** `/docs/` crawls the subtree; `/docs/v2/start.html` crawls only the containing directory. The entry URL itself normalises to the scope without its trailing slash, so a naive `startsWith(scope)` would reject the very page it was asked to index — hence `isInScope()`. This is a real bug that existed and is now covered by tests.

### The output directory is owned, and ownership is claimed early

`--out` takes a user-supplied path and the build clears it. The rules:

- A filesystem root is always refused.
- The current working directory is always refused.
- A directory that is neither empty nor marked is refused unless `--force`.
- `.hanmcp` records ownership and is written **as soon as the directory is created**, not at the end.

That last point is not incidental. An earlier version wrote the marker last, so a crawl that failed left a half-populated unmarked directory that the next run refused to touch — the user had to delete it by hand before retrying, and the error message pointed at the wrong problem. Claiming ownership up front keeps failed builds retryable.

The two marker files now mean different things: `.hanmcp` is ownership (written first), `manifest.json` is completion (written last).

### Nothing but JSON-RPC goes to stdout

The generated server is a stdio MCP server. Its stdout is a protocol stream, and a stray `console.log` corrupts it. All human-readable output goes to stderr, including the startup banner. `callMcpServer` in `demo/mcp-client.js` records anything on stdout it could not parse as JSON, and the end-to-end test asserts that list is empty.

This is why the generated server prints `... ready: <dir>` on **stderr** while a user watching a terminal still sees it.

### Writes are atomic enough to be safe to interrupt

Page files are written as they are crawled; `manifest.json` last. An interrupted build therefore produces a directory with no manifest, which is detectable, and which the next run will clear.

## Safety properties and where they are enforced

| Property | Enforced in | Tested in |
| --- | --- | --- |
| No path traversal out of the docs directory | `get_doc` in `mcp-runtime.js` | `mcp.test.js`, `e2e.test.js` |
| Never delete a directory we do not own | `prepareOutputDir` | `build.test.js` |
| Never use a root or the cwd as output | `prepareOutputDir` | `build.test.js` |
| `robots.txt` honoured by default | `crawl` | `crawler.test.js`, `e2e.test.js` |
| stdout carries only JSON-RPC | `mcp-runtime.js` | `e2e.test.js` |
| The bundle is genuinely self-contained | `bundle.js` | `scripts/verify-portable.js` |
| The bundle parses as valid JavaScript | `bundle.js` | `scripts/syntax-check.js` |

## What is deliberately absent

- **No JavaScript rendering.** A headless browser is a dependency and a large one. Pages needing one are skipped.
- **No incremental re-crawl.** Full rebuild every time. The artifacts are designed to be diffed instead.
- **No vector search.** BM25 only: no model download, no embedding API, works offline, and explainable scores.
- **No hosted component.** Not now, not later.
- **No config file.** Flags only. A config file is a schema to version and migrate; there are nine flags.

## Testing strategy

The suite never touches the public internet. `demo/fixture-server.js` serves a static site on `localhost` and both the tests and the demo crawl through it.

They deliberately crawl **different sites**:

| Site | Used by | Why |
| --- | --- | --- |
| `demo/fixture/` | The test suite | Frozen. Tests stay green no matter how much the docs change. |
| `site/` | The demo recording | Real documentation, so the recording shows real content. |

Keeping them apart is what stops a documentation edit from breaking a test — and stops a test fixture from making the demo look synthetic.

```
test/tokenizer.test.js   term extraction, CJK bigrams
test/html.test.js        extraction, entities, link handling
test/crawler.test.js     robots.txt, scope, URL → path, CJK paths, index aliases
test/search.test.js      chunking and BM25 ranking
test/llms.test.js        llms.txt shape, title suffix stripping
test/mcp.test.js         JSON-RPC handling, tool contracts, traversal refusal
test/build.test.js       output-directory safety, retry after failure
test/cli.test.js         argument parsing, exit codes, a real build
test/e2e.test.js         crawl → build → spawn the server → real handshake
```

`test/e2e.test.js` and `test/cli.test.js` spawn child processes on purpose. An in-process `execFileSync` blocks the event loop, so the fixture server can never answer and the crawl times out against itself — a genuinely confusing failure the first time you hit it.
