import { describe, expect, test } from "claude-code/testing";
import {
    DelayedResponse,
    Deny,
    Response,
    TESTED_WORKSPACE_TOOLS,
    TestEngine,
} from "../../test-utils/test-engine";
import { MINUTE, timeFromNow } from "../../test-utils/time";
import { WORKSPACE_CHANGING_TOOLS } from "./register";

describe("register", () => {
    test("redraws when the engine measures the session", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.model.onNextCall(
            new Response("claude-sonnet-4-5-20250929"),
        );
        engine.claude.usage.onNextCall(new Response({ contextPercent: 80 }));
        await engine.measureSession();
        await engine.settle();

        expect((await view.claudeRow()).text()).toBe(
            "🤖 Sonnet 4.5  •  🧠 80%",
        );
    });

    test("redraws every minute", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head other" }),
        );
        await engine.advance(MINUTE - 1);
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        await engine.advance(1);
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 other",
        );
    });

    test("count the time until reset down as the minutes pass", async ($, on) => {
        const engine = new TestEngine($, on);
        // Both refreshes read the limit: the one at the start and the one a
        // minute on.
        for (let reads = 0; reads < 2; reads++) {
            engine.claude.usage.onNextCall(
                new Response({
                    rateLimits: [
                        {
                            kind: "five_hour",
                            percentUsed: 10,
                            resetsAt: timeFromNow(3 * 3600 + 10 * 60),
                        },
                    ],
                }),
            );
        }

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toContain("🔄 3h 10m");

        await engine.advance(MINUTE);

        expect((await view.claudeRow()).text()).toContain("🔄 3h 9m");
    });

    test("refreshes once a minute, however many times the session starts", async ($, on) => {
        const engine = new TestEngine($, on);
        const totalRefreshes = (): number =>
            engine.workspace.git.calls.filter(
                ({ argv }) => argv[2] === "status",
            ).length;
        expect(totalRefreshes()).toBe(0);

        await engine.startSession();
        await engine.settle();
        await engine.startSession();
        await engine.settle();
        expect(totalRefreshes()).toBe(2);

        await engine.advance(MINUTE);
        expect(totalRefreshes()).toBe(3);
    });

    // The helper holds a valid call for each tool, so a tool added to the
    // plugin alone would otherwise go untested.
    test("tests every tool the plugin refreshes the workspace after", () => {
        expect([...WORKSPACE_CHANGING_TOOLS].sort()).toEqual(
            [...TESTED_WORKSPACE_TOOLS].sort(),
        );
    });

    for (const tool of TESTED_WORKSPACE_TOOLS) {
        test(`redraws the workspace after ${tool}, a tool that can change files`, async ($, on) => {
            const engine = new TestEngine($, on);

            await engine.startSession();
            await engine.settle();
            const view = await engine.mountStatusBar();
            expect((await view.workspaceRow()).text()).toBe(
                "📁 /work/repo  •  🌿 main",
            );

            engine.workspace.git.onNextCall(
                new Response({ stdout: "# branch.head main\n? a" }),
            );
            await engine.changeWorkspace(tool);
            await engine.settle();

            expect((await view.workspaceRow()).text()).toBe(
                "📁 /work/repo  •  🌿 main  •  📝 1",
            );
        });
    }

    test("redraws the workspace after a tool call that is aborted", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head other" }),
        );
        engine.tool.call.onNextCall(new Deny("aborted"));
        await expect(engine.runBash()).rejects.toThrow();
        await engine.settle();
        expect(engine.tool.call.calls.length).toBe(1);

        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 other",
        );
    });

    test("redraws the workspace when the session's directory changes", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );

        engine.workspace.cwd.onNextCall(new Response("/work/repo-worktree"));
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head feature" }),
        );
        await $.classic.CwdChanged({
            old_cwd: "/work/repo",
            new_cwd: "/work/repo-worktree",
        });
        await engine.settle();

        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo-worktree  •  🌿 feature",
        );
    });

    test("does not read the figures from Claude again when the session's directory changes", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const usageReadsAtStart = engine.claude.usage.calls.length;
        expect(usageReadsAtStart).toBeGreaterThan(0);

        await $.classic.CwdChanged({
            old_cwd: "/work/repo",
            new_cwd: "/work/other",
        });
        await engine.settle();

        expect(engine.claude.usage.calls.length).toBe(usageReadsAtStart);
    });

    test("leaves the git state alone after a tool that cannot change files", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        expect(engine.workspace.git.calls.length).toBeGreaterThan(0);
        const commandsAtStart = engine.workspace.git.calls.length;

        await engine.readFile();
        await engine.settle();

        expect(engine.workspace.git.calls).toHaveLength(commandsAtStart);
    });

    test("does not read git again when the engine measures the session", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const commandsAtStart = engine.workspace.git.calls.length;
        expect(commandsAtStart).toBeGreaterThan(0);

        await engine.measureSession();
        await engine.settle();

        expect(engine.workspace.git.calls).toHaveLength(commandsAtStart);
    });

    test("gives the tool's result back unchanged", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();

        const result = await engine.runBash();
        await engine.settle();

        expect(result).toEqual({ result: "ok" });
    });

    test("does not redraw the figures from Claude after a tool call", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.usage.onNextCall(new Response({ contextPercent: 80 }));
        await engine.runBash();
        await engine.settle();

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
    });

    test("does not hold up the session start while git runs", async ($, on) => {
        const engine = new TestEngine($, on);
        const gitHold = new DelayedResponse({
            stdout: "# branch.head main",
        });
        engine.workspace.git.onNextCall(gitHold);

        // Resolves, with git still held, only if the hook does not wait for it.
        await engine.startSession();
        await gitHold.reached;

        gitHold.release();
        await engine.settle();
    });

    test("does not hold up a tool call while git runs", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const gitHold = new DelayedResponse({
            stdout: "# branch.head main",
        });
        engine.workspace.git.onNextCall(gitHold);

        await engine.runBash();
        await gitHold.reached;

        gitHold.release();
        await engine.settle();
    });

    // /clear, /resume and /branch (source "fork") reset $.state and do not
    // fire session.start again, so a test that skips it starts where they
    // leave the plugin.
    for (const source of ["clear", "resume", "fork"] as const) {
        test(`draws again after a session starts from ${source}`, async ($, on) => {
            const engine = new TestEngine($, on);

            await engine.startSessionFrom(source);
            await engine.settle();
            const view = await engine.mountStatusBar();

            const claude = (await view.claudeRow()).text();
            const workspace = (await view.workspaceRow()).text();
            expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%");
            expect(workspace).toBe("📁 /work/repo  •  🌿 main");
        });
    }

    test("reads nothing when a session starts or is compacted", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSessionFrom("startup");
        await engine.startSessionFrom("compact");
        await engine.settle();

        expect(engine.workspace.git.calls).toEqual([]);
        expect(engine.claude.usage.calls.length).toBe(0);
    });

    test("tries again on the next timer tick after the first refresh fails", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Deny("usage is not available"));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5");

        await engine.advance(MINUTE);

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
    });
});
