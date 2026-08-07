import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllProductUnits, resolveBarcode } from "./products.service";
import type { Database } from "@/types/database.types";
import type { Product, ProductUnit } from "@/types/product";

const BASE_PRODUCT: Product = {
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

/**
 * Hand-rolled fake covering only the two chains resolveBarcode actually
 * calls: products.select().eq().eq().maybeSingle() and
 * product_units.select().eq().eq().eq().maybeSingle(). Not a general
 * Supabase mock — deliberately minimal.
 */
function createFakeSupabase(options: {
  productsRow: Product | null;
  unitRow: (ProductUnit & { products: Product }) | null;
}): SupabaseClient<Database> {
  return {
    from: (table: "products" | "product_units") => {
      const result = table === "products" ? { data: options.productsRow, error: null } : { data: options.unitRow, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("resolveBarcode", () => {
  it("returns kind 'base' when the barcode matches a product directly", async () => {
    const supabase = createFakeSupabase({ productsRow: BASE_PRODUCT, unitRow: null });
    const result = await resolveBarcode(supabase, "1111");
    expect(result).toEqual({ kind: "base", product: BASE_PRODUCT });
  });

  it("returns kind 'unit' when the barcode matches a product_units row", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: { ...CARTON_UNIT, products: BASE_PRODUCT } });
    const result = await resolveBarcode(supabase, "2222");
    expect(result).toEqual({ kind: "unit", product: BASE_PRODUCT, unit: CARTON_UNIT });
  });

  it("returns null when the barcode matches nothing", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: null });
    const result = await resolveBarcode(supabase, "9999");
    expect(result).toBeNull();
  });
});

/**
 * Hand-rolled fake covering only the chain listAllProductUnits actually
 * calls: product_units.select().eq(). Not a general Supabase mock —
 * deliberately minimal, matching createFakeSupabase above.
 */
function createFakeSupabaseForUnits(units: ProductUnit[]): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: units, error: null }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("listAllProductUnits", () => {
  it("returns all active product units", async () => {
    const supabase = createFakeSupabaseForUnits([CARTON_UNIT]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([CARTON_UNIT]);
  });

  it("returns an empty array when there are none", async () => {
    const supabase = createFakeSupabaseForUnits([]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([]);
  });
});
