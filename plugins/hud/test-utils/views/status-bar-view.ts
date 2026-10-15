import { type FoundElement } from "claude-code/testing";
import { BaseView, type ViewLeaf } from "./base-view";

// One row of the status bar: the text leaves drawn in it, in order.
export class StatusBarRowView {
    constructor(private readonly leaves: ViewLeaf[]) {}

    // The row as it reads on screen, the leaves end to end.
    text(): string {
        return this.leaves.map(({ text }) => text).join("");
    }

    // Nothing is drawn in the row.
    isEmpty(): boolean {
        return this.leaves.length === 0;
    }
}

// The mounted prompt hint: the engine's own line with the status bar under it.
// The rows, sections and section items are found by their keys, built as the plugin
// builds them. A row the plugin does not draw is empty.
export class StatusBarView extends BaseView {
    claudeRow(): Promise<StatusBarRowView> {
        return this.rowKeyed("claude-row");
    }

    workspaceRow(): Promise<StatusBarRowView> {
        return this.rowKeyed("workspace-row");
    }

    // The colour of the section item or separator drawn under this key: the
    // `row:section:section-item` of a section item, or `row:section:separator` of the
    // one that trails a section. One that is not drawn exactly once is a
    // mistake in the test or the plugin.
    async colorOf(key: string): Promise<string | undefined> {
        const [leaf] = this.leavesOf(await this.findOne(key));
        if (!leaf) {
            throw new Error(`nothing is drawn in the element keyed "${key}"`);
        }
        return leaf.color;
    }

    private async rowKeyed(key: string): Promise<StatusBarRowView> {
        const [row] = await this.findAll({ key });
        return new StatusBarRowView(this.leavesOf(row));
    }

    private async findOne(key: string): Promise<FoundElement> {
        const found = await this.findAll({ key });
        const [element] = found;
        if (found.length !== 1 || !element) {
            throw new Error(
                `expected one element keyed "${key}", found ${found.length}`,
            );
        }
        return element;
    }
}
