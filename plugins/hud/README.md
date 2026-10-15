# HUD

A heads-up display for Claude Code: see what Claude is up to without leaving the conversation.

Right now it is a status bar with two rows:

- **Claude:** model, context, rate limits, cost.
- **Workspace:** directory, git ref and changes.

```
🤖 Opus 5.5  •  🧠 42% (84k/200k)  •  🕐 5h 42%  🔄 3h 10m  •  📅 7d 7%  🔄 2d 4h 0m
📁 /work/repo  •  🌿 main  •  📝 3  ⏫ 1
```

## Install

```
/plugin install hud --marketplace nadundesilva/claude-plugins
```

Other ways to install, and how to update, are in the [main README](../../README.md).

## What it shows

**Claude row**

| Item | Meaning                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 🤖   | The model as family and version (`claude-opus-5-5` → `Opus 5.5`). Unknown ids show as is.                              |
| 🧠   | Context used: percent, then tokens over the window (`(84k/200k)`).                                                     |
| 💰   | Session cost in USD. Only when there are no rate-limit windows (API key, Bedrock, Vertex) and the cost is above $0.00. |
| 🕐   | Five-hour rate limit: percent used, then 🔄 time until it resets.                                                      |
| 📅   | Seven-day rate limit, the same way.                                                                                    |
| 💳   | Gateway spend limit, the same way.                                                                                     |

**Workspace row**

| Item     | Meaning                                                                             |
| -------- | ----------------------------------------------------------------------------------- |
| 📁       | The session's working directory.                                                    |
| 🌿       | The git ref: the branch, else the exact tag (🔖), else the short sha (📌).          |
| 📝 ⏫ ⏬ | Changed files and untracked entries, then commits ahead of and behind the upstream. |

A figure Claude Code has not reported yet (for example a rate limit before the first response) is left out.

## Colours

Colour tells you whether to act: 🟢 ok, 🟡 warning, 🔴 critical.

| Metric                      | 🟡 Warning above | 🔴 Critical above |
| --------------------------- | ---------------- | ----------------- |
| Context (🧠)                | 30%              | 70%               |
| 5h, 7d and spend (🕐 📅 💳) | 50%              | 80%               |

- Context is stricter because you can act on it early, by compacting.
- Grading uses the rounded percent you see.
- The 🔄 reset timer is graded by **pace**, not by how close the reset is. It turns yellow or red when you are using a limit fast enough to be locked out for a good part of the window. See [Reset pacing](#reset-pacing).

## Good to know

- **Narrow terminal:** rows wrap between sections (the parts separated by `•`), never inside one. Only a section wider than the whole terminal is cut short.
- **Not a git repository:** the git details are left out.
- **Managed organizations:** where an organization manages Claude Code, hooks on `/clear`, `/resume` and `/branch` do not run for an installed plugin, so the bar waits for the next 60-second refresh.

## How it works

For when something looks surprising.

### When it updates

**Claude row** (model, context, limits, cost):

- at session start, and after `/clear`, `/resume` and `/branch`
- whenever Claude Code takes a fresh reading of the session
- every 60 seconds

**Workspace row** (directory and git):

- at session start, and after `/clear`, `/resume` and `/branch`
- every 60 seconds
- when the working directory changes (for example entering or leaving a worktree)
- after a tool that can change files (Bash, Edit, Write, NotebookEdit)

- The rows refresh independently.
- Nothing waits for a refresh, so a slow `git` never holds up the session or a tool call.

### Git counts

- Zero counts are left out.
- An untracked directory counts once, as in `git status`.
- Ahead/behind only show when the branch has an upstream.
- A changed-file count ending in `+` (`📝 52341+`) is a lower bound: git's output was cut off at 4 MiB.

### Reset pacing

The 🔄 timer asks: at the pace you have held since the window opened, how long would you be locked out before it resets?

1. Take the share of the window elapsed and the percent used so far.
2. Project when you would hit 100% at that pace.
3. The wait is the time from then until the reset, as a share of the window.
    - 0 if you would last until the reset
    - the whole time left if you are already at 100%

| Wait, as a share of the window | Level    |
| ------------------------------ | -------- |
| up to 20%                      | ok       |
| over 20%, up to 50%            | warning  |
| over 50%                       | critical |

- Windows are 5 hours (🕐) and 7 days (📅). The spend limit has no known window length, so its reset keeps the colour of its percentage used.
- Early in a window, a short burst projects a long lockout and can show critical until the pace evens out.
- Having used nothing is always ok, however far off the reset is.

### When something fails

- **A figure fails to read:** the model and usage figures are read separately, and a failed one keeps its last good value while the rest still update.
- **`git` missing or timed out:** the git details keep their last good value for the same directory, and the failure goes to the debug log.
- **Only the change counts fail:** the ref is shown without them.

### Why these thresholds

- They are judgement calls.
- Other Claude Code status lines commonly turn yellow at 50% and red at 75–80%.
- There is no established standard for grading a reset timer.

## Contributing

Contributions, suggestions and feature requests are welcome.

- **An idea for what the HUD should show?** [Open an issue](https://github.com/nadundesilva/claude-plugins/issues).
- **Want to change the code?** Open a pull request, and see [DEVELOPMENT.md](DEVELOPMENT.md).
