# Claude Plugins

Claude plugins that make [Claude Code](https://claude.com/claude-code) nicer to work in, by Nadun De Silva.

> 🚧 **Work in progress:** plugins and their interfaces may change without notice.

## Plugins

| Plugin             | What it does                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| [hud](plugins/hud) | A heads-up display for Claude Code: see what Claude is doing at a glance. Today: model, context, rate limits and git status |

## Install

Replace `<plugin-name>` below with a plugin from the table, such as `hud`.

Quickest: one step, which asks you to confirm adding the marketplace.

```
/plugin install <plugin-name> --marketplace nadundesilva/claude-plugins
```

Or add the marketplace first, then install. In Claude Code:

```
/plugin marketplace add nadundesilva/claude-plugins
/plugin install <plugin-name>@nadundesilva
```

In a terminal:

```sh
claude plugin marketplace add nadundesilva/claude-plugins
claude plugin install <plugin-name>@nadundesilva
```

## Update

Refresh the marketplace, then update the plugin. Restart Claude Code to apply it.

In Claude Code:

```
/plugin marketplace update nadundesilva
/plugin update <plugin-name>@nadundesilva
```

In a terminal:

```sh
claude plugin marketplace update nadundesilva
claude plugin update <plugin-name>@nadundesilva
```

## Contributing

Contributions, suggestions and feature requests are welcome.

- **Idea or request?** [Open an issue](https://github.com/nadundesilva/claude-plugins/issues).
- **Want to change a plugin?** Open a pull request, and see [DEVELOPMENT.md](DEVELOPMENT.md).

## License

[Apache 2.0](LICENSE)
