import {
    update,
    type EngineInterface,
    type PluginState,
    type SessionRateLimit,
} from "claude-code";

// The shapes are declared once, in types/index.d.ts, because that is what the
// engine checks `$.state` against.
export type ClaudeState = PluginState["hud"]["claude"];
export type WorkspaceState = PluginState["hud"]["workspace"];

export type RateLimitKind = keyof ClaudeState["rateLimit"];
export type RateLimit = NonNullable<ClaudeState["rateLimit"][RateLimitKind]>;

export type GitChanges = Pick<
    WorkspaceState["git"],
    "dirty" | "ahead" | "behind"
>;

type GitRef = NonNullable<WorkspaceState["git"]["ref"]>;

const DETACHED_HEAD = "(detached)";

const RATE_LIMIT_ENGINE_KINDS: Record<RateLimitKind, string> = {
    fiveHour: "five_hour",
    sevenDay: "seven_day",
    spend: "spend_limit",
};

const readRateLimit = (
    limits: SessionRateLimit[],
    kind: RateLimitKind,
): RateLimit | undefined => {
    const limit = limits.find((l) => l.kind === RATE_LIMIT_ENGINE_KINDS[kind]);
    if (!limit) {
        return undefined;
    }

    // Date.parse is NaN for a missing or unreadable date.
    const resetsAtMillis = Date.parse(limit.resetsAt ?? "");
    return {
        percentUsed: limit.percentUsed,
        ...(!Number.isNaN(resetsAtMillis) && { resetsAtMillis }),
    };
};

interface Flight {
    isRunning: boolean;
    // Cleared to `undefined` once taken, so the slot is empty between runs.
    latestRun?: (() => Promise<void>) | undefined;
}

const claudeFlight: Flight = { isRunning: false };
const workspaceFlight: Flight = { isRunning: false };

// One run at a time. A request made during a run sets it going once more after
// it, so the change that prompted the request is read, and a burst costs one
// extra run rather than one each. The run that goes again is the latest one
// requested. The flight is module state because each call brings its own `run`,
// which closes over that call's `$`.
//
// The call that starts a flight settles once the flight is idle, after its own
// run and any run queued behind it. A call made during a flight only queues its
// `run` and settles at once, so the state may not be written yet.
async function singleFlight(
    $: EngineInterface,
    flight: Flight,
    run: () => Promise<void>,
): Promise<void> {
    flight.latestRun = run;
    if (flight.isRunning) {
        return;
    }

    flight.isRunning = true;
    try {
        while (flight.latestRun) {
            const nextRun = flight.latestRun;
            flight.latestRun = undefined;
            try {
                await nextRun();
            } catch (error) {
                // Nothing awaits a refresh, so a failed write would be an
                // unhandled rejection. Like a refused read, it is retried on
                // the next refresh.
                $.ui.log(`refresh failed: ${String(error)}`, { to: "debug" });
            }
        }
    } finally {
        flight.isRunning = false;
    }
}

// A git that cannot run (missing binary, timeout) throws, apart from a git that
// exits non-zero, which is how a directory outside a repository answers. The
// output is empty both for that and for a git that printed nothing.
async function runGit(
    $: EngineInterface,
    cwd: string,
    ...args: string[]
): Promise<{ output: string; truncated: boolean }> {
    try {
        const { exitCode, stdout, isStdoutTruncated } = await $.process.run(
            ["git", "--no-optional-locks", ...args],
            { cwd },
        );
        return {
            output: exitCode === 0 ? stdout.trim() : "",
            truncated: isStdoutTruncated,
        };
    } catch (error) {
        throw new Error(`git ${args[0]} failed`, { cause: error });
    }
}

// Branch, else exact tag, else short sha. A detached HEAD is the only case that
// needs more than the status, whose `# branch.head` line names the branch.
async function readGitRef(
    $: EngineInterface,
    cwd: string,
    head: string,
): Promise<GitRef | undefined> {
    if (head !== DETACHED_HEAD) {
        return { kind: "branch", name: head };
    }

    const { output: tag } = await runGit(
        $,
        cwd,
        "describe",
        "--exact-match",
        "--tags",
        "HEAD",
    );
    if (tag) {
        return { kind: "tag", name: tag };
    }

    const { output: sha } = await runGit(
        $,
        cwd,
        "rev-parse",
        "--short",
        "HEAD",
    );
    if (sha) {
        return { kind: "sha", name: sha };
    }
    return undefined;
}

// Untracked files count as changes, so the mode is pinned: the porcelain format
// ignores most user config, but `-u` still follows `status.showUntrackedFiles`.
// `# branch.ab` is only there with an
// upstream, and the `# branch.*` header lines come first, so they survive git's
// output being cut off. That cut can fall inside a line, so the last line is
// dropped, which leaves the count a true lower bound. Without `-z` git quotes
// any control character in a path, so each entry stays on one line.
async function readGit(
    $: EngineInterface,
    cwd: string,
): Promise<WorkspaceState["git"]> {
    const { output: status, truncated } = await runGit(
        $,
        cwd,
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=normal",
    );
    if (!status) {
        return {};
    }

    const lines = status.split("\n");
    if (truncated) {
        lines.pop();
    }
    const head = lines
        .find((line) => line.startsWith("# branch.head "))
        ?.slice("# branch.head ".length);
    if (!head) {
        return {};
    }
    const aheadBehind = lines
        .map((line) => /^# branch\.ab \+(\d+) -(\d+)$/.exec(line))
        .find(Boolean);

    const ref = await readGitRef($, cwd, head);

    return {
        ...(ref && { ref }),
        dirty: {
            value: lines.filter((line) => !line.startsWith("#")).length,
            truncated,
        },
        ...(aheadBehind && {
            ahead: Number(aheadBehind[1]),
            behind: Number(aheadBehind[2]),
        }),
    };
}

// Settles as `singleFlight` does: during a flight, before the state is written.
export function refreshClaude($: EngineInterface): Promise<void> {
    return singleFlight($, claudeFlight, async () => {
        // A refused read would otherwise fail the hook on every refresh. It
        // is logged and left undefined, so what it feeds keeps its last good
        // value until the next refresh.
        const logRefusal = (error: unknown): undefined => {
            $.ui.log(`session read failed: ${String(error)}`, { to: "debug" });
            return undefined;
        };
        const [model, usage, now] = await Promise.all([
            $.session.model().catch(logRefusal),
            $.session.usage().catch(logRefusal),
            $.clock.now(),
        ]);
        if (!model && !usage) {
            return;
        }

        const rateLimits = usage?.rateLimits ?? [];
        const fiveHourRateLimit = readRateLimit(rateLimits, "fiveHour");
        const sevenDayRateLimit = readRateLimit(rateLimits, "sevenDay");
        const spendRateLimit = readRateLimit(rateLimits, "spend");

        // The figures the engine has no value for are left out, not set to
        // `undefined`, so they read as absent.
        const usageFigures = usage && {
            contextWindow: {
                total: usage.context.window,
                ...(usage.context.percent !== undefined && {
                    usedPercent: usage.context.percent,
                }),
                ...(usage.context.tokens !== undefined && {
                    used: usage.context.tokens,
                }),
            },
            ...(usage.cost && { costUsd: usage.cost.usd }),
            rateLimit: {
                ...(fiveHourRateLimit && { fiveHour: fiveHourRateLimit }),
                ...(sevenDayRateLimit && { sevenDay: sevenDayRateLimit }),
                ...(spendRateLimit && { spend: spendRateLimit }),
            },
        };

        await update(
            $,
            { plugin: "hud", key: "claude" } as const,
            (previous): ClaudeState => {
                const latestModel = model || previous?.model;
                return {
                    ...(usageFigures ??
                        previous ?? {
                            contextWindow: { total: 0 },
                            rateLimit: {},
                        }),
                    measuredAt: now,
                    ...(latestModel && { model: latestModel }),
                };
            },
        );
    });
}

// Settles as `singleFlight` does: during a flight, before the state is written.
export function refreshWorkspace($: EngineInterface): Promise<void> {
    return singleFlight($, workspaceFlight, async () => {
        let cwd;
        try {
            cwd = await $.session.cwd();
        } catch (error) {
            $.ui.log(`session read failed: ${String(error)}`, { to: "debug" });
            return;
        }

        // A git that cannot run would repeat on every refresh, so it stays out
        // of the transcript. The git details then keep their last good value,
        // and are dropped only for another directory.
        let git: WorkspaceState["git"] | undefined;
        try {
            git = await readGit($, cwd);
        } catch (error) {
            $.ui.log(
                error instanceof Error
                    ? `${error.message}: ${String(error.cause)}`
                    : String(error),
                { to: "debug" },
            );
        }

        await update(
            $,
            { plugin: "hud", key: "workspace" } as const,
            (previous): WorkspaceState => ({
                cwd,
                git: git ?? (previous?.cwd === cwd ? previous.git : {}),
            }),
        );
    });
}
