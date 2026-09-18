<!--
Thanks for the pull request. Keep it focused: one concern per PR.

The three questions below are the whole review. Answer them in your own words —
a filled-in description gets reviewed in hours, an empty one gets asked for
details and reviewed in days.
-->

## What breaks today?

<!--
For a bug fix: the reproduction is the most important part of this description.
Show the failure before your change. "It didn't work" is not a reproduction.

For a feature: what can you not do today, and what do you have to do instead?
-->

## What did you change, and why that way?

<!--
If you considered an alternative and rejected it, say so in a sentence. It
saves a review round trip.

If this touches src/util.js, src/tokenizer.js or src/search.js: those are
inlined into the generated server.mjs and must not import anything. Confirm you
added no imports.
-->

## How did you verify it?

<!--
Paste the real command and the real output. Not "tests pass" — the actual
output. CI already runs the tests; this section exists to show the change
working.
-->

```
```

## Checklist

- [ ] `npm run check` passes locally (syntax gate, tests, documentation and package checks)
- [ ] New behaviour is covered by a test that fails without this change
- [ ] `package.json` still has empty `dependencies` and `devDependencies`
- [ ] JSDoc added or updated on every exported function I touched
- [ ] If this changes CLI behaviour, the `HELP` text in `src/cli.js` is updated
- [ ] If this changes behaviour the README describes, the README is updated — both `README.md` and `README.zh-CN.md`

## Related issues

<!-- Closes #123 -->
