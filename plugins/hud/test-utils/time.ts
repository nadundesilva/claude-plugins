export const NOW = Date.parse("2026-01-01T00:00:00Z");
export const MINUTE = 60_000;

export const timeFromNow = (secs: number): string =>
    new Date(NOW + secs * 1000).toISOString();
