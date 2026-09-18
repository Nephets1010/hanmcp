# Contributing to hanmcp

Thanks for wanting to help. This file is written so you can get a first pull request merged without having to guess at conventions.

## Setup

```bash
git clone https://github.com/Nephets1010/hanmcp
cd hanmcp
npm run check
```

There is nothing to install. `hanmcp` has zero runtime dependencies and zero dev dependencies — the test runner is built into Node. There is no build step and no transpiler; the source you edit is the source that runs.

If `npm run check` passes on a clean clone, your environment is correct.

## The two rules that matter

**1. No dependencies. Ever.**
Not runtime, not dev. This is the product's central promise — that the generated server runs on a machine with nothing installed but Node. CI fails the build if `dependencies` or `devDependencies` in `package.json` stops being empty. If you think you need a package, open an issue first and make the case; the answer is usually "write the twenty lines."

**2. Every change comes with a test that fails without it.**
Bug fixes get a test that reproduces the bug. New features get tests for the happy path and at least one failure path. A pull request that changes behaviour and adds no test will be asked for one before review, not after.

Run the suite:

```bash
npm test           # ~104 tests, no network required
npm run demo       # crawl hanmcp's own docs end to end
npm run check      # syntax gate + tests; this is what CI runs
```

The suite never touches the public internet. It serves a frozen fixture site on `localhost` (`demo/fixture/`) and crawls that, so tests are fast and deterministic. The demo crawls the real docs in `site/` instead — keep the two apart and a documentation edit will never break a test.

## Code conventions

There is no linter, on purpose — the conventions below are few enough to hold in your head, and a linter would mean a dependency.

- **ESM only.** `.js` files with `import`/`export`. `"type": "module"` is set.
- **JSDoc on every exported function.** Types go in the JSDoc: `@param {string} url`, `@returns {Promise<object>}`. The project is plain JavaScript with no type checker, so JSDoc is the only type documentation there is.
- **No semicolon-free style.** Semicolons are required.
- **2-space indentation, single quotes, trailing commas, 120-column soft limit.** `.editorconfig` and `.prettierrc` are checked in; if your editor respects them, you will match the existing files without thinking about it.
- **Comments explain why, not what.** `// increment the counter` is noise. `// robots.txt may not exist; a missing file means everything is allowed` is worth writing.
- **Name things for the reader.** `prepareOutputDir`, not `prepDir`.

`src/util.js`, `src/tokenizer.js` and `src/search.js` are inlined verbatim into the generated `server.mjs`. They **must not import anything** — no `node:` modules, no relative imports. If you add an import there, the generated server breaks at runtime and no unit test will catch it. `npm run check` does catch it: `scripts/syntax-check.js` syntax-checks the bundled output.

## Adding a CLI flag

1. Add it to the `HELP` string in `src/cli.js` — `test/cli.test.js` asserts that every flag appears in the help text.
2. Add it to `VALUE_FLAGS` if it takes a value.
3. Thread it through `buildProject()` options rather than reading `process.argv` deeper in the stack.
4. Cover both the parsed value and the end-to-end effect.

## Testing gotchas

- **Never use `execFileSync` to run the CLI against the fixture server.** It blocks the event loop, so the in-process HTTP server can never answer and the crawl times out. Use `spawn` and await the result — `test/cli.test.js` shows the helper.
- **Fixture pages are real files.** A fixture for CJK path handling needs an actual non-ASCII filename on disk, because the URL has to resolve. `demo/fixture/docs/zh/内存调优.html` exists for exactly this reason.
- **Windows is a supported platform** and CI runs there. Use `path.join`, never hardcoded forward slashes, and be careful with non-ASCII filenames.

## Pull requests

Small and focused beats large and sweeping. One concern per pull request.

A good description answers:

- **What breaks today?** If this is a bug fix, the reproduction is the most important part of the description.
- **What did you change, and why that way?** If you considered an alternative and rejected it, say so briefly — it saves a review round trip.
- **How did you verify it?** For anything visual or CLI-facing, paste the real output. Not "tests pass" — the actual command and its actual output.

Before opening the pull request:

```bash
npm run check
```

CI runs on Linux, macOS and Windows against Node 20 and 22. Windows is not an afterthought; a change that only passes on Linux will be sent back.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. The scope is optional but useful: `fix(crawler): honour robots.txt for redirect targets`.

One logical change per commit. Do not squash unrelated fixes together to reduce the commit count.

## Review

Expect a first response within a few days. If a pull request sits longer than a week without a reply, comment on it — that is not rudeness, it is the trigger that brings it back to the top of the queue.

Reviews here are about correctness and scope. Style disagreements are settled by what the surrounding code already does.

## What gets merged quickly

- Bug fixes with a reproduction.
- CJK handling improvements, with a test using real Chinese, Japanese or Korean text. Do not use transliterated filler.
- Documentation corrections, especially where the README claims something the code no longer does.
- Anything that makes an error message more actionable.

## What will not be merged

- New dependencies.
- JavaScript rendering / headless browsers. It is a deliberate non-goal; see the README.
- A hosted or cloud component.
- Large refactors unaccompanied by a behavioural change. These are hard to review and easy to regress; open an issue first.

## Reporting bugs

Use the bug report template. The single most useful thing you can include is the command you ran and the full output — including the `skip` lines, which usually say exactly why a page was dropped.

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
