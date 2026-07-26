# Plugin tests

## Where a fixture lives

Most inputs and expected outputs are template literals inside the test that
uses them. That is deliberate, and it was measured rather than assumed.

Across the 30 suites in `src/` there are 983 multiline template literals:

```
median   9 lines
p75     14
p90     18
p95     22

<= 15 lines:  809 of 983  (82%)
```

The unit a reader reasons about is the triple of `it()` description, input and
expected output. Splitting the median case into files puts the intent in one
file and the data in two others, and trades scrolling past nine lines for
opening two more files. At this count it would also add roughly 1900 files
averaging a dozen lines each. So the default is inline, and it stays inline.

The exception is a case long enough that the surrounding test disappears
underneath it. Those live in `fixtures/cases/<plugin>/`, as
`<case>.input.<ext>` and `<case>.expected.<ext>`, and are read with
`caseReader` from `../test-utils`. Fourteen cases crossed that line, all of
them over 40 lines. Nothing between 15 and 40 lines was moved: at that size
neither form is clearly better, and moving them would spend a lot of churn to
find out.

`caseReader` returns the file's bytes with nothing added or removed, so a case
file carries no trailing newline it was not written with. An editor that adds
one on save fails the test that reads it.

`fixtures/drivers/` holds programs a suite writes into a scratch directory and
runs in a child process. Those are code, not data, and they are kept in files
so an editor treats them as the language they are written in.

Where the checked-in fixture trees under `fixtures/` should live is a separate
question, tracked in #294. This directory follows the convention that already
existed rather than settling it.

## Shared helpers

`test-utils.ts` holds what more than one suite needs:

- `mockPluginParams` builds params with no program behind them, for a plugin
  that only reads the source file and the diagnostics it is handed.
- `realPluginParams` builds a program rooted at `/`, in memory only.
- `fixturePluginParams` builds one rooted in a real directory, for a plugin
  whose validation programs resolve imports from disk.
- `createTypeChecker` compiles a plugin's output, so a wrong type fails in the
  suite that produced it rather than in a later migration.
- `pluginRunner` binds a plugin to the params a suite's tests share, so a test
  reads as the text in and the text out.

A helper that a second suite needs belongs here. Reaching for a private copy
is how four suites ended up with four `LanguageServiceHost` implementations of
the same thing.
