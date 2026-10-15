import type {
    On,
    SessionMeasureResult,
    SessionStartResult,
    ToolCallResult,
} from "claude-code";
import { type Engine, mock } from "claude-code/testing";
import { NOW } from "../time";
import { StatusBarView } from "../views/status-bar-view";
import type { BaseAspect } from "./aspects/base-aspect";
import { Claude } from "./aspects/claude";
import { Tool } from "./aspects/tool";
import { ENGINE_HINT, Ui } from "./aspects/ui";
import { Workspace } from "./aspects/workspace";

export {
    DelayedResponse,
    Deny,
    Response,
} from "./aspects/answer-engine/answer";
export { ENGINE_HINT };

// One valid call for each tool that can change the working tree.
const WORKSPACE_CHANGING_CALLS = {
    Bash: { tool: "Bash", command: "touch a" },
    Edit: {
        tool: "Edit",
        file_path: "/work/repo/a",
        old_string: "a",
        new_string: "b",
    },
    Write: { tool: "Write", file_path: "/work/repo/a", content: "a" },
    NotebookEdit: {
        tool: "NotebookEdit",
        notebook_path: "/work/repo/a.ipynb",
        new_source: "a",
    },
} as const;

export const TESTED_WORKSPACE_TOOLS = Object.keys(
    WORKSPACE_CHANGING_CALLS,
) as (keyof typeof WORKSPACE_CHANGING_CALLS)[];

type SessionSource = Parameters<Engine["classic"]["SessionStart"]>[0]["source"];
type WorkspaceChangingTool = keyof typeof WORKSPACE_CHANGING_CALLS;

// The harness for a plugin test: the engine beneath the plugin, with a clock
// pinned at NOW, and the actions a session can perform. One object for each
// aspect of the engine (`claude`, `workspace`, `tool`, `ui`) lines up what the
// engine will answer and reports what the plugin asked for.
export class TestEngine {
    readonly claude = new Claude();
    readonly workspace = new Workspace();
    readonly tool = new Tool();
    readonly ui = new Ui();

    private readonly clock: ReturnType<typeof mock.clock>;

    // `on` stays public for the one-off hook a test registers beneath the
    // plugin.
    constructor(
        readonly $: Engine,
        readonly on: On,
    ) {
        this.clock = mock.clock(on, { now: NOW });

        const aspects: BaseAspect[] = [
            this.claude,
            this.workspace,
            this.tool,
            this.ui,
        ];
        aspects.forEach((aspect) => aspect.register(on));

        on("session.start", (_$, e) => ({ cwd: e.cwd }));
        on("session.measure", (_$, e) => ({ changed: e.changed }));
        on("classic.SessionStart", () => ({}));
        on("classic.CwdChanged", () => ({}));
    }

    startSession(): Promise<SessionStartResult> {
        return this.$.session.start({
            cwd: "/work/repo",
            surface: "terminal",
            isInteractive: true,
        });
    }

    // A session that starts without `session.start`, as /clear, /resume and
    // /branch (source "fork") leave it.
    startSessionFrom(
        source: SessionSource,
    ): ReturnType<Engine["classic"]["SessionStart"]> {
        return this.$.classic.SessionStart({ source });
    }

    // The plugin ignores the figures in the event and reads them again, so
    // these only satisfy the event's shape.
    measureSession(): Promise<SessionMeasureResult> {
        return this.$.session.measure({
            context: { window: 200_000, percent: 42 },
            rateLimits: [],
            changed: ["context"],
        });
    }

    changeWorkspace(
        tool: WorkspaceChangingTool,
    ): Promise<ToolCallResult<WorkspaceChangingTool>> {
        return this.$.tool.call(WORKSPACE_CHANGING_CALLS[tool]);
    }

    runBash(): Promise<ToolCallResult<WorkspaceChangingTool>> {
        return this.changeWorkspace("Bash");
    }

    readFile(): Promise<ToolCallResult<"Read">> {
        return this.$.tool.call({ tool: "Read", file_path: "/work/repo/a" });
    }

    // Lets the work the plugin started without awaiting finish, without moving
    // time.
    settle(): Promise<void> {
        return this.clock.settle();
    }

    advance(ms: number): Promise<void> {
        return this.clock.advance(ms);
    }

    async mountStatusBar(): Promise<StatusBarView> {
        return new StatusBarView(
            await this.$.ui.mount({
                plugin: "hud",
                surface: "terminal",
                component: "PromptHint",
                props: { isDraft: false, isWorking: false, hint: ENGINE_HINT },
            }),
        );
    }
}
