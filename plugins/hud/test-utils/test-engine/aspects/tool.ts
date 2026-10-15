import type { On } from "claude-code";
import { AnswerEngine } from "./answer-engine";
import { Deny, Response } from "./answer-engine/answer";
import type { BaseAspect } from "./base-aspect";

// What the engine does with a tool call. A refused answer is a call that is
// rejected, as when it is aborted. Every call is recorded, aborted or not.
export class Tool implements BaseAspect {
    readonly call = new AnswerEngine<void, string>(() => new Response("ok"));

    register(on: On): void {
        on("tool.call", async () => {
            const reply = await this.call.answer();
            if (reply instanceof Deny) {
                throw new Error(reply.reason);
            }

            return { result: reply.value };
        });
    }
}
