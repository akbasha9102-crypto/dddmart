import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, roundMoney, roundQuantity } from "@/lib/utils";

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

describe("roundMoney", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundMoney(12.345)).toBe(12.35);
    expect(roundMoney(12.344)).toBe(12.34);
  });

  it("avoids the classic JS binary-float rounding glitch", () => {
    // Math.round(1.005 * 100) / 100 naively evaluates to 1 in plain JS
    // because 1.005 is not exactly representable in binary floating point.
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("leaves an already-2-decimal value unchanged", () => {
    expect(roundMoney(42.5)).toBe(42.5);
  });

  it("handles a fractional-quantity line total (the actual bug this fixes)", () => {
    // 1.257 كغم * 3450.75 د.ع/كغم = 4337.59... — must match what
    // create_sale_atomic's round(v_unit_price * v_quantity, 2) computes.
    expect(roundMoney(1.257 * 3450.75)).toBe(4337.59);
  });
});

describe("roundQuantity", () => {
  it("rounds to 3 decimal places", () => {
    expect(roundQuantity(1.2345)).toBe(1.235);
    expect(roundQuantity(1.2344)).toBe(1.234);
  });

  it("cleans up small float-drift artifacts", () => {
    expect(roundQuantity(1.2000000000000002)).toBe(1.2);
  });

  it("leaves a whole number unchanged", () => {
    expect(roundQuantity(5)).toBe(5);
  });
});
