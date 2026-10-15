import type { SessionRateLimit } from "claude-code";
import { describe, expect, test } from "claude-code/testing";
import {
    DelayedResponse,
    Deny,
    Response,
    TestEngine,
} from "../../test-utils/test-engine";
import { MINUTE, timeFromNow } from "../../test-utils/time";

describe("readGitRef", () => {
    for (const [name, answers, expected] of [
        [
            "is the branch",
            [{ stdout: "# branch.head feature/hud" }],
            "📁 /work/repo  •  🌿 feature/hud",
        ],
        [
            "is the exact tag when HEAD is detached",
            [{ stdout: "# branch.head (detached)" }, { stdout: "v1.0.0" }],
            "📁 /work/repo  •  🔖 v1.0.0",
        ],
        [
            "is the short sha when HEAD is detached and untagged",
            [
                { stdout: "# branch.head (detached)" },
                { stdout: "", exitCode: 128 },
                { stdout: "abc1234" },
            ],
            "📁 /work/repo  •  📌 abc1234",
        ],
        [
            "ignores the output of a git command that failed",
            [
                { stdout: "# branch.head (detached)" },
                { exitCode: 128, stdout: "fatal: no tag" },
                { stdout: "abc1234" },
            ],
            "📁 /work/repo  •  📌 abc1234",
        ],
        [
            "prefers the branch over a tag on the same commit",
            [
                { stdout: "# branch.head main" },
                { stdout: "v1.0.0" },
                { stdout: "abc1234" },
            ],
            "📁 /work/repo  •  🌿 main",
        ],
        [
            "prefers the tag over the short sha",
            [
                { stdout: "# branch.head (detached)" },
                { stdout: "v1.0.0" },
                { stdout: "abc1234" },
            ],
            "📁 /work/repo  •  🔖 v1.0.0",
        ],
        [
            "is left out when the directory is not a git repository",
            [{ stdout: "", exitCode: 128 }],
            "📁 /work/repo",
        ],
    ] as const) {
        test(name, async ($, on) => {
            const engine = new TestEngine($, on);
            for (const answer of answers) {
                engine.workspace.git.onNextCall(new Response(answer));
            }

            await engine.startSession();
            await engine.settle();
            const workspace = (
                await (await engine.mountStatusBar()).workspaceRow()
            ).text();

            expect(workspace).toBe(expected);
        });
    }

    test("asks git only for the status when HEAD is on a branch, without optional locks", async ($, on) => {
        const engine = new TestEngine($, on);
        const argvs = (): string[][] =>
            engine.workspace.git.calls.map(({ argv }) => argv);
        expect(argvs()).toEqual([]);

        await engine.startSession();
        await engine.settle();

        expect(argvs()).toEqual([
            [
                "git",
                "--no-optional-locks",
                "status",
                "--porcelain=v2",
                "--branch",
                "--untracked-files=normal",
            ],
        ]);
    });

    test("asks git for an exact tag, then the short sha, when HEAD is detached", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head (detached)" }),
        );

        await engine.startSession();
        await engine.settle();

        expect(
            engine.workspace.git.calls.slice(1).map(({ argv }) => argv),
        ).toEqual([
            [
                "git",
                "--no-optional-locks",
                "describe",
                "--exact-match",
                "--tags",
                "HEAD",
            ],
            ["git", "--no-optional-locks", "rev-parse", "--short", "HEAD"],
        ]);
    });
});

describe("readGitChanges", () => {
    const header = "# branch.oid abc1234\n# branch.head main";

    for (const [name, answer, expected] of [
        [
            "counts a renamed and an unmerged file like any other change",
            {
                stdout: `${header}\n2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts\nu UU N... 100644 100644 100644 100644 a b c conflict.ts`,
            },
            "📁 /work/repo  •  🌿 main  •  📝 2",
        ],
        [
            "counts the changed and untracked files",
            {
                stdout: `${header}\n1 .M N... 100644 100644 100644 a b src/a.ts\n? new.ts`,
            },
            "📁 /work/repo  •  🌿 main  •  📝 2",
        ],
        [
            "shows how far the branch is ahead of and behind its upstream",
            {
                stdout: `${header}\n# branch.upstream origin/main\n# branch.ab +1 -2\n? new.ts`,
            },
            "📁 /work/repo  •  🌿 main  •  📝 1  ⏫ 1  ⏬ 2",
        ],
        [
            "reads a zero ahead count from the upstream line",
            {
                stdout: `${header}\n# branch.upstream origin/main\n# branch.ab +0 -3`,
            },
            "📁 /work/repo  •  🌿 main  •  ⏬ 3",
        ],
        [
            "counts the files it read, with a plus, when git's output is cut off",
            {
                // The cut falls inside the last line, which is not counted.
                stdout: `${header}\n# branch.upstream origin/main\n# branch.ab +1 -2\n? a.ts\n? b.ts\n? c.t`,
                truncated: true,
            },
            "📁 /work/repo  •  🌿 main  •  📝 2+  ⏫ 1  ⏬ 2",
        ],
        [
            "shows nothing for a clean branch with no upstream",
            { stdout: header },
            "📁 /work/repo  •  🌿 main",
        ],
        [
            "is left out when the status names no branch",
            { stdout: "# branch.oid abc1234" },
            "📁 /work/repo",
        ],
    ] as const) {
        test(name, async ($, on) => {
            const engine = new TestEngine($, on);
            engine.workspace.git.onNextCall(new Response(answer));

            await engine.startSession();
            await engine.settle();
            const workspace = (
                await (await engine.mountStatusBar()).workspaceRow()
            ).text();

            expect(workspace).toBe(expected);
        });
    }
});

describe("refreshWorkspace", () => {
    test("runs git in the session's directory", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.cwd.onNextCall(new Response("/work/other"));
        expect(engine.workspace.git.calls).toEqual([]);

        await engine.startSession();
        await engine.settle();

        expect(engine.workspace.git.calls.map(({ cwd }) => cwd)).toEqual([
            "/work/other",
        ]);
    });

    test("still shows the claude info when the git command is unavailable", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(new Deny("git is not installed"));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        const claude = (await view.claudeRow()).text();
        const workspace = (await view.workspaceRow()).text();
        expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%");
        expect(workspace).toBe("📁 /work/repo");
    });

    test("logs the git command that could not run, to the debug log, and stops reading git", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(new Deny("git is not installed"));
        expect(engine.ui.log.calls).toEqual([]);

        await engine.startSession();
        await engine.settle();

        expect(engine.ui.log.calls.map(({ to }) => to)).toEqual(["debug"]);
        expect(engine.ui.log.calls[0]?.text.split(" failed")[0]).toBe(
            "git status",
        );
        expect(engine.workspace.git.calls).toHaveLength(1);
    });

    test("keeps the last good git details while git cannot run, then recovers", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head main\n? a" }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main  •  📝 1",
        );

        engine.workspace.git.onNextCall(new Deny("git is not installed"));
        await engine.runBash();
        await engine.settle();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main  •  📝 1",
        );

        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head other" }),
        );
        await engine.runBash();
        await engine.settle();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 other",
        );
    });

    test("keeps the last good git details when the status cannot be read, then recovers", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head main\n? a" }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main  •  📝 1",
        );

        engine.workspace.git.onNextCall(new Deny("timed out"));
        await engine.runBash();
        await engine.settle();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main  •  📝 1",
        );

        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head other" }),
        );
        await engine.runBash();
        await engine.settle();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 other",
        );
    });

    test("drops the last good git details when the directory changes while git cannot run", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.git.onNextCall(new Deny("git is not installed"));
        engine.workspace.cwd.onNextCall(new Response("/work/other"));
        await engine.runBash();
        await engine.settle();

        expect((await view.workspaceRow()).text()).toBe("📁 /work/other");
    });

    test("does not take a status that cannot be read for a detached HEAD", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.git.onNextCall(new Deny("timed out"));
        engine.workspace.git.onNextCall(new Response({ stdout: "v1.0.0" }));
        await engine.runBash();
        await engine.settle();

        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
    });

    test("reads once more, not once per request, when requests arrive during a refresh", async ($, on) => {
        const engine = new TestEngine($, on);
        const totalReads = (): number =>
            engine.workspace.git.calls.filter(
                ({ argv }) => argv[2] === "status",
            ).length;

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
        expect(totalReads()).toBe(1);

        const olderRefreshHold = new DelayedResponse({
            stdout: "# branch.head older",
        });

        engine.workspace.git.onNextCall(olderRefreshHold);
        await engine.runBash();
        await engine.settle();
        await olderRefreshHold.reached;

        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head newer" }),
        );
        await engine.runBash();
        await engine.settle();
        await engine.runBash();
        await engine.settle();
        expect(totalReads()).toBe(2);

        olderRefreshHold.release();
        await engine.settle();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 newer",
        );

        expect(totalReads()).toBe(3);
    });

    test("keeps the last good data and logs to the debug log while the directory cannot be read", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
        expect(engine.ui.log.calls).toEqual([]);

        engine.workspace.cwd.onNextCall(new Deny("cwd is not available"));
        await engine.runBash();
        await engine.settle();

        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
        expect(engine.ui.log.calls.map(({ to }) => to)).toEqual(["debug"]);
        expect(engine.ui.log.calls[0]?.text).toContain("session read failed");
    });

    test("follows the session's directory", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.cwd.onNextCall(new Response("/work/other"));
        await engine.runBash();
        await engine.settle();

        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/other  •  🌿 main",
        );
    });
});

describe("singleFlight", () => {
    test("logs a refresh that fails to the debug log, and runs the next one", async ($, on) => {
        const engine = new TestEngine($, on);
        let isWriteFailing = true;
        on("state.set", (_$, e, next) =>
            isWriteFailing ? { deny: "write refused" } : next(e),
        );
        expect(engine.ui.log.calls).toEqual([]);

        await engine.startSession();
        await engine.settle();

        expect(engine.ui.log.calls.map(({ to }) => to)).toEqual([
            "debug",
            "debug",
        ]);
        expect(engine.ui.log.calls[0]?.text).toContain("refresh failed");
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).isEmpty()).toBe(true);
        expect((await view.workspaceRow()).isEmpty()).toBe(true);

        isWriteFailing = false;
        await engine.advance(MINUTE);
        await engine.settle();

        expect(engine.ui.log.calls).toHaveLength(2);
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
    });
});

describe("refreshClaude", () => {
    describe("rate limits", () => {
        const cases: [
            name: string,
            rateLimits: SessionRateLimit[],
            expected: string,
        ][] = [
            [
                "show the percentage used and the time until reset for each window",
                [
                    {
                        kind: "five_hour",
                        percentUsed: 42.4,
                        resetsAt: timeFromNow(3 * 3600 + 10 * 60),
                    },
                    {
                        kind: "seven_day",
                        percentUsed: 7,
                        resetsAt: timeFromNow(2 * 86400 + 3600),
                    },
                ],
                "🤖 Opus 4.5  •  🧠 42%  •  🕐 5h 42%  🔄 3h 10m  •  📅 7d 7%  🔄 2d 1h 0m",
            ],
            [
                "only show the windows the engine reports a limit for",
                [{ kind: "seven_day", percentUsed: 7 }],
                "🤖 Opus 4.5  •  🧠 42%  •  📅 7d 7%",
            ],
            [
                "leave out the time until reset when the engine's reset time is not a date",
                [{ kind: "five_hour", percentUsed: 10, resetsAt: "soon" }],
                "🤖 Opus 4.5  •  🧠 42%  •  🕐 5h 10%",
            ],
            [
                "show a gateway spend limit, even past 100% used",
                [
                    {
                        kind: "spend_limit",
                        percentUsed: 120,
                        resetsAt: timeFromNow(2 * 86400 + 3600),
                    },
                ],
                "🤖 Opus 4.5  •  🧠 42%  •  💳 spend 120%  🔄 2d 1h 0m",
            ],
            [
                "ignore unknown limit kinds",
                [{ kind: "seven_day_opus", percentUsed: 80 }],
                "🤖 Opus 4.5  •  🧠 42%",
            ],
        ];

        for (const [name, rateLimits, expected] of cases) {
            test(name, async ($, on) => {
                const engine = new TestEngine($, on);
                engine.claude.usage.onNextCall(new Response({ rateLimits }));

                await engine.startSession();
                await engine.settle();
                const claude = (
                    await (await engine.mountStatusBar()).claudeRow()
                ).text();

                expect(claude).toBe(expected);
            });
        }
    });

    test("reads once more, not once per request, when requests arrive during a refresh", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
        expect(engine.claude.usage.calls.length).toBe(1);

        const olderRefreshHold = new DelayedResponse({
            contextPercent: 50,
        });

        engine.claude.usage.onNextCall(olderRefreshHold);
        await engine.measureSession();
        await olderRefreshHold.reached;

        engine.claude.usage.onNextCall(new Response({ contextPercent: 80 }));
        await engine.measureSession();
        await engine.measureSession();
        await engine.settle();
        expect(engine.claude.usage.calls.length).toBe(2);

        olderRefreshHold.release();
        await engine.settle();

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 80%");
        expect(engine.claude.usage.calls.length).toBe(3);
    });

    test("still draws the model and the workspace when the usage figures cannot be read at the start", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Deny("usage is not available"));

        await engine.startSession();
        await engine.settle();

        const view = await engine.mountStatusBar();

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5");
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
    });

    test("draws only the engine's line while neither the model nor the usage figures can be read, and the directory cannot either", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.model.onNextCall(new Deny("model is not available"));
        engine.claude.usage.onNextCall(new Deny("usage is not available"));
        engine.workspace.cwd.onNextCall(new Deny("cwd is not available"));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect((await view.claudeRow()).isEmpty()).toBe(true);
        expect((await view.workspaceRow()).isEmpty()).toBe(true);
    });

    test("logs to the debug log when the usage figures cannot be read", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Deny("usage is not available"));
        expect(engine.ui.log.calls).toEqual([]);

        await engine.startSession();
        await engine.settle();

        expect(engine.ui.log.calls.map(({ to }) => to)).toEqual(["debug"]);
        expect(engine.ui.log.calls[0]?.text).toContain("session read failed");
    });

    test("keeps the last good usage figures but follows the model while the usage figures cannot be read, then recovers", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.usage.onNextCall(new Deny("usage is not available"));
        engine.claude.model.onNextCall(new Response("claude-sonnet-4-5"));
        await engine.advance(MINUTE);
        expect((await view.claudeRow()).text()).toBe(
            "🤖 Sonnet 4.5  •  🧠 42%",
        );

        engine.claude.usage.onNextCall(new Response({ contextPercent: 80 }));
        engine.claude.model.onNextCall(new Response("claude-sonnet-4-5"));
        await engine.advance(MINUTE);
        expect((await view.claudeRow()).text()).toBe(
            "🤖 Sonnet 4.5  •  🧠 80%",
        );
    });

    test("keeps the last good model while the engine reports none", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.model.onNextCall(new Response(""));
        await engine.advance(MINUTE);

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
    });

    test("keeps the last good model while the model cannot be read", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.model.onNextCall(new Deny("model is not available"));
        engine.claude.usage.onNextCall(new Response({ contextPercent: 80 }));
        await engine.advance(MINUTE);

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 80%");
    });
});
