import { describe, expect, it } from "vitest";
import { toBaseUnitCost, toBaseUnits } from "@/lib/units";

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

describe("toBaseUnitCost", () => {
  it("returns the cost unchanged when no conversion factor is given (base-unit purchase)", () => {
    expect(toBaseUnitCost(500)).toBe(500);
  });

  it("divides cost by the conversion factor for a non-base purchase unit", () => {
    expect(toBaseUnitCost(2400, 24)).toBe(100);
  });

  it("treats a conversion factor of 1 the same as no conversion factor", () => {
    expect(toBaseUnitCost(750, 1)).toBe(750);
  });
});
