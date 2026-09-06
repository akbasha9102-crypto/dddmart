import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime } from "@/lib/utils";

describe("formatTime", () => {
  it("does not zero-pad a single-digit hour", () => {
    expect(formatTime(new Date("2026-09-06T05:40:00"))).toBe("٥:٤٠ ص");
  });

  it("still zero-pads minutes below 10", () => {
    expect(formatTime(new Date("2026-09-06T17:05:00"))).toBe("٥:٠٥ م");
  });

  it("leaves a double-digit hour unchanged", () => {
    expect(formatTime(new Date("2026-09-06T10:05:00"))).toBe("١٠:٠٥ ص");
  });
});

describe("formatDateTime", () => {
  it("does not zero-pad a single-digit hour", () => {
    expect(formatDateTime(new Date("2026-09-06T05:40:00"))).toBe("٦ أيلول ٢٠٢٦، ٥:٤٠ ص");
  });
});
