# The 30-second demo

This is the single highest-leverage asset in the project. Someone sees the GIF before they see the README, the repository, or the code. If it does not land in the first three seconds, nothing else gets read.

Everything below is built so the recording can be reproduced exactly, on any machine, with one command.

## What the demo has to prove

In order of importance:

1. **It is one command.** No install step, no config file, no API key prompt.
2. **It works on Chinese.** A Chinese query returns real Chinese content. Every competing tool fails here, and this is the differentiator that reads clearly on screen.
3. **The output is an actual MCP server,** not a folder of markdown — an AI client connects and gets an answer.
4. **It is fast and local.** "done in 0.8s" and "no API key, no embeddings, no cloud" are both on screen.

What the demo deliberately does **not** try to show: configuration flags, the index format, error handling, or the repository layout. A 30-second asset that shows ten things leaves no memory of any of them.

## Which site the demo crawls

The demo crawls **hanmcp's own documentation site**, served from `site/` over localhost.

That choice is deliberate, and it is the difference between a demo and an advertisement. A GIF crawling `127.0.0.1` is less persuasive than one crawling a real domain, so the alternative is a live site — but crawling someone else's documentation to sell your own tool reads badly and invites the question of who agreed to it. hanmcp's own docs are honest, they are ours to show, and the demo doubles as proof that the tool is used on the thing it documents.

The content is the project's real documentation: installation, the CLI reference, how the pipeline works, CJK handling, and a Chinese page. Nothing in the recording is placeholder text.

To record against a deployed domain after the site is live:

```bash
DEMO_URL=https://docs.hanmcp.dev/docs/ npm run demo
```

When recording that way, keep the query in step 4 Chinese — the differentiator has to land regardless of which site is on screen.

## Run it

```bash
git clone https://github.com/Nephets1010/hanmcp && cd hanmcp
npm run demo
```

That command is the entire demo. It serves the documentation site on localhost:8904, crawls it, builds the artifacts, then spawns the generated server and sends it a real JSON-RPC query over stdio.

The output it prints is deliberately paced with short pauses — 400–900 ms between sections — so a screen recording has natural cut points. The pacing lives in `demo/run-demo.js` (`sleep(...)` calls) and is the only thing to touch when tuning the recording.

Two sites live in this repository, and confusing them is easy:

| Directory | Contents | Who crawls it |
| --- | --- | --- |
| `site/` | hanmcp's real documentation | The demo recording |
| `demo/fixture/` | A frozen sample site (Orbital DB) | The test suite |

The fixture exists so the tests do not break every time someone edits the docs. Change `site/` freely; the tests will not notice.

## Storyboard

Total 30 seconds. Six shots. Timings are targets, not laws; the cut points matter more than the exact seconds.

### Shot 1 — 0:00–0:04 · The command

- **On screen:** an empty terminal, generous font size, no prompt clutter.
- **Action:** type `npm run demo` and press Enter. Type it at a natural speed — a command that appears instantly reads as a cut.
- **Caption:** *one command, no install, no API key*
- **Why it is first:** the promise is "one command". Show the command before showing anything else.
- **The URL is stable.** The demo binds port 8904 by default, so every take shows `http://127.0.0.1:8904/docs/`. If something else on your machine holds that port, pass `DEMO_PORT=0` to get a random one — but then expect the URL to differ between takes.

### Shot 2 — 0:04–0:11 · The crawl

- **On screen:** the page list streaming in — `[ 1] hanmcp Documentation` … `[ 6] CJK support · hanmcp Docs`.
- **Hold on:** the `skip  robots.txt disallows /docs/private/benchmarks.html` line. It is the cheapest possible signal that the tool is well-behaved, and reviewers notice it.
- **Hold on:** `中文文档 · hanmcp` in the page list. A Chinese page title surviving intact is half the claim, and it sits second in the list where the eye lands early.
- **Caption:** *respects robots.txt · keeps Chinese page titles intact*
- **Why it works:** a static list of English page names is unremarkable. The two lines above are not.

### Shot 3 — 0:11–0:15 · The summary

- **On screen:** the stats block.
  ```
  done in 0.8s
  6 pages  ->  37 passages  ->  1346 terms
  index.json 65.7 KB   server.mjs 17.3 KB
  ```
- **Caption:** *6 pages → one MCP server in 1 second*
- **Why it works:** three numbers carry the whole value proposition — small, fast, self-contained. Do not cut away early; let the numbers sit for a full second.
- **Note:** these numbers move whenever the docs change. `npm run verify:readme` catches the drift and prints the real values; take them from a fresh `npm run demo` before recording.

### Shot 4 — 0:15–0:22 · The Chinese query

- **On screen:** the client-side query line, then the answer.
  ```
  an AI client asks, in Chinese:  索引内存占用怎么估算
  ```
- **Hold on:** the returned passage — the heading `索引内存占用怎么估算`, the score, the source URL, and the Chinese body text underneath.
- **The point to notice:** the returned passage is the **section** whose title matches the query, not the top of the page. That only happens because sections are indexed as separate passages; if a future change merges them, this shot quietly stops working and the demo becomes much weaker. Verify it by eye before every recording.
- **Caption:** *the question and the answer are both Chinese*
- **Why it is the centre of the demo:** this is the shot that no competitor GIF can reproduce. Everything before it is setup; everything after it is a conclusion.

### Shot 5 — 0:22–0:26 · The client

- **On screen:** `claude mcp add hanmcp-docs -- node server.mjs`, and the registered tool list `search_docs, get_doc, list_docs`.
- **Caption:** *it is a real MCP server — your client uses it like any other*
- **Why it matters:** markdown files are not a product. Three registered tools are.

### Shot 6 — 0:26–0:30 · The closer

- **On screen:** the final line, held:
  ```
  no API key. no embeddings. no cloud. everything above ran on this machine.
  ```
- **Caption:** none. Let the line stand alone for the full four seconds.
- **Why it works:** it reframes the preceding 26 seconds from "a demo" into "something that can run on your laptop right now, on your private docs". That is the sentence that makes someone click through.

## Recording a real terminal GIF

[VHS](https://github.com/charmbracelet/vhs) records a reproducible terminal GIF from a script. It is the right tool here: the recording becomes a checked-in artifact that can be regenerated when the output changes, instead of a video nobody can re-shoot.

`docs/demo.tape`:

```tape
# vhs docs/demo.tape
# Requires: vhs (https://github.com/charmbracelet/vhs) and ffmpeg.

Output docs/demo.gif
Set Shell bash
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 24
Set MarginFill "#0d1117"
Set BorderRadius 8
Set Theme "GitHub Dark"
Set TypingSpeed 60ms
Set Framerate 30

Hide
Type "cd $(git rev-parse --show-toplevel)"
Enter
Sleep 500ms
Show

# Shot 1 — the command. `npm run demo` is the reproducible entry point; swap in
# the literal npx command if recording against a real site.
Type "npm run demo"
Sleep 400ms
Enter

# Shots 2-6 are driven by the script's own pacing. Let it run to completion.
Sleep 34s
```

Two notes on the defaults above:

- **`Framerate 30` and 1200×700** are the ceiling for a GIF that stays under GitHub's 10 MB inline limit for a 30-second clip. Raising either will push it over, and an oversized GIF renders as a click-to-play box — which is worse than a smaller one that autoplays.
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

- [ ] Total length is 30 seconds or under, and the whole thing loops without an obvious seam.
- [ ] The Chinese text renders in a font with real CJK glyphs — no tofu boxes, no fallback typeface.
- [ ] The GIF is under 10 MB so GitHub inlines it, and it autoplays in the README.
- [ ] `docs/demo.gif` and `docs/demo.mp4` are committed, and the `<!-- ... -->` placeholder comment is removed from `README.md` **and** `README.zh-CN.md`.
- [ ] The recording matches the current `npm run demo` output — re-record if the CLI output changed.
- [ ] No file paths, hostnames, or usernames from a personal machine are visible.
