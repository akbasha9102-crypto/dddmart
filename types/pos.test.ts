import { describe, expect, it } from "vitest";
import { productToCartItem, productUnitToCartItem } from "@/types/pos";
import type { Product, ProductUnit } from "@/types/product";

const PRODUCT: Product = {
  id: "product-1",
  name: "علبة علك",
  barcode: "1111",
  category_id: null,
  cost_price: 1,
  sale_price: 2,
  quantity: 50,
  min_stock_threshold: 5,
  unit: "قطعة",
  is_active: true,
  created_at: "",
  updated_at: "",
};

const CARTON_UNIT: ProductUnit = {
  id: "unit-1",
  product_id: "product-1",
  unit_name: "كارتون",
  conversion_factor: 24,
  barcode: "2222",
  sale_price: 40,
  sort_order: 0,
  is_active: true,
  created_at: "",
  updated_at: "",
};

describe("productToCartItem", () => {
  it("leaves unitName/unitConversionFactor undefined for a base-unit sale", () => {
    const item = productToCartItem(PRODUCT, 3);
    expect(item.unitName).toBeUndefined();
    expect(item.unitConversionFactor).toBeUndefined();
  });

  it("snapshots costPrice directly from the product's cost_price", () => {
    const item = productToCartItem(PRODUCT, 3);
    expect(item.costPrice).toBe(PRODUCT.cost_price);
  });
});

describe("productUnitToCartItem", () => {
  it("uses the unit's own barcode and sale_price, not the product's", () => {
    const item = productUnitToCartItem(PRODUCT, CARTON_UNIT, 2);
    expect(item).toEqual({
      productId: "product-1",
      name: "علبة علك",
      barcode: "2222",
      unitPrice: 40,
      costPrice: 24,
      quantity: 2,
      availableStock: 50,
      unitName: "كارتون",
      unitConversionFactor: 24,
    });
  });

  it("multiplies costPrice by the unit's conversion_factor", () => {
    const item = productUnitToCartItem(PRODUCT, CARTON_UNIT, 2);
    expect(item.costPrice).toBe(PRODUCT.cost_price * CARTON_UNIT.conversion_factor);
  });
});
