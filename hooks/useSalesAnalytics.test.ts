import { describe, expect, it } from "vitest";
import { resolveRange } from "./useSalesAnalytics";

describe("resolveRange", () => {
  it("extends a custom range's end date to end-of-day and start date to start-of-day", () => {
    const { startDate, endDate } = resolveRange({
      kind: "custom",
      startDate: new Date("2026-09-01T09:00:00.000"),
      endDate: new Date("2026-09-07T00:00:00.000"),
    });

    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);

    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(endDate.getSeconds()).toBe(59);
    expect(endDate.getMilliseconds()).toBe(999);
    expect(endDate.getDate()).toBe(7);

    expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
  });

  it("does not mutate the Date objects stored on the input range", () => {
    const startDate = new Date("2026-09-01T09:00:00.000");
    const endDate = new Date("2026-09-07T00:00:00.000");
    const originalStart = startDate.getTime();
    const originalEnd = endDate.getTime();

    resolveRange({ kind: "custom", startDate, endDate });

    expect(startDate.getTime()).toBe(originalStart);
    expect(endDate.getTime()).toBe(originalEnd);
  });

  it("returns a preset range spanning N full calendar days ending today at end-of-day", () => {
    const { startDate, endDate } = resolveRange({ kind: "preset", days: 7 });

    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);

    const daySpanMs = endDate.getTime() - startDate.getTime();
    const approxDays = daySpanMs / (1000 * 60 * 60 * 24);
    expect(approxDays).toBeGreaterThan(6);
    expect(approxDays).toBeLessThan(7);
  });
});
