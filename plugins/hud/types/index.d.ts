declare module "claude-code" {
    interface PluginState {
        hud: {
            claude: {
                measuredAt: number;

                model?: string;

                contextWindow: {
                    usedPercent?: number;
                    used?: number;
                    total: number;
                };
                costUsd?: number;

                rateLimit: Partial<
                    Record<
                        "fiveHour" | "sevenDay" | "spend",
                        { percentUsed: number; resetsAtMillis?: number }
                    >
                >;
            };

            workspace: {
                cwd: string;
                git: {
                    ref?: { kind: "branch" | "tag" | "sha"; name: string };
                    dirty?: { value: number; truncated: boolean };
                    ahead?: number;
                    behind?: number;
                };
            };
        };
    }
}
