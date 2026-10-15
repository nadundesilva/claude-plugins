import type { Register, Timer } from "claude-code";
import { refreshClaude, refreshWorkspace } from "./data";
import { renderStatusBar } from "./render";

const REFRESH_MS = 60_000;

// The tools that can change the working tree or the git state.
export const WORKSPACE_CHANGING_TOOLS = [
    "Bash",
    "Edit",
    "Write",
    "NotebookEdit",
] as const;

// No hook waits for a refresh: it would hold up the session start, the tool
// call or the turn behind up to three git commands.
export const register: Register = (on) => {
    let refreshTimer: Timer | undefined;

    on("session.start", async ($, e, next) => {
        // session.start fires again on an enable, a worker respawn or a reload.
        refreshTimer?.cancel();
        refreshTimer = $.clock.every(REFRESH_MS, () =>
            Promise.all([refreshClaude($), refreshWorkspace($)]),
        );

        void refreshClaude($);
        void refreshWorkspace($);
        return next(e);
    });

    // /clear, /resume and /branch reset what is kept in $.state, and
    // session.start does not fire again after them. Compaction does not reset
    // it.
    on("classic.SessionStart", async ($, e, next) => {
        if (
            e.source === "clear" ||
            e.source === "resume" ||
            e.source === "fork"
        ) {
            void refreshClaude($);
            void refreshWorkspace($);
        }
        return next(e);
    });

    // Anything that moves the session's directory, such as entering or leaving
    // a worktree, which also switches branch.
    on("classic.CwdChanged", async ($, e, next) => {
        void refreshWorkspace($);
        return next(e);
    });

    on("session.measure", async ($, e, next) => {
        void refreshClaude($);
        return next(e);
    });

    on("tool.call", { tool: WORKSPACE_CHANGING_TOOLS }, async ($, e, next) => {
        // An aborted call may already have changed files.
        try {
            return await next(e);
        } finally {
            void refreshWorkspace($);
        }
    });

    on("ui.render", { component: "PromptHint" }, async ($, e, next) =>
        renderStatusBar($, e, await next(e)),
    );
};
