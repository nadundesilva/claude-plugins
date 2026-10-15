import type { Register } from "claude-code";
import { REFRESH_MS, refresh, renderHud } from "./hud";

export const register: Register = (on) => {
    on("session.start", async ($, e, next) => {
        $.clock.every(REFRESH_MS, () => refresh($));
        await refresh($);
        return next(e);
    });

    on("session.measure", async ($, e, next) => {
        await refresh($);
        return next(e);
    });

    on("turn.complete", async ($, e, next) => {
        await refresh($);
        return next(e);
    });

    on("ui.render", { component: "PromptHint" }, async ($, e, next) =>
        renderHud($, e, await next(e)),
    );
};
