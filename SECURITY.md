# Security Policy

## Reporting a vulnerability

Report privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository. Do not open a public issue for a security problem.

Please include what you can:

- What the issue is and where it lives (file and function if you have them).
- How to reproduce it — a minimal script or the exact command is worth more than a description.
- What an attacker gains. "Crashes the process" and "reads files outside the output directory" are very different reports, and the second is the one we care about most.
- The version (`hanmcp --version`), Node version, and OS.

**What to expect:** an acknowledgement within 72 hours, and an assessment with a fix timeline within 7 days. If the report is valid, you will be credited in the release notes unless you prefer otherwise.

## Supported versions

This project is pre-1.0. Fixes land on the latest published minor version only. There are no backports.

| Version | Supported |
| --- | --- |
| latest 0.x | Yes |
| older 0.x | No |

## Threat model

`hanmcp` runs locally, on your machine, with your permissions. It is not a sandbox and does not try to be one. The realistic risks are therefore these:

**1. Path traversal out of the output directory.**
The generated `server.mjs` reads markdown files by path at the request of an AI client. An agent that passes `../../.ssh/id_rsa` must not be able to read it. `get_doc` resolves every path and rejects anything that escapes the docs directory. Covered by tests in `test/mcp.test.js` and `test/e2e.test.js`.

**2. Destructive writes to the wrong directory.**
`--out` accepts a user-supplied path and the build clears that directory. The rules: a filesystem root and the current working directory are always refused; an existing directory that `hanmcp` did not create is refused unless `--force` is passed. The marker file `.hanmcp` records ownership. Covered by tests in `test/build.test.js`.

**3. Crawling a site that did not consent.**
`robots.txt` is respected by default, requests are rate-limited, and the user agent identifies the tool honestly. `--no-robots` exists for sites you own or have permission to index — it is not a default, and it is never set by CI.

**4. Prompt injection through indexed content.**
This one is **out of scope and unfixable by design**. `hanmcp` fetches text from the network and hands it to an AI agent as context. If the source site contains instructions aimed at that agent, those instructions arrive intact. Treat the output as untrusted input, exactly as you would treat a webpage you paste into a chat window. `llms-full.txt` makes this concentration worse — it inlines everything into one document.

## What is explicitly not a vulnerability

- A SQL injection, XSS or RCE report on the generated server: it has no database, renders no HTML, and executes no user input.
- Resource exhaustion from crawling a very large site: `--max-pages` and `--max-depth` are the intended controls, and both are bounded by default.
- The tool reading a URL you asked it to read.
