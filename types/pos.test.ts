import { describe, expect, it } from "vitest";
import { calculateTotals, productToCartItem, productUnitToCartItem } from "@/types/pos";
import type { CartItem } from "@/types/pos";
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
  sold_by_weight: false,
  is_active: true,
  store_id: "store-1",
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
  store_id: "store-1",
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
      soldByWeight: false,
    });
  });

  it("multiplies costPrice by the unit's conversion_factor", () => {
    const item = productUnitToCartItem(PRODUCT, CARTON_UNIT, 2);
    expect(item.costPrice).toBe(PRODUCT.cost_price * CARTON_UNIT.conversion_factor);
  });
});

describe("calculateTotals", () => {
  it("clamps totalAmount to 0 for an oversized discount WITHOUT throwing — pure clamp-only helper, live cart update loop must never throw on keystroke", () => {
    const items: CartItem[] = [
      { productId: "p1", name: "منتج", barcode: "1111", unitPrice: 100, costPrice: 60, quantity: 2, availableStock: 8, soldByWeight: false },
    ];

    const totals = calculateTotals(items, 9999);

    expect(totals).toEqual({ subtotal: 200, discountAmount: 9999, totalAmount: 0 });
  });
});

describe("calculateTotals — per-line rounding for fractional quantities", () => {
  it("rounds each line to the nearest fils before summing, matching create_sale_atomic's algorithm", () => {
    // Two weighed lines whose raw (unrounded) products would sum to a
    // different total than summing the two ALREADY-rounded line totals —
    // create_sale_atomic (migration 42) rounds v_unit_price * v_quantity
    // PER LINE before adding into v_subtotal, so the client must too.
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "دجاج",
        barcode: "1111",
        unitPrice: 3450.75,
        costPrice: 3000,
        quantity: 1.257,
        availableStock: 50,
        soldByWeight: true,
      },
      {
        productId: "p2",
        name: "سكر",
        barcode: "2222",
        unitPrice: 1250.33,
        costPrice: 1000,
        quantity: 0.834,
        availableStock: 50,
        soldByWeight: true,
      },
    ];

    // Per-line rounded: round(3450.75 * 1.257, 2) = 4337.59, round(1250.33 * 0.834, 2) = 1042.78
    // Sum of rounded lines: 4337.59 + 1042.78 = 5380.37
    const { subtotal } = calculateTotals(items, 0);
    expect(subtotal).toBe(5380.37);
  });

  it("still sums whole-number-quantity lines exactly as before (regression guard)", () => {
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "علبة علك",
        barcode: "1111",
        unitPrice: 2,
        costPrice: 1,
        quantity: 3,
        availableStock: 50,
        soldByWeight: false,
      },
    ];
    expect(calculateTotals(items, 0).subtotal).toBe(6);
  });
});

describe("soldByWeight propagation", () => {
  it("copies sold_by_weight from the product into the cart item", () => {
    const weighedProduct: Product = { ...PRODUCT, sold_by_weight: true };
    expect(productToCartItem(weighedProduct, 1.25).soldByWeight).toBe(true);
    expect(productToCartItem(PRODUCT, 1).soldByWeight).toBe(false);
  });

  it("copies sold_by_weight through productUnitToCartItem too", () => {
    const weighedProduct: Product = { ...PRODUCT, sold_by_weight: true };
    expect(productUnitToCartItem(weighedProduct, CARTON_UNIT, 1).soldByWeight).toBe(true);
  });
});
