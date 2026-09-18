# hanmcp documentation site

This is hanmcp's own documentation, and it is also the input to the 30-second demo recording. Both roles matter.

## Why it lives in the repository

Three reasons, and the third is the one people miss:

1. **It documents the tool.** Installation, the CLI reference, how the pipeline works, CJK handling, and a Chinese page.
2. **It is the demo target.** `npm run demo` crawls this site over localhost, so the recording shows real content instead of placeholder text. See [docs/DEMO.md](../docs/DEMO.md).
3. **It is a worked example.** The site ships with a `robots.txt` that disallows `/docs/private/`, and a page under that prefix that is linked from the index. The crawler has to find the link and refuse it. A rule that is never exercised is a rule that is assumed to work — so the site is built to exercise it on every demo run.

## Previewing locally

Any static file server works. The demo's own server is one option and needs no install:

```bash
node -e "
import('./demo/fixture-server.js').then(async (m) => {
  const s = await m.startSiteServer();
  console.log('http://127.0.0.1:' + s.port + '/docs/');
});
"
```

Or use whatever you already have:

```bash
python -m http.server 8000 --directory site
```

## Editing the docs

The pages are plain HTML with no build step, no template language, and no framework. Edit a file and reload.

Two things to keep in step when you change content:

- **The demo numbers.** `docs/DEMO.md` quotes the page, passage and term counts. They move whenever the docs change, so re-read them from a fresh `npm run demo` before recording rather than trusting the copy in the doc.
- **The demo query.** `demo/run-demo.js` asks `索引内存占用怎么估算`, which is the title of a real section in `docs/zh/index.html`. If you rename that section, change the query — otherwise the demo silently stops demonstrating precise retrieval and starts showing a page introduction instead, which is a much weaker claim.

## Structure

```
site/
  robots.txt                    disallows /docs/private/
  assets/style.css              plain CSS, light and dark
  docs/
    index.html                  entry point the crawler starts from
    guide/installation.html     requirements and setup
    guide/cli.html              every flag and the scope rule
    guide/how-it-works.html     crawl, index, emit
    guide/cjk.html              tokenization and filenames
    zh/index.html               Chinese docs
    private/benchmarks.html     excluded by robots.txt, on purpose
```

The crawler enters at `/docs/` and runs two levels deep, which reaches every page above. `private/` is discovered and refused, producing the `skip` line the demo holds on.
