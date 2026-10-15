# Development

For developers and coding agents. Agent conventions and gotchas are in [AGENTS.md](AGENTS.md). Plugin-specific notes are in each plugin's `DEVELOPMENT.md` (for example [hud](plugins/hud/DEVELOPMENT.md)).

## Prerequisites

- [pnpm](https://pnpm.io/) 12 (pins and downloads the Node version it needs)
- The `claude` CLI (2.1.300 or later), logged in
- A POSIX shell (Linux or macOS)

## Setup

```sh
pnpm i
```

- Installs the dev tooling and the [husky](https://typicode.github.io/husky/) pre-commit hook.
- Generates the `'claude-code'` types into each plugin's `.claude-plugin/types/` (gitignored). This runs `claude` headlessly once per plugin, with one tiny model call each.

## Run a plugin

```sh
claude --plugin-dir plugins/<plugin-name>
```

The plugin hot-reloads when you save a file.

## Scripts

| Script              | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `pnpm types:gen`    | Regenerates `.claude-plugin/types/` (run it after upgrading Claude Code) |
| `pnpm types:check`  | Type-checks each plugin with `tsc`                                       |
| `pnpm lint`         | Lints the repo with ESLint                                               |
| `pnpm validate`     | Validates the marketplace and each plugin with `claude plugin validate`  |
| `pnpm test`         | Runs each plugin's `*.test.ts(x)` files with `claude plugin test`        |
| `pnpm format`       | Formats the repo with Prettier                                           |
| `pnpm format:check` | Checks formatting                                                        |

- `types:gen`, `types:check`, `validate` (which also checks the marketplace) and `test` run against every plugin in the pnpm workspace (`plugins/*`).
- `lint`, `format` and `format:check` run once over the whole repo.
- To target one plugin: `pnpm --filter <plugin-name> exec <command>`, for example `pnpm --filter hud exec tsc -p .`.
- The pre-commit hook runs `format:check`, `lint`, `types:check`, `validate` and `test`.

## Layout

- `.claude-plugin/marketplace.json`: lists the plugins
- `pnpm-workspace.yaml`: makes each `plugins/*` folder a workspace package and pins shared dependency versions in its `catalog`
- `plugins/<name>/`: one self-contained plugin
    - `package.json`: the workspace package (`private`, with `typescript: "catalog:"`)
    - `.claude-plugin/plugin.json`: the plugin manifest
    - `hooks/hooks.json`: lists the hooks modules
    - `hooks/**/*.{ts,tsx}`: the hooks, with each unit test (`*.test.ts`) next to the file it covers
    - `test-utils/*.ts`: shared test helpers; the tests sit next to the hooks
    - `types/index.d.ts`: declares the `$.state` values the plugin keeps, named by `types` in `plugin.json` (only when it uses `$.state`)
    - `tsconfig.json`: extends the generated `.claude-plugin/types/tsconfig.json`

## Adding a plugin

1. Create `plugins/<name>/` with the layout above. Copy `plugins/hud/package.json` and change the name.
2. Add it to `.claude-plugin/marketplace.json`.
3. Run `pnpm i` to generate its types.

The scripts and CI pick it up from the workspace.
