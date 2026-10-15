import type { EngineInterface, RenderElement, RenderInput } from "claude-code";

export const REFRESH_MS = 60_000;

// Row colors, as hex.
const COLORS = {
    cwd: "#87afd7",
    git: "#d7af5f",
    model: "#5fafaf",
    context: "#af87af",
    limits: "#d75f5f",
    separator: "#585858",
};

type Hud = {
    model: string;
    context?: number;
    fiveHour: string;
    sevenDay: string;
    cwd: string;
    ref: string;
};

let hud: Hud | undefined;

export const modelName = (id: string) => {
    const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2})\b)?/.exec(id);
    if (!match) return id;
    const [, family = "", major = "", minor] = match;
    const name = family.charAt(0).toUpperCase() + family.slice(1);
    return `${name} ${major}${minor ? `.${minor}` : ""}`;
};

export const formatRemaining = (secs: number) => {
    if (secs <= 0) return "now";
    const days = Math.floor(secs / 86400);
    const hrs = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    if (days > 0) return `${days}d ${hrs}h ${mins}m`;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return mins > 0 ? `${mins}m` : "<1m";
};

// Branch, else exact tag, else short sha.
async function gitRef($: EngineInterface, cwd: string) {
    const git = async (...args: string[]) => {
        try {
            const { exitCode, stdout } = await $.process.run(
                ["git", "--no-optional-locks", ...args],
                { cwd },
            );
            return exitCode === 0 ? stdout.trim() : "";
        } catch (error) {
            // A missing git binary or a timeout must not take the whole HUD down.
            $.ui.log(`git ${args[0]} failed: ${String(error)}`);
            return "";
        }
    };
    const branch = await git("symbolic-ref", "--short", "HEAD");
    if (branch) return `🌿 ${branch}`;
    const tag = await git("describe", "--exact-match", "--tags", "HEAD");
    if (tag) return `🏷️ ${tag}`;
    const sha = await git("rev-parse", "--short", "HEAD");
    return sha ? `📌 ${sha}` : "";
}

export async function refresh($: EngineInterface) {
    const [cwd, model, usage, now] = await Promise.all([
        $.session.cwd(),
        $.session.model(),
        $.session.usage(),
        $.clock.now(),
    ]);

    const rateLimit = (kind: string, label: string) => {
        const limit = usage.rateLimits.find((l) => l.kind === kind);
        if (!limit) return "";
        let text = `${label} ${Math.round(limit.percentUsed)}%`;
        if (limit.resetsAt) {
            const secs = Math.floor((Date.parse(limit.resetsAt) - now) / 1000);
            text += `  🔄 ${formatRemaining(secs)}`;
        }
        return text;
    };

    hud = {
        model: model ? modelName(model) : "",
        context: usage.context.percent,
        fiveHour: rateLimit("five_hour", "🕐 5h"),
        sevenDay: rateLimit("seven_day", "📅 7d"),
        cwd,
        ref: await gitRef($, cwd),
    };
    $.ui.invalidate("ui.render");
}

// The engine's own hint line stays as it is; the HUD adds two rows beneath it.
export function renderHud(
    $: EngineInterface,
    e: RenderInput<"PromptHint">,
    engine: RenderElement,
) {
    if (!hud) return engine;
    const { Box, Text } = $.ui.resolve(e);

    const claudeParts: [string, string][] = [
        [COLORS.model, hud.model && `🤖 ${hud.model}`],
        [
            COLORS.context,
            hud.context === undefined ? "" : `🧠 ${Math.round(hud.context)}%`,
        ],
        [COLORS.limits, hud.fiveHour],
        [COLORS.limits, hud.sevenDay],
    ];
    const claudeLine = claudeParts.filter(([, text]) => text);

    return (
        <Box flexDirection="column">
            {engine}
            <Text wrap="truncate-end">
                {claudeLine.map(([color, text], i) => (
                    <Text key={text}>
                        {i > 0 && (
                            <Text color={COLORS.separator}>{"  •  "}</Text>
                        )}
                        <Text color={color}>{text}</Text>
                    </Text>
                ))}
            </Text>
            <Text wrap="truncate-end">
                <Text color={COLORS.cwd}>{`📁 ${hud.cwd}`}</Text>
                {hud.ref && <Text color={COLORS.git}>{`  ${hud.ref}`}</Text>}
            </Text>
        </Box>
    );
}
