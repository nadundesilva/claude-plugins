# Claude Code Plugins

🚧 **Work in progress:** plugins and their interfaces may change without notice.

A [Claude Code](https://claude.com/claude-code) marketplace of mods by Nadun De Silva.

## Plugins

| Plugin             | What it does                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| [hud](plugins/hud) | Draws a HUD above the prompt: model, context usage, rate limits, working directory and git ref |

## Install

First add the marketplace, then install the plugins you want from it. At the prompt of a terminal session:

```
/plugin marketplace add nadundesilva/claude-plugins
/plugin install <plugin-name>@nadundesilva
```

Or from a shell:

```sh
claude plugin marketplace add nadundesilva/claude-plugins
claude plugin install <plugin-name>@nadundesilva
```

To pick up new plugins and updates later, run `/plugin marketplace update nadundesilva` (or `claude plugin marketplace update nadundesilva`).

`/plugin install <plugin-name> --marketplace nadundesilva/claude-plugins` does both steps in one go, asking you to confirm adding the marketplace.

## Development

### Prerequisites

- [pnpm](https://pnpm.io/) 12 (pins and downloads the Node version it needs)
- The `claude` CLI (2.1.300 or later), logged in
- A POSIX shell (Linux or macOS)

### Setup

```sh
pnpm i
```

This installs the dev tooling and generates the `'claude-code'` types into each plugin's `.claude-plugin/types/` (gitignored). The generation runs `claude` headlessly once per plugin and makes one tiny model call each.

### Run a plugin

```sh
claude --plugin-dir plugins/<plugin-name>
```

The plugin hot-reloads when you save a file.

### Scripts

Each script runs against every folder in `plugins/`.

| Script              | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `pnpm types:gen`    | Regenerates `.claude-plugin/types/` (run it after upgrading Claude Code) |
| `pnpm types:check`  | Type-checks each plugin with `tsc`                                       |
| `pnpm lint`         | Lints the repo with ESLint                                               |
| `pnpm validate`     | Validates the marketplace and each plugin with `claude plugin validate`  |
| `pnpm test`         | Runs each plugin's `tests/` with `claude plugin test`                    |
| `pnpm format`       | Formats the repo with Prettier                                           |
| `pnpm format:check` | Checks formatting                                                        |

A [husky](https://typicode.github.io/husky/) pre-commit hook runs `format:check`, `lint`, `types:check`, `validate` and `test`. `pnpm i` installs it.

### Layout

- `.claude-plugin/marketplace.json`: lists the plugins
- `plugins/<name>/`: one self-contained plugin
    - `.claude-plugin/plugin.json`: the plugin manifest
    - `hooks/hooks.json`: lists the hooks modules
    - `hooks/*.tsx`: the hooks
    - `tests/`: unit tests
    - `tsconfig.json`: extends the generated `.claude-plugin/types/tsconfig.json`

### Adding a plugin

Create `plugins/<name>/` with the layout above, add it to `.claude-plugin/marketplace.json` and run `pnpm i` to generate its types. The scripts and CI pick it up from the `plugins/*` glob.

## License

[Apache 2.0](LICENSE)
