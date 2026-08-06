import { describe, expect, it } from "vitest";
import { buildSaleItemRows } from "./sales.service";
import type { CartItem } from "@/types/pos";

describe("buildSaleItemRows", () => {
  it("defaults unit_label to null and unit_conversion_factor to 1 for a base-unit sale", () => {
    const items: CartItem[] = [{ productId: "p1", name: "منتج", barcode: "1111", unitPrice: 10, quantity: 2, availableStock: 8 }];

    expect(buildSaleItemRows("sale-1", items)).toEqual([
      {
        sale_id: "sale-1",
        product_id: "p1",
        product_name: "منتج",
        barcode: "1111",
        quantity: 2,
        unit_price: 10,
        total_price: 20,
        unit_label: null,
        unit_conversion_factor: 1,
      },
    ]);
  });

  it("carries unitName/unitConversionFactor through for a unit sale", () => {
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "منتج",
        barcode: "2222",
        unitPrice: 40,
        quantity: 1,
        availableStock: 8,
        unitName: "كارتون",
        unitConversionFactor: 24,
      },
    ];

    expect(buildSaleItemRows("sale-1", items)[0]).toMatchObject({
      unit_label: "كارتون",
      unit_conversion_factor: 24,
    });
  });
});
