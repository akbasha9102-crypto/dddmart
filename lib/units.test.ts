import { describe, expect, it } from "vitest";
import { toBaseUnits } from "@/lib/units";

describe("toBaseUnits", () => {
  it("returns the quantity unchanged when no conversion factor is given (base-unit sale)", () => {
    expect(toBaseUnits(5)).toBe(5);
  });

  it("multiplies quantity by the conversion factor for a non-base unit", () => {
    expect(toBaseUnits(2, 24)).toBe(48);
  });

  it("treats a conversion factor of 1 the same as no conversion factor", () => {
    expect(toBaseUnits(7, 1)).toBe(7);
  });
});
