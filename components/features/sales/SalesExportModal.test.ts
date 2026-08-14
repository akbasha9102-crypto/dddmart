import { describe, expect, it } from "vitest";
import { toExportRange } from "./SalesExportModal";

describe("toExportRange", () => {
  it("extends a same-day range to the full calendar day (00:00:00.000 to 23:59:59.999)", () => {
    const { startDate, endDate } = toExportRange({ startDate: "2026-08-14", endDate: "2026-08-14" });

    expect(startDate.getHours()).toBe(0);
    expect(startDate.getMinutes()).toBe(0);
    expect(startDate.getSeconds()).toBe(0);
    expect(startDate.getMilliseconds()).toBe(0);

    expect(endDate.getHours()).toBe(23);
    expect(endDate.getMinutes()).toBe(59);
    expect(endDate.getSeconds()).toBe(59);
    expect(endDate.getMilliseconds()).toBe(999);

    // A same-day range must not collapse to a zero-width query window —
    // this is the exact bug being fixed (see git history for context).
    expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
  });

  it("preserves the calendar date for start and end", () => {
    const { startDate, endDate } = toExportRange({ startDate: "2026-08-01", endDate: "2026-08-14" });

    expect(startDate.getDate()).toBe(1);
    expect(endDate.getDate()).toBe(14);
  });
});
