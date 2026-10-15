import { describe, expect, test } from "claude-code/testing";
import { Deny, Response, TestEngine } from "../../test-utils/test-engine";
import { timeFromNow } from "../../test-utils/time";
import type { StatusBarView } from "../../test-utils/views/status-bar-view";
import {
    formatContext,
    formatGitChanges,
    formatModelName,
    formatRemainingTime,
    formatTokens,
    rateLimitSectionItems,
    resetColor,
    TEXT_COLORS,
    usageColor,
    waitFraction,
} from "./render";

// The keys of the keyed elements drawn, in drawn order. Only a Box keeps its key.
const keysOf = async (view: StatusBarView): Promise<string[]> =>
    (await view.findAll({ type: "Box" })).flatMap(({ key }) =>
        key === undefined ? [] : [key],
    );

describe("formatModelName", () => {
    test("formats family, major and minor", () => {
        expect(formatModelName("claude-opus-4-7")).toBe("Opus 4.7");
    });

    test("omits a missing minor version", () => {
        expect(formatModelName("claude-fable-5")).toBe("Fable 5");
    });

    test("ignores a date suffix", () => {
        expect(formatModelName("claude-opus-4-20250514")).toBe("Opus 4");
        expect(formatModelName("claude-sonnet-4-5-20250929")).toBe(
            "Sonnet 4.5",
        );
    });

    test("ignores a context window suffix", () => {
        expect(formatModelName("claude-opus-4-5[1m]")).toBe("Opus 4.5");
    });

    test("ignores a Bedrock prefix and version suffix", () => {
        expect(
            formatModelName("us.anthropic.claude-opus-4-5-20251101-v1:0"),
        ).toBe("Opus 4.5");
        expect(formatModelName("anthropic.claude-sonnet-4-20250514-v1:0")).toBe(
            "Sonnet 4",
        );
    });

    test("ignores a Vertex date suffix", () => {
        expect(formatModelName("claude-opus-4-5@20251101")).toBe("Opus 4.5");
    });

    test("formats an old-style id with the version first", () => {
        expect(formatModelName("claude-3-5-sonnet-20241022")).toBe(
            "Sonnet 3.5",
        );
        expect(formatModelName("claude-3-opus-20240229")).toBe("Opus 3");
        expect(formatModelName("anthropic.claude-3-haiku-20240307-v1:0")).toBe(
            "Haiku 3",
        );
    });

    test("returns an unrecognised id unchanged", () => {
        expect(formatModelName("gpt-4")).toBe("gpt-4");
    });
});

describe("formatRemainingTime", () => {
    test("is 'now' once elapsed", () => {
        expect(formatRemainingTime(0)).toBe("now");
        expect(formatRemainingTime(-5)).toBe("now");
    });

    test("shows only the units that matter, and <1m under a minute", () => {
        expect(formatRemainingTime(30)).toBe("<1m");
        expect(formatRemainingTime(59)).toBe("<1m");
        expect(formatRemainingTime(60)).toBe("1m");
        expect(formatRemainingTime(90)).toBe("1m");
        expect(formatRemainingTime(3600)).toBe("1h 0m");
        expect(formatRemainingTime(86400)).toBe("1d 0h 0m");
        expect(formatRemainingTime(3 * 3600 + 120)).toBe("3h 2m");
        expect(formatRemainingTime(2 * 86400 + 3600 + 60)).toBe("2d 1h 1m");
    });
});

describe("formatTokens", () => {
    test("shows counts under a thousand as they are", () => {
        expect(formatTokens(0)).toBe("0");
        expect(formatTokens(950)).toBe("950");
    });

    test("uses k, with one decimal below 10k", () => {
        expect(formatTokens(1000)).toBe("1k");
        expect(formatTokens(9500)).toBe("9.5k");
        expect(formatTokens(12_300)).toBe("12k");
        expect(formatTokens(84_000)).toBe("84k");
        expect(formatTokens(200_000)).toBe("200k");
    });

    test("uses M from a million, with one decimal below 10M", () => {
        expect(formatTokens(1_000_000)).toBe("1M");
        expect(formatTokens(1_200_000)).toBe("1.2M");
    });

    test("moves to M instead of rounding up to 1000k", () => {
        expect(formatTokens(999_499)).toBe("999k");
        expect(formatTokens(999_500)).toBe("1M");
    });
});

describe("formatContext", () => {
    const total = 200_000;

    test("shows the percentage used alone until the engine reports tokens", () => {
        expect(formatContext({ usedPercent: 42, total })).toBe("🧠 42%");
    });

    test("rounds the percentage used to the nearest whole number", () => {
        expect(formatContext({ usedPercent: 42.6, total })).toBe("🧠 43%");
    });

    test("shows 0% rather than leaving it out", () => {
        expect(formatContext({ usedPercent: 0, total })).toBe("🧠 0%");
    });

    test("shows the tokens used against the window, in brackets", () => {
        expect(formatContext({ usedPercent: 42, used: 84_000, total })).toBe(
            "🧠 42% (84k/200k)",
        );
    });
});

describe("formatGitChanges", () => {
    test("is empty for a clean branch", () => {
        expect(formatGitChanges({})).toBe("");
        expect(
            formatGitChanges({
                dirty: { value: 0, truncated: false },
                ahead: 0,
                behind: 0,
            }),
        ).toBe("");
    });

    test("lists the changed files, then ahead, then behind", () => {
        expect(
            formatGitChanges({
                dirty: { value: 3, truncated: false },
                ahead: 1,
                behind: 2,
            }),
        ).toBe("📝 3  ⏫ 1  ⏬ 2");
    });

    test("marks a count that is a lower bound with a plus", () => {
        expect(
            formatGitChanges({
                dirty: { value: 3, truncated: true },
                ahead: 1,
            }),
        ).toBe("📝 3+  ⏫ 1");
        expect(
            formatGitChanges({ dirty: { value: 3, truncated: false } }),
        ).toBe("📝 3");
    });

    test("skips the parts that are zero or unknown", () => {
        expect(
            formatGitChanges({
                dirty: { value: 0, truncated: false },
                ahead: 4,
            }),
        ).toBe("⏫ 4");
    });
});

describe("rateLimitSectionItems", () => {
    const now = 1_000_000;
    const { ok, critical } = TEXT_COLORS.severity;

    test("is empty without a limit", () => {
        expect(rateLimitSectionItems("fiveHour", undefined, now)).toEqual([]);
    });

    test("shows the percentage used alone when there is no reset time", () => {
        expect(
            rateLimitSectionItems("fiveHour", { percentUsed: 42.4 }, now),
        ).toEqual([{ id: "percent", color: ok, text: "🕐 5h 42%" }]);
    });

    test("rounds the percentage used to the nearest whole number", () => {
        const [used] = rateLimitSectionItems(
            "fiveHour",
            { percentUsed: 42.6 },
            now,
        );

        expect(used?.text).toBe("🕐 5h 43%");
    });

    test("counts the time until reset in whole seconds, so under a minute away is <1m", () => {
        const [, reset] = rateLimitSectionItems(
            "fiveHour",
            { percentUsed: 42, resetsAtMillis: now + 59_900 },
            now,
        );

        expect(reset?.text).toBe("🔄 <1m");
    });

    test("says now once the reset time has passed", () => {
        const [, reset] = rateLimitSectionItems(
            "fiveHour",
            { percentUsed: 100, resetsAtMillis: now - 5000 },
            now,
        );

        expect(reset?.text).toBe("🔄 now");
    });

    test("follows the percentage used with the time until reset", () => {
        const resetsAtMillis = now + (3 * 3600 + 10 * 60) * 1000;
        const items = rateLimitSectionItems(
            "sevenDay",
            { percentUsed: 7, resetsAtMillis },
            now,
        );

        expect(items.map(({ text }) => text)).toEqual([
            "📅 7d 7%",
            "🔄 3h 10m",
        ]);
    });

    test("colours the reset by pace, apart from the percentage used", () => {
        // 42% used 1h in, with 4h left: out after another 1h 23m, a 52% wait.
        const items = rateLimitSectionItems(
            "fiveHour",
            { percentUsed: 42, resetsAtMillis: now + 4 * 3600 * 1000 },
            now,
        );

        expect(items.map(({ color }) => color)).toEqual([ok, critical]);
    });
});

describe("usageColor", () => {
    const { ok, warning, critical } = TEXT_COLORS.severity;

    test("grades context ok up to 30%, warning above 30%, critical above 70%", () => {
        expect(usageColor("context", 30)).toBe(ok);
        expect(usageColor("context", 31)).toBe(warning);
        expect(usageColor("context", 70)).toBe(warning);
        expect(usageColor("context", 71)).toBe(critical);
    });

    test("grades each limit ok up to 50%, warning above 50%, critical above 80%", () => {
        for (const kind of ["fiveHour", "sevenDay", "spend"] as const) {
            expect(usageColor(kind, 50)).toBe(ok);
            expect(usageColor(kind, 51)).toBe(warning);
            expect(usageColor(kind, 80)).toBe(warning);
            expect(usageColor(kind, 81)).toBe(critical);
        }
    });

    test("grades the rounded figure the bar shows", () => {
        expect(usageColor("context", 30.6)).toBe(warning);
    });
});

describe("waitFraction", () => {
    const window = 5 * 3600;

    test("is 0 when the pace lasts until the reset", () => {
        // 50% used with half the window gone: exactly on pace.
        expect(waitFraction(window, 50, window / 2)).toBe(0);
        expect(waitFraction(window, 10, window / 2)).toBe(0);
    });

    test("is 0 when 0% is used, or before the window has opened", () => {
        expect(waitFraction(window, 0, window / 2)).toBe(0);
        expect(waitFraction(window, 30, window)).toBe(0);
    });

    test("is the time between running out and the reset, over the window", () => {
        // 80% used with 40% of the window gone: out in another 10% of it,
        // leaving 50% to wait.
        const wait = waitFraction(window, 80, window * 0.6);
        expect(Math.round(wait * 100)).toBe(50);
    });

    test("is all the time left once the limit is hit", () => {
        expect(waitFraction(window, 100, window * 0.25)).toBe(0.25);
    });

    test("is the whole window when the limit is hit as the window opens", () => {
        expect(waitFraction(window, 100, window)).toBe(1);
    });

    test("is 0 past the reset time", () => {
        expect(waitFraction(window, 100, -5)).toBe(0);
    });
});

describe("resetColor", () => {
    const { ok, warning, critical } = TEXT_COLORS.severity;
    const window = 5 * 3600;

    test("is ok when on pace to last until the reset", () => {
        expect(resetColor("fiveHour", 40, window / 2)).toBe(ok);
    });

    test("is warning when the wait would pass 20% of the window", () => {
        // 70% used half way in: out in another 21% of the window, leaving 29%
        // to wait.
        expect(resetColor("fiveHour", 70, window * 0.5)).toBe(warning);
    });

    test("is critical when the wait would pass 50% of the window", () => {
        expect(resetColor("fiveHour", 85, window * 0.6)).toBe(critical);
        expect(resetColor("fiveHour", 90, window * 0.8)).toBe(critical);
    });

    test("measures the seven day window in days", () => {
        const week = 7 * 86400;
        expect(resetColor("sevenDay", 10, week * 0.5)).toBe(ok);
        expect(resetColor("sevenDay", 100, week * 0.8)).toBe(critical);
        // 3 of the 7 days left is a 43% wait; it would be 60% on a 5 day
        // window.
        expect(resetColor("sevenDay", 100, 3 * 86400)).toBe(warning);
    });

    test("changes level only past 20% and 50% of the window, for each window", () => {
        // At 50% used the wait is (2 * secsLeft - window) / window, so these
        // sit exactly on 20% and 50% of the window, and one second past each.
        const windows = { fiveHour: 5 * 3600, sevenDay: 7 * 86400 } as const;

        for (const [kind, secs] of Object.entries(windows) as [
            keyof typeof windows,
            number,
        ][]) {
            const percentUsed = 50;
            const at20 = secs * 0.6;
            const at50 = secs * 0.75;

            expect(resetColor(kind, percentUsed, at20)).toBe(ok);
            expect(resetColor(kind, percentUsed, at20 + 1)).toBe(warning);
            expect(resetColor(kind, percentUsed, at50)).toBe(warning);
            expect(resetColor(kind, percentUsed, at50 + 1)).toBe(critical);
        }
    });

    test("keeps the colour of the percentage used where the window length is unknown", () => {
        expect(resetColor("spend", 90, 10 * 3600)).toBe(critical);
        expect(resetColor("spend", 10, 10 * 3600)).toBe(ok);
    });
});

describe("renderStatusBar", () => {
    test("draws only the engine's line until the first refresh", async ($, on) => {
        const engine = new TestEngine($, on);

        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).isEmpty()).toBe(true);
        expect((await view.workspaceRow()).isEmpty()).toBe(true);
        // Not drawn at all, not drawn empty.
        expect(await view.findAll({ key: "claude-row" })).toHaveLength(0);
        expect(await view.findAll({ key: "workspace-row" })).toHaveLength(0);

        await engine.startSession();
        await engine.settle();
        const claude = (await view.claudeRow()).text();
        const workspace = (await view.workspaceRow()).text();
        expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%");
        expect(workspace).toBe("📁 /work/repo  •  🌿 main");
    });

    test("draws both rows, the Claude one empty, when nothing from Claude can be read", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.model.onNextCall(new Deny("model is not available"));
        engine.claude.usage.onNextCall(new Deny("usage is not available"));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect((await view.claudeRow()).text()).toBe("");
        expect((await view.workspaceRow()).text()).toBe(
            "📁 /work/repo  •  🌿 main",
        );
        // Drawn with nothing in it, not left out.
        const claudeRow = await view.findAll({ key: "claude-row" });
        expect(claudeRow).toHaveLength(1);
        expect(claudeRow[0]?.children).toEqual([]);
    });

    test("draws both rows, the workspace one empty, when the working directory cannot be read", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.cwd.onNextCall(new Deny("cwd is not available"));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");
        expect((await view.workspaceRow()).text()).toBe("");
        // Drawn with nothing in it, not left out.
        const workspaceRow = await view.findAll({ key: "workspace-row" });
        expect(workspaceRow).toHaveLength(1);
        expect(workspaceRow[0]?.children).toEqual([]);
    });

    test("colours the context tokens with the percentage", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                contextPercent: 42,
                contextTokens: 84_000,
            }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect(await view.colorOf("claude-row:claude-context:used")).toBe(
            TEXT_COLORS.severity.warning,
        );
    });

    // A limit on pace with a reset time, one with no reset time, and one past
    // its limit.
    const usageWithLimits = {
        rateLimits: [
            {
                kind: "five_hour",
                percentUsed: 42.4,
                resetsAt: timeFromNow(3 * 3600 + 10 * 60),
            },
            {
                kind: "seven_day",
                percentUsed: 7,
            },
            {
                kind: "spend_limit",
                percentUsed: 120,
            },
        ],
    };
    const { ok, warning, critical } = TEXT_COLORS.severity;

    for (const [name, key, color] of [
        ["the model", "claude-row:claude-model:name", TEXT_COLORS.claude.model],
        ["the context", "claude-row:claude-context:used", warning],
        [
            "the five hour percentage",
            "claude-row:claude-usage-five-hour:percent",
            ok,
        ],
        // 42% used 1h 50m in is out after another 2h 29m, leaving 41m (14% of
        // the window) to wait.
        ["the five hour reset", "claude-row:claude-usage-five-hour:reset", ok],
        [
            "the seven day percentage",
            "claude-row:claude-usage-seven-day:percent",
            ok,
        ],
        [
            "the spend percentage",
            "claude-row:claude-usage-spend:percent",
            critical,
        ],
        [
            "the working directory",
            "workspace-row:workspace-cwd:path",
            TEXT_COLORS.cwd,
        ],
        ["the git ref", "workspace-row:git-ref:name", TEXT_COLORS.git.ref],
        [
            "the separator between sections",
            "workspace-row:workspace-cwd:separator",
            TEXT_COLORS.separator,
        ],
    ] as const) {
        test(`colours ${name}`, async ($, on) => {
            const engine = new TestEngine($, on);
            engine.claude.usage.onNextCall(new Response(usageWithLimits));

            await engine.startSession();
            await engine.settle();
            const view = await engine.mountStatusBar();

            expect(await view.colorOf(key)).toBe(color);
        });
    }

    test("colours the git changes apart from the ref", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head main\n? new.ts" }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect(await view.colorOf("workspace-row:git-changes:counts")).toBe(
            TEXT_COLORS.git.changes,
        );
        expect(await view.colorOf("workspace-row:git-ref:name")).toBe(
            TEXT_COLORS.git.ref,
        );
    });

    test("colours the cost", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ costUsd: 1.5 }));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        expect(await view.colorOf("claude-row:claude-cost:usd")).toBe(
            TEXT_COLORS.claude.cost,
        );
    });

    test("wraps each row between its sections", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        for (const [key, sections] of [
            ["claude-row", ["claude-model", "claude-context"]],
            ["workspace-row", ["workspace-cwd", "git-ref"]],
        ] as const) {
            const found = await view.findAll({ key });

            expect(found, key).toHaveLength(1);
            expect(found[0]?.props, key).toMatchObject({
                flexDirection: "row",
                flexWrap: "wrap",
            });
            // The row's own children are its sections, so a line breaks
            // between them and never inside one.
            expect(found[0]?.children, key).toMatchObject(
                sections.map((section) => ({
                    props: { key: `${key}:${section}` },
                })),
            );
        }
    });

    test("truncates a section item that is wider than the row, not its section or the row", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        for (const key of [
            "claude-row:claude-model:name",
            "claude-row:claude-context:used",
            "workspace-row:workspace-cwd:path",
            "workspace-row:git-ref:name",
        ]) {
            const found = await view.findAll({ key });

            expect(found, key).toHaveLength(1);
            expect(found[0]?.children[0], key).toMatchObject({
                type: "Text",
                props: { wrap: "truncate-end" },
            });
        }

        // Those items are all that truncate: no Text around a section or a row,
        // and no separator, is cut short instead.
        const truncating = (await view.findAll({ type: "Text" })).filter(
            (element) => element.props["wrap"] === "truncate-end",
        );

        expect(truncating).toHaveLength(4);
    });

    test("keeps a separator whole when its section is truncated, and ends a row without one", async ($, on) => {
        const engine = new TestEngine($, on);

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        for (const key of [
            "claude-row:claude-model:separator",
            "workspace-row:workspace-cwd:separator",
        ]) {
            const found = await view.findAll({ key });

            expect(found, key).toHaveLength(1);
            expect(found[0]?.props["flexShrink"], key).toBe(0);
        }

        for (const key of [
            "claude-row:claude-context:separator",
            "workspace-row:git-ref:separator",
        ]) {
            expect(await view.findAll({ key }), key).toHaveLength(0);
        }
    });

    test("keeps the gap between the items of a section whole", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                rateLimits: [
                    {
                        kind: "five_hour",
                        percentUsed: 42,
                        resetsAt: timeFromNow(3600),
                    },
                ],
            }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();

        const gaps = await view.findAll({
            key: "claude-row:claude-usage-five-hour:reset:separator",
        });
        const firstItemGaps = await view.findAll({
            key: "claude-row:claude-usage-five-hour:percent:separator",
        });

        expect(gaps).toHaveLength(1);
        expect(gaps[0]?.props["flexShrink"]).toBe(0);
        // The gap goes between two items, so the first has none before it.
        expect(firstItemGaps).toHaveLength(0);
    });

    test("gives every keyed element a key that no other has", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                rateLimits: ["five_hour", "seven_day", "spend_limit"].map(
                    (kind) => ({
                        kind,
                        percentUsed: 10,
                        resetsAt: timeFromNow(3600),
                    }),
                ),
            }),
        );
        engine.workspace.git.onNextCall(
            new Response({ stdout: "# branch.head main\n? new.ts" }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        const repeated = (all: string[]): string[] =>
            all.filter((key, i) => all.indexOf(key) !== i);

        // Every section, and the gap before each reset, is drawn here.
        const withLimits = await keysOf(view);
        for (const key of [
            "claude-row:claude-usage-spend:reset",
            "claude-row:claude-usage-spend:reset:separator",
            "workspace-row:git-changes:counts",
        ]) {
            expect(withLimits).toContain(key);
        }
        expect(repeated(withLimits)).toEqual([]);

        // The cost is only drawn without a rate limit.
        engine.claude.usage.onNextCall(new Response({ costUsd: 1.5 }));
        await engine.measureSession();
        await engine.settle();
        const withCost = await keysOf(view);
        expect(withCost).toContain("claude-row:claude-cost:usd");
        expect(repeated(withCost)).toEqual([]);
    });

    test("keeps the keys the same as the figures change", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                contextPercent: 42,
                rateLimits: [
                    {
                        kind: "five_hour",
                        percentUsed: 42,
                        resetsAt: timeFromNow(3 * 3600),
                    },
                ],
            }),
        );

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        const keysBefore = await keysOf(view);
        const textBefore = (await view.claudeRow()).text();

        engine.claude.usage.onNextCall(
            new Response({
                contextPercent: 80,
                rateLimits: [
                    {
                        kind: "five_hour",
                        percentUsed: 90,
                        resetsAt: timeFromNow(1800),
                    },
                ],
            }),
        );
        await engine.measureSession();
        await engine.settle();

        // The figures did change, or this proves nothing.
        expect((await view.claudeRow()).text()).not.toBe(textBefore);
        expect(await keysOf(view)).toEqual(keysBefore);
    });

    test("leaves out the cost once a rate limit is reported, whichever window it is", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ costUsd: 1.5 }));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe(
            "🤖 Opus 4.5  •  🧠 42%  •  💰 $1.50",
        );

        for (const kind of ["five_hour", "seven_day", "spend_limit"]) {
            engine.claude.usage.onNextCall(
                new Response({
                    costUsd: 1.5,
                    rateLimits: [{ kind, percentUsed: 10 }],
                }),
            );
            await engine.measureSession();
            await engine.settle();

            expect((await view.claudeRow()).text()).not.toContain("💰");
        }
    });

    test("shows the session cost in dollars and cents when there are no rate limits", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ costUsd: 1.234 }));

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%  •  💰 $1.23");
    });

    test("leaves out a cost of nothing, which is all a subscription shows before its first response", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ costUsd: 0 }));

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%");
    });

    test("leaves out a cost that rounds to $0.00, and shows one that rounds to a cent", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ costUsd: 0.004 }));

        await engine.startSession();
        await engine.settle();
        const view = await engine.mountStatusBar();
        expect((await view.claudeRow()).text()).toBe("🤖 Opus 4.5  •  🧠 42%");

        engine.claude.usage.onNextCall(new Response({ costUsd: 0.005 }));
        await engine.measureSession();
        await engine.settle();

        expect((await view.claudeRow()).text()).toBe(
            "🤖 Opus 4.5  •  🧠 42%  •  💰 $0.01",
        );
    });

    test("shows 0% context", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(new Response({ contextPercent: 0 }));

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("🤖 Opus 4.5  •  🧠 0%");
    });

    test("leaves out the model and context when the engine has none", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.model.onNextCall(new Response(""));
        engine.claude.usage.onNextCall(
            new Response({ contextPercent: undefined }),
        );

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("");
    });

    test("leaves out the context, and its separator, when the engine has no percentage", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                contextPercent: undefined,
                rateLimits: [{ kind: "five_hour", percentUsed: 10 }],
            }),
        );

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("🤖 Opus 4.5  •  🕐 5h 10%");
    });

    test("still shows windows at 100% used or past their reset time", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                rateLimits: [
                    {
                        kind: "five_hour",
                        percentUsed: 100,
                        resetsAt: timeFromNow(600),
                    },
                    {
                        kind: "seven_day",
                        percentUsed: 100.4,
                        resetsAt: timeFromNow(-5),
                    },
                ],
            }),
        );

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe(
            "🤖 Opus 4.5  •  🧠 42%  •  🕐 5h 100%  🔄 10m  •  📅 7d 100%  🔄 now",
        );
    });

    test("shows a window with 0% used", async ($, on) => {
        const engine = new TestEngine($, on);
        engine.claude.usage.onNextCall(
            new Response({
                rateLimits: [{ kind: "five_hour", percentUsed: 0 }],
            }),
        );

        await engine.startSession();
        await engine.settle();
        const claude = (
            await (await engine.mountStatusBar()).claudeRow()
        ).text();

        expect(claude).toBe("🤖 Opus 4.5  •  🧠 42%  •  🕐 5h 0%");
    });
});
