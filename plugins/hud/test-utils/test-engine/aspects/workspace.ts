import type { On, ProcessRunResult } from "claude-code";
import { AnswerEngine } from "./answer-engine";
import { Deny, Response } from "./answer-engine/answer";
import type { BaseAspect } from "./base-aspect";

// What a git command prints and how it ends. A command exits 0 unless given a
// code, and its output is cut off only when `truncated`.
export interface GitOutput {
    stdout: string;
    truncated?: boolean;
    exitCode?: number;
}

// As outside a repo: no output, and an exit code that says so.
const NOT_A_REPO: GitOutput = { stdout: "", exitCode: 128 };

interface GitRun {
    argv: string[];
    cwd?: string | undefined;
}

// Answers a git command nobody lined up an answer for: a status on a branch,
// and no tag or sha, as a detached HEAD in a repo with neither would have.
function defaultGitOutput({ argv }: GitRun): Response<GitOutput> {
    return new Response(
        argv[2] === "status" ? { stdout: "# branch.head main" } : NOT_A_REPO,
    );
}

// What the engine says about the workspace: the working directory, and git
// run in it.
export class Workspace implements BaseAspect {
    readonly cwd = new AnswerEngine<void, string>(
        () => new Response("/work/repo"),
    );
    // Every git command the plugin ran, in call order, whatever its
    // subcommand, so answers are lined up in the order the commands run. A
    // refused answer is a git that cannot run, as on a timeout.
    readonly git = new AnswerEngine<GitRun, GitOutput>(defaultGitOutput);

    register(on: On): void {
        on("session.cwd", async () => {
            const reply = await this.cwd.answer();
            return reply instanceof Deny
                ? { deny: reply.reason }
                : { value: reply.value };
        });
        on("process.run", async (_$, e) => {
            if (e.argv[0] === "git") {
                return this.runGitCommand({
                    argv: [...e.argv],
                    cwd: e.init?.cwd,
                });
            } else {
                // Only git is answered; any other program is left unanswered.
                throw new Error(`no answer for ${e.argv.join(" ")}`);
            }
        });
    }

    private async runGitCommand(
        run: GitRun,
    ): Promise<{ deny: string } | { value: ProcessRunResult }> {
        const reply = await this.git.answer(run);
        if (reply instanceof Deny) {
            return { deny: reply.reason };
        }

        const { stdout, exitCode = 0, truncated = false } = reply.value;
        return {
            value: {
                exitCode,
                // Git ends its output with a newline.
                stdout: stdout && `${stdout}\n`,
                stderr: "",
                isStdoutTruncated: truncated,
                isStderrTruncated: false,
            },
        };
    }
}
