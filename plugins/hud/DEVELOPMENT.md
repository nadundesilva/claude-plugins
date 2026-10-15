# hud development

Setup, scripts and layout are in the [main DEVELOPMENT.md](../../DEVELOPMENT.md). Run only this plugin with `claude --plugin-dir plugins/hud`.

## Files

- `types/index.d.ts`: declares the figures kept in `$.state`, which `plugin.json` names under `types`
- `hooks/status-bar/data.ts`: reads the engine and git, writes the latest figures to `$.state`
- `hooks/status-bar/render.tsx`: formatting, colours and the drawn rows
- `hooks/status-bar/register.ts`: hooks the refresh events and the prompt hint
- `hooks/status-bar/*.test.ts`: the tests, one file per file above (`register.test.ts` covers the wiring)
- `test-utils/**/*.ts`: the shared test setup (`TestEngine` the harness, `BaseView`, `StatusBarView` and `StatusBarRowView`, time values)

## Changing the colour thresholds

Edit `USAGE_THRESHOLDS` and `WAIT_THRESHOLDS` in `hooks/status-bar/render.tsx`, and the matching tests in `render.test.ts`. Keep the tables in the [README](README.md#colours) in sync.
