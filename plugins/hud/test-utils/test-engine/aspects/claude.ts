import type { On, SessionRateLimit } from "claude-code";
import { AnswerEngine } from "./answer-engine";
import { Deny, Response } from "./answer-engine/answer";
import type { BaseAspect } from "./base-aspect";

// The figures a usage read can answer with, apart from what a test leaves out.
// A figure set to `undefined` is one the engine does not report, which differs
// from a figure left out, because that keeps its default.
export interface UsageFigures {
    contextPercent?: number | undefined;
    contextTokens?: number | undefined;
    costUsd?: number | undefined;
    rateLimits?: SessionRateLimit[] | undefined;
}

const DEFAULT_USAGE: UsageFigures = { contextPercent: 42, rateLimits: [] };

// What the engine says about Claude: the model and the usage figures.
export class Claude implements BaseAspect {
    readonly model = new AnswerEngine<void, string>(
        () => new Response("claude-opus-4-5"),
    );
    // Merged over the defaults, so a test names only what differs.
    readonly usage = new AnswerEngine<void, UsageFigures>(
        () => new Response({}),
    );

    register(on: On): void {
        on("session.model", async () => {
            const reply = await this.model.answer();
            return reply instanceof Deny
                ? { deny: reply.reason }
                : { value: reply.value };
        });
        on("session.usage", async () => {
            const reply = await this.usage.answer();
            if (reply instanceof Deny) {
                return { deny: reply.reason };
            }

            const { contextPercent, contextTokens, costUsd, rateLimits } = {
                ...DEFAULT_USAGE,
                ...reply.value,
            };
            return {
                value: {
                    startedAt: 0,
                    context: {
                        window: 200_000,
                        ...(contextPercent !== undefined && {
                            percent: contextPercent,
                        }),
                        ...(contextTokens !== undefined && {
                            tokens: contextTokens,
                        }),
                    },
                    rateLimits: rateLimits ?? [],
                    ...(costUsd !== undefined && { cost: { usd: costUsd } }),
                },
            };
        });
    }
}
