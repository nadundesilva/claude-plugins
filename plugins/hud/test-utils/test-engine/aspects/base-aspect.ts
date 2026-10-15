import type { On } from "claude-code";

// One aspect of the engine, answered by its own answer engines, which also record
// the calls the plugin makes to it.
export interface BaseAspect {
    register(on: On): void;
}
