import { describe, expect, test } from "claude-code/testing";
import { formatRemaining, modelName } from "../hooks/hud";

describe("modelName", () => {
    test("formats family, major and minor", () => {
        expect(modelName("claude-opus-4-7")).toBe("Opus 4.7");
    });

    test("omits a missing minor version", () => {
        expect(modelName("claude-fable-5")).toBe("Fable 5");
    });

    test("ignores a date suffix", () => {
        expect(modelName("claude-opus-4-20250514")).toBe("Opus 4");
        expect(modelName("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    });

    test("returns an unrecognised id unchanged", () => {
        expect(modelName("gpt-4")).toBe("gpt-4");
    });
});

describe("formatRemaining", () => {
    test("is 'now' once elapsed", () => {
        expect(formatRemaining(0)).toBe("now");
        expect(formatRemaining(-5)).toBe("now");
    });

    test("shows only the units that matter", () => {
        expect(formatRemaining(30)).toBe("<1m");
        expect(formatRemaining(90)).toBe("1m");
        expect(formatRemaining(3 * 3600 + 120)).toBe("3h 2m");
        expect(formatRemaining(2 * 86400 + 3600 + 60)).toBe("2d 1h 1m");
    });
});
