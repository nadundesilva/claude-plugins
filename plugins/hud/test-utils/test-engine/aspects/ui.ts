import type { On } from "claude-code";
import { AnswerEngine } from "./answer-engine";
import { Response } from "./answer-engine/answer";
import type { BaseAspect } from "./base-aspect";

export const ENGINE_HINT = "? for shortcuts";

interface Log {
    text: string;
    to: string;
}

// The engine's own line, and what the plugin logged.
export class Ui implements BaseAspect {
    // Each line the plugin logged, and where it asked for it to go.
    readonly log = new AnswerEngine<Log, undefined>(
        () => new Response(undefined),
    );

    register(on: On): void {
        on("ui.render", () => ({
            type: "Text",
            props: {},
            children: [ENGINE_HINT],
        }));
        on("ui.log", async (_$, e) => {
            await this.log.answer({ text: e.text, to: e.to });
            return { value: undefined };
        });
    }
}
