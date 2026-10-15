import { type FoundElement, type Mounted } from "claude-code/testing";

// A text leaf as drawn: its text, with the colour it was given, if any.
export interface ViewLeaf {
    text: string;
    color?: string | undefined;
}

interface DrawnElement {
    type?: string;
    props?: { color?: string };
    children?: unknown[];
}

const isElement = (node: unknown): node is DrawnElement =>
    typeof node === "object" && node !== null;

// Reads what a mounted drawing shows. The drawing is the element tree, not a
// painted screen.
export class BaseView {
    constructor(
        protected readonly mounted: Mounted<"terminal", "PromptHint">,
    ) {}

    findAll(
        query: Parameters<typeof this.mounted.findAll>[0],
    ): Promise<FoundElement[]> {
        return this.mounted.findAll(query);
    }

    protected textOf(node: unknown): string {
        if (typeof node === "string") {
            return node;
        }
        if (isElement(node) && Array.isArray(node.children)) {
            return node.children.map((child) => this.textOf(child)).join("");
        }
        return "";
    }

    // The Text elements that hold plain text, in drawn order. A Text that
    // wraps other elements only groups them, so it is not a leaf itself.
    protected leavesOf(node: unknown): ViewLeaf[] {
        if (!isElement(node)) {
            return [];
        }

        const children = node.children ?? [];
        if (
            node.type === "Text" &&
            children.every((c) => typeof c === "string")
        ) {
            return [{ text: this.textOf(node), color: node.props?.color }];
        }
        return children.flatMap((child) => this.leavesOf(child));
    }
}
