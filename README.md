# hanmcp

[![ci](https://github.com/Nephets1010/hanmcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nephets1010/hanmcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen.svg)](package.json)

> Turn any documentation site into a working MCP server, in one command. Zero dependencies, no API keys, no embeddings, no cloud.

Most documentation is invisible to AI agents. `hanmcp` crawls a docs site, converts it to clean markdown, builds a dependency-free search index, and emits a **standalone MCP server** plus `llms.txt` — so Claude, Cursor, or any MCP client can read and search those docs locally.

It is built **Chinese-first**. Every English-oriented alternative mangles CJK: queries return nothing, and URLs like `/docs/指南/快速上手.html` become filenames like `e5-bf-ab-e9-80-9f.md`. `hanmcp` tokenizes CJK as overlapping bigrams and keeps Chinese path segments readable.

```bash
$ npx hanmcp http://127.0.0.1:8904/docs/

hanmcp 0.1.0  documentation -> MCP

  source   http://127.0.0.1:8904/docs/
  output   mcp-docs
  limits   depth 2, 50 pages, 120ms delay, robots.txt respected

  [ 1]  hanmcp Documentation
  [ 2]  中文文档 · hanmcp
  [ 3]  Installation · hanmcp Docs
  [ 4]  Command line reference · hanmcp Docs
  [ 5]  How it works · hanmcp Docs
  [ 6]  CJK support · hanmcp Docs
  skip  robots.txt disallows /docs/private/benchmarks.html

  done in 1.0s
  pages   6
  chunks  37
  terms   1,363
  index   66.5 KB
  server  17.3 KB

  files    docs/, llms.txt, llms-full.txt, index.json, server.mjs
```

Then an AI client asks something, in Chinese:

```
  an AI client asks, in Chinese:  索引内存占用怎么估算

  1. 中文文档 · hanmcp — 索引内存占用怎么估算
     source: http://127.0.0.1:8904/docs/zh
     path: zh.md
     score: 39.4518

  ## 索引内存占用怎么估算

  这是中文用户最常问的问题，因为中文分词会显著放大索引体积。hanmcp 把中文按
  相邻二字切分成重叠的二元组……
```

Both blocks are real output, not mock-ups. The first is what `npx hanmcp` prints; the second is a real MCP client session against the server it generated. The site being crawled is **hanmcp's own documentation site** — the one you are reading the source of — so the tool is demonstrated on the thing it documents. Run it yourself:

```bash
git clone https://github.com/Nephets1010/hanmcp && cd hanmcp
npm run demo
```

Note what the Chinese query returned: the **section** whose title matches, not the top of the page. Sections are indexed as separate passages, which is what makes a query on a section title land on that section.

<!-- Recorded GIF goes here before launch: docs/demo.gif (see docs/DEMO.md for the storyboard). -->

## Quick start

```bash
# 1. Build from any documentation site
npx hanmcp https://docs.example.com/

# 2. Point your MCP client at the generated server
claude mcp add example-docs -- node ./mcp-docs/server.mjs
```

Three files are all you need to move to another machine: `server.mjs`, `index.json`, and `docs/` ship as a self-contained bundle.

## What you get

| Artifact | What it is | Who reads it |
| --- | --- | --- |
| `server.mjs` | A complete, standalone MCP server. No `npm install`, no lockfile. | Any MCP client |
| `index.json` | Dependency-free inverted index with BM25 scoring and a phrase bonus. | The generated server |
| `llms.txt` | The [llms.txt](https://llmstxt.org/) convention index for the site. | Crawlers, agents, cheap ingestion |
| `llms-full.txt` | Every page inlined into one plain-text file. | Long-context ingestion |
| `docs/*.md` | Clean markdown, one file per page, paths mirroring the URL structure. | You, your repo, your grep |
| `manifest.json` | Build metadata and stats. | CI, debugging |

The generated server exposes three tools:

- `search_docs` — BM25 search, returns ranked passages with source URLs.
- `get_doc` — read one page by path. Refuses to escape the docs directory.
- `list_docs` — enumerate every indexed page.

## Three things people build with it

**Give an agent your internal docs.** Your wiki is on a VPN and the vendor's crawler cannot reach it. Point `hanmcp` at the internal URL, commit the output next to your code, and every teammate gets the same answers. No data leaves the machine.

**Make a dependency's docs searchable offline.** Vendored libraries often ship docs as HTML in the package. Convert once, commit the bundle, and your agent stops hallucinating API signatures on a plane.

**Ship `llms.txt` for your own site.** Run the build in CI on every docs deploy so `llms.txt` and `llms-full.txt` never drift from the content.

## Why not just fetch the page?

- **No API key, no embeddings, no model download.** Search is a local BM25 index. A docs site with a few hundred pages indexes in seconds and stays under a few megabytes.
- **Reproducible and diffable.** The output is markdown in your repo. You can review a docs change in a pull request.
- **Polite by default.** `robots.txt` is respected, requests are rate-limited, and it identifies itself honestly.
- **Built for CJK.** Bigram tokenization for Chinese, Japanese, and Korean text, plus readable filenames for non-ASCII paths.

## Configuration

```
hanmcp <url> [options]        crawl a docs site and build the server
hanmcp serve [dir]            run the generated server (stdio)
hanmcp help | version
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | `mcp-docs` | Output directory |
| `--max-pages <n>` | `50` | Page ceiling |
| `--max-depth <n>` | `2` | Link depth from the entry URL |
| `--name <name>` | site title | Server name |
| `--delay <ms>` | `120` | Pause between requests |
| `--timeout <ms>` | `15000` | Give up on a single request after this long |
| `--no-robots` | off | Skip the `robots.txt` check |
| `--force` | off | Overwrite `--out` even if `hanmcp` did not create it |
| `--quiet` | off | Only print the final summary |

**Scope rule:** with a trailing slash (`/docs/`) the whole subtree is crawled. Without one (`/docs/v2/start.html`) only the containing directory is — so pointing at a single page does not drag in the site.

**Safety rule:** `hanmcp` refuses to use a filesystem root or your current working directory as `--out`, and refuses to delete a directory it did not create unless you pass `--force`.

## What this does not do

Written down explicitly, because a roadmap that only lists features is a roadmap that never ends.

- **No JavaScript rendering.** Pages that require a browser to produce content are indexed as empty. This is deliberate: it keeps the tool dependency-free and fast.
- **No incremental re-crawl.** Builds are full rebuilds. Diff the output if you care.
- **No wildcard or `$`-anchored `robots.txt` rules.** Prefix matching only. Genuinely ambiguous cases are treated as allowed, matching common crawler behaviour.
- **No semantic or vector search.** BM25 only. It is fast, predictable, dependency-free, and good enough for documentation — and it works offline.
- **No hosted service.** There will not be one.

## Requirements

Node.js 20 or newer. Nothing else — `hanmcp` has zero runtime dependencies, and a CI check fails the build if that ever changes.

## Development

```bash
npm run check            # syntax gate + tests + documentation + published-package checks
npm test                 # the test suite only
npm run demo             # crawl hanmcp's own docs end to end, paced for recording
node demo/run-demo.js    # the same run without the holds, about 2s instead of 27
```

The test suite needs no network access: it serves a fixture documentation site on localhost and crawls that. The demo crawls the real docs in `site/` — the two are kept separate so editing the documentation never breaks a test.

`npm run check` also packs the tarball `npm publish` would send, installs it into a scratch directory and drives it end to end, so a change that breaks the published package fails the build rather than the reader. It runs as `prepublishOnly` too.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## Documentation

- [docs/DEMO.md](docs/DEMO.md) — how the 30-second demo is produced, shot by shot
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module map and the decisions behind it
- [CHANGELOG.md](CHANGELOG.md) — release history

## 中文

[README.zh-CN.md](README.zh-CN.md) — 中文说明。这个项目从一开始就按中文优先设计。

## License

Apache-2.0. See [LICENSE](LICENSE).

---

If this saves you a round of "the agent made up an API that doesn't exist," a star helps other people find it.
