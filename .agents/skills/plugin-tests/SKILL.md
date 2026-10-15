---
name: plugin-tests
description: Use when writing or changing tests for a plugin under plugins/*/ (anything importing 'claude-code/testing').
paths:
    - "plugins/*/hooks/**/*.test.{ts,tsx}"
    - "plugins/*/test-utils/**/*.ts"
---

# Plugin tests

## Running and placing tests

Run with `pnpm test` (`claude plugin test`); it runs every `*.test.ts(x)` under each plugin. Unit tests sit next to the file they cover, inside `hooks/`. `tsc` type-checks them through the generated tsconfig's `hooks` include.

In `status-bar/` the tests are split by what they check:

- `register.test.ts`: the wiring (which events refresh, the timer).
- `data.test.ts`: what is read from the engine and git.
- `render.test.ts`: what is drawn.

A test that checks only how the bar looks belongs in `render.test.ts`, even when it goes through `TestEngine`.

## Engine and mocks

Pure formatters can be tested as plain functions. Anything that calls `$` is tested through the engine: `test(name, async ($, on) => …)` loads the plugin, and the hooks `on` registers sit _beneath_ it, so they act as the mocks. No mocking library is needed. The kit has no DOM and no `console`.

Answer every engine call the plugin makes, or the test fails with "no implementation for …". The shapes:

- Calls on `$` (`session.cwd`, `session.usage`, `process.run`, …) are answered with `{ value }` or `{ deny }`, not a bare value.
- Lifecycle events (`session.start`, `session.measure`) are answered with their result object.
- `ui.render` is answered with the engine's own element (plain `{ type, props, children }`).

## Time and drawing

`TestEngine` pins time with `mock.clock` (at `NOW`). `engine.advance(ms)` fires `$.clock.every` timers.

Plugin state is not readable from the test file, so assert on what `engine.mountStatusBar()` draws. It returns a `StatusBarView` over `$.ui.mount(...)`. Its `claudeRow()` and `workspaceRow()` return a `StatusBarRowView` over `ui.drawn()`, which holds each piece of text with its colour:

- `text()` reads the row as it appears on screen.
- `colorOf(text)` gives the colour of the one segment showing that text, and fails when the text appears more or less than once. Check a colour with it, so the check also proves the text is drawn once.
- `isEmpty()` says nothing is drawn.

The drawing is the element tree, not a painted screen. Layout (wrapping, truncation, widths) can only be checked through the props that ask for it (`view.findAll({ type: "Box" })` and `flexWrap`, `wrap`, `flexShrink`). Confirm the real layout in a terminal.

## Shared setup

`plugins/<name>/test-utils/` must stay inside the plugin folder: `claude plugin test` refuses imports from outside it (verified). The generated tsconfig includes only `hooks`, `types` and `tests`, so `tsc` reaches `test-utils/` through the test files that import it.

The files, split by class (read them for what is there):

- `test-engine/index.ts`, `TestEngine`: the harness. It pins the clock, has a method for each action, and holds one aspect object per part of the engine.
- `test-engine/aspects/base-aspect.ts`, `BaseAspect`: what an aspect implements. It registers its own hooks.
- `test-engine/aspects/claude.ts` `Claude`, `workspace.ts` `Workspace`, `tool.ts` `Tool` and `ui.ts` `Ui`: the aspects.
- `test-engine/aspects/answer-engine/index.ts`, `AnswerEngine`: one engine call, with the answers lined up for it and the requests made to it.
- `test-engine/aspects/answer-engine/answer.ts`: the answers themselves, `Response`, `DelayedResponse` (a response held back) and `Deny`.
- `views/base-view.ts`, `BaseView`: reads text and segments out of a drawing.
- `views/status-bar-view.ts`, `StatusBarView`: the mounted bar's two rows, with `StatusBarRowView` for one row.
- `time.ts`: the pinned clock values.

## Steering the engine

`new TestEngine($, on)` exposes one object per aspect: `engine.claude`, `engine.workspace`, `engine.tool` and `engine.ui`. Each exposes its `AnswerEngine`s as properties: `claude.model`, `claude.usage`, `workspace.cwd`, `workspace.git`, `tool.call` and `ui.log`.

`onNextCall` lines up the answer for the call after those already lined up, one answer each, in order:

- `onNextCall(new Response(value))`: an answer.
- `onNextCall(new Deny(reason))`: a refusal.
- `onNextCall(new DelayedResponse(value))`: an answer kept back until its `release()`. `await it.reached` says the call has been made.

Once none are left, a built-in default answers (Opus 4.5 at 42%, `/work/repo`, branch `main`). So a value that must hold across several refreshes is lined up once for each refresh, and an answer that is never taken stays lined up.

`calls` is the array of requests made so far, in call order. It is live, so read it again after later events. `workspace.git.calls` holds `{ argv, cwd }` for every git command, whatever its subcommand, and `ui.log.calls` holds `{ text, to }`. The others record an empty request, so only `.length` means anything.

Git has one answer engine for all subcommands, so answers are lined up in the order the commands run: status, then describe, then rev-parse. A command with no answer left gets the default for its subcommand: status gives branch `main`, and describe and rev-parse give "not a repository". A git response carries `{ stdout, exitCode?, truncated? }`. Give a failing command output too, because an empty answer cannot tell whether the exit code is checked.

A hook that throws is skipped and reported by the engine, not failed. So a refused engine call such as `session.usage` must be caught in the plugin, and the test asserts on what the plugin logged. To make a `$.state` write fail, register `on("state.set", () => ({ deny: "…" }))` in the test; a hook that throws there is skipped and the real write goes through.

Two smaller gotchas: `StatusBarView` reads the rows by position, so the plugin must draw every row's Box even when it is empty, or the rest shift. The kit's `expect` has no `toBeCloseTo`, so compare an exact value or a rounded one.

## Work a hook starts without awaiting

`$.session.start(...)` and the like do not wait for the HUD's refreshes, so they can resolve before the plugin's git commands have run. `await engine.settle()` after the event, before asserting. It lets the work under way finish without moving time, whatever number of steps that takes, so no wait is guessed.

A test must not end with a refresh still running: a write to `$.state` after the engine is gone fails the whole file with `a rejection nothing handled … no hooks module of that name is loaded`. So settle after the last event, and after releasing a held command.

To test that a hook does not wait on slow work:

1. Hold the command's answer: `const held = new DelayedResponse({ stdout }); engine.workspace.git.onNextCall(held)`.
2. Await the event, then `await held.reached`.
3. The event resolving while the command is still held is the proof. A hook that awaits it makes the test time out.

## Writing tests

When a test changes something, assert the starting value first, then the new one. It reads better, and it stops two wrongs from passing as a right (for example a refresh that never ran, or a value that never changed).

Name tests for what the reader sees. Avoid ambiguous words such as "usage" or "used up": say "percentage used", "100% used" or "usage figures cannot be read". Name a `describe` after the function it covers. Describes nest, and each name leads the title of the tests inside it (`refreshClaude > rate limits > …`).

## Checking a test

After adding a test, break the code it covers and check that it fails.

For a wider check, apply one small break at a time: flip a comparison, change a threshold or constant, drop a guard or a refresh hook. Run `pnpm test`, restore the file, and treat a survivor as a test gap, or as redundant code when no visible behaviour changes.

Sweeps here found a boundary tested on one side only, a window length that only a crossing value tells apart, and a guard whose absence shows only when another section is also drawn.
