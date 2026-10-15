import {
    read,
    type EngineInterface,
    type RenderElement,
    type RenderInput,
} from "claude-code";
import {
    type ClaudeState,
    type GitChanges,
    type RateLimit,
    type RateLimitKind,
    type WorkspaceState,
} from "./data";

export const TEXT_COLORS = {
    claude: {
        model: "#5fafaf",
        cost: "#af87af",
    },

    severity: {
        ok: "#87af87",
        warning: "#d7af5f",
        critical: "#d75f5f",
    },

    cwd: "#87afd7",
    git: {
        changes: "#af87d7",
        ref: "#afafd7",
    },
    separator: "#585858",
};

const ICONS = {
    cwd: "📁",
    claude: {
        model: "🤖",
        context: "🧠",
        cost: "💰",

        rateLimit: {
            fiveHour: "🕐",
            sevenDay: "📅",
            spend: "💳",

            reset: "🔄",
        },
    },
    git: {
        changes: {
            dirty: "📝",
            ahead: "⏫",
            behind: "⏬",
        },
        ref: {
            branch: "🌿",
            tag: "🔖",
            sha: "📌",
        },
    },
};

const RATE_LIMIT_LABELS = {
    fiveHour: "5h",
    sevenDay: "7d",
    spend: "spend",
};

const WINDOW_SECS: Partial<Record<RateLimitKind, number>> = {
    fiveHour: 5 * 3600,
    sevenDay: 7 * 86400,
};

const SEPARATOR = "  •  ";
const INNER_SEPARATOR = "  ";

interface SectionItem {
    id: string;
    color: string;
    text: string;
}

interface Section {
    id: string;
    items: SectionItem[];
}

type UsageKind = "context" | RateLimitKind;

// In percent used. Context is stricter than the limits: it is the one figure
// you can act on early, by compacting.
const USAGE_THRESHOLDS: Record<
    UsageKind,
    { warningAbove: number; criticalAbove: number }
> = {
    context: { warningAbove: 30, criticalAbove: 70 },
    fiveHour: { warningAbove: 50, criticalAbove: 80 },
    sevenDay: { warningAbove: 50, criticalAbove: 80 },
    spend: { warningAbove: 50, criticalAbove: 80 },
};

// As a share of the window spent waiting for the reset.
const WAIT_THRESHOLDS = { warningAbove: 0.2, criticalAbove: 0.5 };

// Higher is worse: context and rate limits fill up.
export const usageColor = (kind: UsageKind, percentUsed: number): string => {
    const { warningAbove, criticalAbove } = USAGE_THRESHOLDS[kind];
    const percent = Math.round(percentUsed);
    if (percent > criticalAbove) {
        return TEXT_COLORS.severity.critical;
    }
    return percent > warningAbove
        ? TEXT_COLORS.severity.warning
        : TEXT_COLORS.severity.ok;
};

// How long you would sit locked out before the reset if you kept the pace you
// have held since the window opened, as a share of the window. 0 when the
// window outlasts you.
export const waitFraction = (
    windowSecs: number,
    percentUsed: number,
    secsUntilReset: number,
): number => {
    const secsLeft = Math.max(secsUntilReset, 0);
    const secsElapsed = windowSecs - secsLeft;
    if (percentUsed >= 100) {
        return secsLeft / windowSecs;
    }
    if (percentUsed <= 0 || secsElapsed <= 0) {
        return 0;
    }

    const secsUntilExhausted =
        ((100 - percentUsed) / percentUsed) * secsElapsed;
    return Math.max(secsLeft - secsUntilExhausted, 0) / windowSecs;
};

// A window with no known length (spend) has no pace to judge, so its reset
// keeps the colour of its percentage used.
export const resetColor = (
    kind: RateLimitKind,
    percentUsed: number,
    secsUntilReset: number,
): string => {
    const windowSecs = WINDOW_SECS[kind];
    if (windowSecs === undefined) {
        return usageColor(kind, percentUsed);
    }

    const wait = waitFraction(windowSecs, percentUsed, secsUntilReset);
    if (wait > WAIT_THRESHOLDS.criticalAbove) {
        return TEXT_COLORS.severity.critical;
    }
    return wait > WAIT_THRESHOLDS.warningAbove
        ? TEXT_COLORS.severity.warning
        : TEXT_COLORS.severity.ok;
};

// The optional `(?:^|\.)` prefix skips Bedrock's `us.anthropic.` /
// `anthropic.`. Current ids put the family first (claude-opus-4-5), old ones
// the version (claude-3-5-sonnet).
const CURRENT_MODEL_ID_FORMAT =
    /(?:^|\.)claude-([a-z]+)-(\d+)(?:-(\d{1,2})\b)?/;
const OLD_MODEL_ID_FORMAT = /(?:^|\.)claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)/;

export const formatModelName = (id: string): string => {
    const current = CURRENT_MODEL_ID_FORMAT.exec(id);
    const old = current ? undefined : OLD_MODEL_ID_FORMAT.exec(id);
    if (!current && !old) {
        return id;
    }

    const [family = "", major = "", minor] = current
        ? current.slice(1)
        : [old?.[3], old?.[1], old?.[2]];
    const name = family.charAt(0).toUpperCase() + family.slice(1);

    return `${name} ${major}${minor ? `.${minor}` : ""}`;
};

// Whole numbers from 10 up, one decimal below, so 84k and 1.2M but not 84.0k.
const roundScaledTokens = (value: number): number =>
    value < 10 ? Math.round(value * 10) / 10 : Math.round(value);

export const formatTokens = (tokens: number): string => {
    // 999_500 rounds to 1000k, so it takes the next unit.
    if (tokens >= 999_500) {
        return `${roundScaledTokens(tokens / 1_000_000)}M`;
    }
    return tokens >= 1000
        ? `${roundScaledTokens(tokens / 1000)}k`
        : String(tokens);
};

export const formatRemainingTime = (secs: number): string => {
    if (secs <= 0) {
        return "now";
    }

    const days = Math.floor(secs / 86400);
    const hrs = Math.floor((secs % 86400) / 3600);
    const mins = Math.floor((secs % 3600) / 60);

    if (days > 0) {
        return `${days}d ${hrs}h ${mins}m`;
    }
    if (hrs > 0) {
        return `${hrs}h ${mins}m`;
    }
    return mins > 0 ? `${mins}m` : "<1m";
};

export const rateLimitSectionItems = (
    kind: RateLimitKind,
    limit: RateLimit | undefined,
    now: number,
): SectionItem[] => {
    if (!limit) {
        return [];
    }

    const items: SectionItem[] = [
        {
            id: "percent",
            color: usageColor(kind, limit.percentUsed),
            text: `${ICONS.claude.rateLimit[kind]} ${RATE_LIMIT_LABELS[kind]} ${Math.round(limit.percentUsed)}%`,
        },
    ];
    if (limit.resetsAtMillis !== undefined) {
        const secsUntilReset = Math.floor((limit.resetsAtMillis - now) / 1000);
        items.push({
            id: "reset",
            color: resetColor(kind, limit.percentUsed, secsUntilReset),
            text: `${ICONS.claude.rateLimit.reset} ${formatRemainingTime(secsUntilReset)}`,
        });
    }
    return items;
};

export const formatContext = ({
    usedPercent,
    used,
    total,
}: ClaudeState["contextWindow"] & { usedPercent: number }): string => {
    const percentText = `${ICONS.claude.context} ${Math.round(usedPercent)}%`;
    return used === undefined
        ? percentText
        : `${percentText} (${formatTokens(used)}/${formatTokens(total)})`;
};

export const formatGitChanges = ({
    dirty,
    ahead,
    behind,
}: GitChanges): string =>
    [
        dirty?.value
            ? `${ICONS.git.changes.dirty} ${dirty.value}${dirty.truncated ? "+" : ""}`
            : "",
        ahead ? `${ICONS.git.changes.ahead} ${ahead}` : "",
        behind ? `${ICONS.git.changes.behind} ${behind}` : "",
    ]
        .filter(Boolean)
        .join(INNER_SEPARATOR);

const sectionsOfClaude = ({
    measuredAt,
    model,
    contextWindow,
    costUsd,
    rateLimit,
}: ClaudeState): Section[] => {
    // Off a subscription (API key, Bedrock, Vertex) there are no windows to
    // watch, so the cost is the only figure; on one it is only a notional
    // price. Before the first API response a subscription has no windows yet
    // either, so a cost of nothing is left out, or $0.00 would flash at
    // startup.
    const hasRateLimit = Object.values(rateLimit).some(Boolean);

    return [
        {
            id: "claude-model",
            items: model
                ? [
                      {
                          id: "name",
                          color: TEXT_COLORS.claude.model,
                          text: `${ICONS.claude.model} ${formatModelName(model)}`,
                      },
                  ]
                : [],
        },
        {
            id: "claude-context",
            items:
                contextWindow.usedPercent === undefined
                    ? []
                    : [
                          {
                              id: "used",
                              color: usageColor(
                                  "context",
                                  contextWindow.usedPercent,
                              ),
                              text: formatContext({
                                  ...contextWindow,
                                  usedPercent: contextWindow.usedPercent,
                              }),
                          },
                      ],
        },
        {
            id: "claude-cost",
            items:
                costUsd === undefined || costUsd < 0.005 || hasRateLimit
                    ? []
                    : [
                          {
                              id: "usd",
                              color: TEXT_COLORS.claude.cost,
                              text: `${ICONS.claude.cost} $${costUsd.toFixed(2)}`,
                          },
                      ],
        },
        {
            id: "claude-usage-five-hour",
            items: rateLimitSectionItems(
                "fiveHour",
                rateLimit.fiveHour,
                measuredAt,
            ),
        },
        {
            id: "claude-usage-seven-day",
            items: rateLimitSectionItems(
                "sevenDay",
                rateLimit.sevenDay,
                measuredAt,
            ),
        },
        {
            id: "claude-usage-spend",
            items: rateLimitSectionItems("spend", rateLimit.spend, measuredAt),
        },
    ];
};

const sectionsOfWorkspace = ({ cwd, git }: WorkspaceState): Section[] => {
    const changes = formatGitChanges(git);

    return [
        {
            id: "workspace-cwd",
            items: [
                {
                    id: "path",
                    color: TEXT_COLORS.cwd,
                    text: `${ICONS.cwd} ${cwd}`,
                },
            ],
        },
        {
            id: "git-ref",
            items: git.ref
                ? [
                      {
                          id: "name",
                          color: TEXT_COLORS.git.ref,
                          text: `${ICONS.git.ref[git.ref.kind]} ${git.ref.name}`,
                      },
                  ]
                : [],
        },
        {
            id: "git-changes",
            items: changes
                ? [
                      {
                          id: "counts",
                          color: TEXT_COLORS.git.changes,
                          text: changes,
                      },
                  ]
                : [],
        },
    ];
};

export async function renderStatusBar(
    $: EngineInterface,
    e: RenderInput<"PromptHint">,
    engine: RenderElement,
): Promise<RenderElement> {
    // Reading while drawing subscribes this drawing to both, so a refresh that
    // writes one redraws it.
    const [claude, workspace] = await Promise.all([
        read($, { plugin: "hud", key: "claude" } as const),
        read($, { plugin: "hud", key: "workspace" } as const),
    ]);
    if (!claude && !workspace) {
        return engine;
    }

    const { Box, Text } = $.ui.resolve(e);

    // A section with nothing to show is empty, and left out. Both rows are
    // drawn once either has data.
    const claudeSections: Section[] = claude ? sectionsOfClaude(claude) : [];
    const workspaceSections: Section[] = workspace
        ? sectionsOfWorkspace(workspace)
        : [];

    // A section is whole or on the next line: the row wraps between sections,
    // and only a section wider than the row is truncated. The separator trails
    // its section, outside the truncation, so a wrapped line ends in one rather
    // than the next starting with one.
    const renderRow = (row: string, sections: Section[]): RenderElement => {
        const rowId = `${row}-row`;
        const shown = sections.filter(({ items }) => items.length > 0);

        return (
            <Box key={rowId} flexDirection="row" flexWrap="wrap">
                {shown.map(({ id, items }, i) => (
                    <Box key={`${rowId}:${id}`}>
                        {items.flatMap(({ id: itemId, color, text }, j) => {
                            const key = `${rowId}:${id}:${itemId}`;

                            return [
                                j > 0 && (
                                    <Box
                                        key={`${key}:separator`}
                                        flexShrink={0}
                                    >
                                        <Text>{INNER_SEPARATOR}</Text>
                                    </Box>
                                ),
                                <Box key={key}>
                                    <Text wrap="truncate-end" color={color}>
                                        {text}
                                    </Text>
                                </Box>,
                            ];
                        })}
                        {i < shown.length - 1 && (
                            <Box
                                key={`${rowId}:${id}:separator`}
                                flexShrink={0}
                            >
                                <Text color={TEXT_COLORS.separator}>
                                    {SEPARATOR}
                                </Text>
                            </Box>
                        )}
                    </Box>
                ))}
            </Box>
        );
    };

    return (
        <Box flexDirection="column">
            {engine}
            {renderRow("claude", claudeSections)}
            {renderRow("workspace", workspaceSections)}
        </Box>
    );
}
