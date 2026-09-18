# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

First release.

### Added

- **`hanmcp <url>`** — crawl a documentation site and build a self-contained MCP bundle.
- **`hanmcp serve [dir]`** — run a generated server on stdio without rebuilding.
- **A generated `server.mjs`** exposing `search_docs`, `get_doc` and `list_docs`. Standalone: no `npm install`, no lockfile, no runtime dependencies.
- **`llms.txt` and `llms-full.txt`** following the [llms.txt](https://llmstxt.org/) convention, with per-site title suffixes (`Getting started · Acme Docs`) stripped.
- **CJK-first tokenization** — overlapping bigrams for Chinese, Japanese and Korean, so queries in those languages actually retrieve content.
- **Readable non-ASCII filenames** — `%E6%8C%87%E5%8D%97` becomes `指南`, not `e6-8c-87-e5-8d-97`.
- **BM25 retrieval** with phrase and heading boosts, in a dependency-free inverted index.
- **Polite crawling** — `robots.txt` respected by default, 120 ms default delay, honest user agent.
- **Output-directory safety** — refuses a filesystem root or the current working directory, refuses to clear a directory it did not create without `--force`, and claims ownership on creation so a failed build stays retryable.
- **Path-traversal refusal** in the generated server's `get_doc` tool.
- Bilingual documentation: [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md).
- A fixture documentation site (`demo/fixture/`) that powers `npm run demo`, the end-to-end test suite and the portability check — so the tests never touch the public internet.

### Known limitations

Documented in the README under "What this does not do" rather than discovered by users:

- No JavaScript rendering. Pages requiring a browser are indexed as empty.
- No incremental re-crawl. Every build is a full rebuild.
- `robots.txt` supports prefix matching only — no wildcards, no `$` anchors.
- BM25 only. No vector or semantic search.

[Unreleased]: https://github.com/Nephets1010/hanmcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Nephets1010/hanmcp/releases/tag/v0.1.0
