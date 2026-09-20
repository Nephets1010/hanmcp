# The 30-second demo

This is the single highest-leverage asset in the project. Someone sees the GIF before they see the README, the repository, or the code. If it does not land in the first three seconds, nothing else gets read.

Everything below is built so the recording can be reproduced exactly, on any machine, with one command.

## What the demo has to prove

In order of importance:

1. **It is one command.** No install step, no config file, no API key prompt.
2. **It works on Chinese.** A Chinese query returns real Chinese content. Every competing tool fails here, and this is the differentiator that reads clearly on screen.
3. **The output is an actual MCP server,** not a folder of markdown — an AI client connects and gets an answer.
4. **It is fast and local.** "done in 1.1s" and "no API key, no embeddings, no cloud" are both on screen.

What the demo deliberately does **not** try to show: configuration flags, the index format, error handling, or the repository layout. A 30-second asset that shows ten things leaves no memory of any of them.

## Which site the demo crawls

The demo crawls **hanmcp's own documentation site**, served from `site/` over localhost.

That choice is deliberate, and it is the difference between a demo and an advertisement. A GIF crawling `127.0.0.1` is less persuasive than one crawling a real domain, so the alternative is a live site — but crawling someone else's documentation to sell your own tool reads badly and invites the question of who agreed to it. hanmcp's own docs are honest, they are ours to show, and the demo doubles as proof that the tool is used on the thing it documents.

The content is the project's real documentation: installation, the CLI reference, how the pipeline works, CJK handling, and a Chinese page. Nothing in the recording is placeholder text.

To record against a deployed domain after the site is live:

```bash
DEMO_URL=https://docs.hanmcp.dev/docs/ npm run demo
```

When recording that way, keep the query in the Chinese-query shot Chinese — the differentiator has to land regardless of which site is on screen.

## Run it

```bash
git clone https://github.com/Nephets1010/hanmcp && cd hanmcp
npm run demo
```

That command is the entire demo. It serves the documentation site on localhost:8904, crawls it, builds the artifacts, then spawns the generated server and sends it a real JSON-RPC query over stdio.

The output is deliberately paced: `npm run demo` passes `--pace`, which inserts the holds the storyboard below asks for, and the whole run takes about 27 seconds. Every pause goes through one `hold(ms)` helper in `demo/run-demo.js` — there is a single switch to tune rather than a `sleep` buried in each section.

The unpaced form is the same output with no holds, in under two seconds. That is what CI runs, because the holds exist to make a recording readable and nobody is watching CI:

```bash
node demo/run-demo.js     # unpaced, ~2s — what CI runs
time npm run demo         # paced, ~27s — what gets recorded
```

Two sites live in this repository, and confusing them is easy:

| Directory | Contents | Who crawls it |
| --- | --- | --- |
| `site/` | hanmcp's real documentation | The demo recording |
| `demo/fixture/` | A frozen sample site (Orbital DB) | The test suite |

The fixture exists so the tests do not break every time someone edits the docs. Change `site/` freely; the tests will not notice.

## Storyboard

About 29 seconds on the GIF's clock — a little over a second of typing, then 27 seconds of paced output. Six shots. Timings are targets, not laws; the cut points matter more than the exact seconds, and the ranges below are what the paced run actually produces, not what it was designed to.

| Shot | GIF clock | What is on screen |
| --- | --- | --- |
| 1 | 0:00–0:02 | the command, being typed |
| 2 | 0:02–0:09 | the echoed command, then the page list |
| 3 | 0:09–0:13 | the stats block |
| 4 | 0:13–0:15 | the client registration line |
| 5 | 0:15–0:24 | the Chinese query, then the answer |
| 6 | 0:24–0:29 | the closer, held |

### Shot 1 — 0:00–0:02 · The command

- **On screen:** an empty terminal, generous font size, no prompt clutter.
- **Action:** type `npm run demo` and press Enter. Type it at a natural speed — a command that appears instantly reads as a cut.
- **Caption:** *one command, no install, no API key*
- **Why it is first:** the promise is "one command". Show the command before showing anything else.
- **The URL is stable.** The demo binds port 8904 by default, so every take shows `http://127.0.0.1:8904/docs/`. If something else on your machine holds that port, pass `DEMO_PORT=0` to get a random one — but then expect the URL to differ between takes.

### Shot 2 — 0:02–0:09 · The crawl

- **On screen:** the page list streaming in — `[ 1] hanmcp Documentation` … `[ 6] CJK support · hanmcp Docs`. It takes under a second to print, and then the screen holds, which is the point: a list that scrolls past is a list nobody read.
- **Hold on:** the `skip  robots.txt disallows /docs/private/benchmarks.html` line. It is the cheapest possible signal that the tool is well-behaved, and reviewers notice it.
- **Hold on:** `中文文档 · hanmcp` in the page list. A Chinese page title surviving intact is half the claim, and it sits second in the list where the eye lands early.
- **Caption:** *respects robots.txt · keeps Chinese page titles intact*
- **Why it works:** a static list of English page names is unremarkable. The two lines above are not.

### Shot 3 — 0:09–0:13 · The summary

- **On screen:** the stats block.
  ```
  done in 1.1s
  6 pages  ->  37 passages  ->  1363 terms
  index.json 66.5 KB   server.mjs 17.3 KB
  ```
- **Caption:** *6 pages → one MCP server in 1 second*
- **Why it works:** three numbers carry the whole value proposition — small, fast, self-contained. Do not cut away early; the hold is about three and a half seconds for exactly that reason.
- **Note:** every number here except `done in` is checked by `npm run verify:docs`, which fails the build when `site/` changes and the documents stop matching. Take the real values from a fresh `npm run demo` before recording. `done in` is wall-clock and will read differently on your machine — that is expected, and it is the one number nothing asserts.

### Shot 4 — 0:13–0:15 · The client registers

- **On screen:** `claude mcp add hanmcp-docs -- node server.mjs`.
- **Caption:** *it is a real MCP server — your client uses it like any other*
- **Why it matters:** markdown files are not a product. A registered server is.
- **Where the tool list went:** `search_docs, get_doc, list_docs` prints with the answer rather than here, because the demo only learns the tool list when it completes the MCP handshake — which happens when it asks the question. It is on screen in Shot 5.

### Shot 5 — 0:15–0:24 · The Chinese query

- **On screen:** the client-side query line, then the answer.
  ```
  an AI client asks, in Chinese:  索引内存占用怎么估算
  ```
- **Hold on:** the returned passage — the heading `索引内存占用怎么估算`, the score, the source URL, and the Chinese body text underneath. This is the longest hold in the demo, roughly six and a half seconds, and it is the reason the other holds exist.
- **The point to notice:** the returned passage is the **section** whose title matches the query, not the top of the page. That only happens because sections are indexed as separate passages; if a future change merges them, this shot quietly stops working and the demo becomes much weaker. Verify it by eye before every recording.
- **Caption:** *the question and the answer are both Chinese*
- **Why it is the centre of the demo:** this is the shot that no competitor GIF can reproduce. Everything before it is setup; everything after it is a conclusion.

### Shot 6 — 0:24–0:29 · The closer

- **On screen:** the final line, held:
  ```
  no API key. no embeddings. no cloud. everything above ran on this machine.
  ```
- **Caption:** none. Let the line stand alone for the full four seconds.
- **Why it works:** it reframes the preceding 25 seconds from "a demo" into "something that can run on your laptop right now, on your private docs". That is the sentence that makes someone click through.

## Recording a real terminal GIF

[VHS](https://github.com/charmbracelet/vhs) records a reproducible terminal GIF from a script. It is the right tool here: the recording becomes a checked-in artifact that can be regenerated when the output changes, instead of a video nobody can re-shoot.

`docs/demo.tape`:

The block below is the file, verbatim — `npm run verify:docs` fails if the two drift apart. It is the one place in this repository where a quoted copy of a file is checked against its original, because a tape that is only documented and not actually run is how a recording quietly stops matching its script.

```tape
# VHS tape for the 30-second demo GIF.
#
#   vhs docs/demo.tape
#
# Requires vhs (https://github.com/charmbracelet/vhs) and ffmpeg.
# Storyboard, shot timings and recording checklist: docs/DEMO.md
#
# Font note: this tape asks for a font family with real CJK coverage. A font
# without it (JetBrains Mono, Fira Code, Cascadia Code) will fall back to a
# different typeface for the Chinese text, or render tofu boxes. Install one of
# the alternatives below before recording.

Output docs/demo.gif

Set Shell bash
Set FontFamily "Sarasa Mono SC, Noto Sans Mono CJK SC, Source Han Mono, monospace"
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 24
Set MarginFill "#0d1117"
Set BorderRadius 8
Set Theme "GitHub Dark"
Set TypingSpeed 60ms
Set Framerate 30
Set PlaybackSpeed 1.0

Hide
Type "cd $(git rev-parse --show-toplevel)"
Enter
Sleep 500ms
Type "clear"
Enter
Sleep 300ms
Show

# Shot 1 — the command. `npm run demo` is the paced form, which is what makes
# shots 2-6 land; the bare `node demo/run-demo.js` prints the same output with
# no holds and records badly.
Type "npm run demo"
Sleep 400ms
Enter

# Shots 2-6 are paced by run-demo.js and take about 27s. Leave a couple of
# seconds of margin: if this is short the GIF loses the closing hold, and a
# static extra frame at the end costs almost nothing.
Sleep 29s
```

Two notes on the defaults above:

- **`Framerate 30` and 1200×700** are the ceiling for a GIF that stays under GitHub's 10 MB inline limit for a 30-second clip. The holds help here: identical frames compress to almost nothing, so a paced terminal recording is far smaller than its length suggests. Raising the framerate or the dimensions will push it over, and an oversized GIF renders as a click-to-play box — which is worse than a smaller one that autoplays.
- **`GitHub Dark`** renders correctly in both GitHub light and dark themes because the GIF carries its own background. Do not record on a transparent background: light-theme viewers get white-on-white.

Also commit a `demo.mp4` alongside the GIF. GitHub cannot inline a video, but release notes, the launch post, and social posts all want one, and re-encoding a GIF into video looks noticeably worse.

## Terminal preparation

Small things that visibly change how professional the result reads:

- **Clear the terminal first.** Run `clear` immediately before recording.
- **An empty prompt.** No hostname, no virtualenv, no git branch, no last-command history visible.
- **A monospace font with real CJK coverage.** This is the one that bites. Many popular terminal fonts (`JetBrains Mono`, `Fira Code`, `Cascadia Code`) have no CJK glyphs and fall back to a system font — the Chinese text renders in a visibly different typeface, or as boxes. Use a font with CJK coverage (`Sarasa Gothic`, `Noto Sans Mono CJK`, `Source Han Mono`) and check the fallback before recording.
- **A quiet machine.** No notifications, no other window stealing focus.
- **No personal information.** Check the current directory in the prompt and the paths in the output. The fixture paths are clean; a real-site recording may expose a username.

## Checklist before publishing

- [x] Total length is 30 seconds or under, and the whole thing loops without an obvious seam.
- [x] The Chinese text renders in a font with real CJK glyphs — no tofu boxes, no fallback typeface.
- [x] The GIF is under 10 MB so GitHub inlines it, and it autoplays in the README.
- [x] `docs/demo.gif` and `docs/demo.mp4` are committed, and the `<!-- ... -->` placeholder comment is removed from `README.md` **and** `README.zh-CN.md`.
- [x] The recording matches the current `npm run demo` output — re-record if the CLI output changed.
- [x] No file paths, hostnames, or usernames from a personal machine are visible.

The first three are asserted by `demo/record-gif.mjs` rather than left to the eye: the 30-second ceiling and the 10 MB ceiling both fail the recording, and so does an edit that pushes the Chinese answer off the top of the screen. The other three are judgement calls — the font one in particular, because a missing glyph is not an error in canvas, `measureText` still reports a plausible width, and the only way to catch it is to look at the pixels. Re-record (and re-tick) after any change to the CLI's output.
