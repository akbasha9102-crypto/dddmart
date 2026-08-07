import { describe, expect, it } from "vitest";
import { resolveBarcodeOffline } from "./productCache";
import type { ProductUnit, ProductWithCategory } from "@/types/product";

const BASE_PRODUCT: ProductWithCategory = {
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
  category: null,
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

describe("resolveBarcodeOffline", () => {
  it("returns kind 'base' when the barcode matches a cached product directly", () => {
    const result = resolveBarcodeOffline("1111", [BASE_PRODUCT], []);
    expect(result).toEqual({ kind: "base", product: BASE_PRODUCT });
  });

  it("returns kind 'unit' when the barcode matches a cached product_units row", () => {
    const result = resolveBarcodeOffline("2222", [BASE_PRODUCT], [CARTON_UNIT]);
    expect(result).toEqual({ kind: "unit", product: BASE_PRODUCT, unit: CARTON_UNIT });
  });

  it("returns null when the barcode matches nothing", () => {
    const result = resolveBarcodeOffline("9999", [BASE_PRODUCT], [CARTON_UNIT]);
    expect(result).toBeNull();
  });

  it("ignores inactive products", () => {
    const inactive = { ...BASE_PRODUCT, is_active: false };
    const result = resolveBarcodeOffline("1111", [inactive], []);
    expect(result).toBeNull();
  });

  it("ignores inactive product_units", () => {
    const inactiveUnit = { ...CARTON_UNIT, is_active: false };
    const result = resolveBarcodeOffline("2222", [BASE_PRODUCT], [inactiveUnit]);
    expect(result).toBeNull();
  });

  it("returns null for a unit whose parent product is missing from the cache", () => {
    const result = resolveBarcodeOffline("2222", [], [CARTON_UNIT]);
    expect(result).toBeNull();
  });
});
