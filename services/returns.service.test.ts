import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getReturnedQuantitiesForSale, recordReturn } from "./returns.service";
import type { Database } from "@/types/database.types";
import type { Return } from "@/types/returns";
import type { Product } from "@/types/product";

const INSERTED_RETURN: Return = {
  id: "return-1",
  sale_id: "sale-1",
  sale_item_id: "item-1",
  product_id: "product-1",
  product_name: "علبة علك",
  quantity: 2,
  unit_label: null,
  unit_conversion_factor: 1,
  refund_amount: 4,
  reason: "تالف",
  actor_id: "user-1",
  store_id: "store-1",
  created_at: "",
};

const RESTORED_PRODUCT: Product = {
  id: "product-1",
  name: "علبة علك",
  barcode: "1111",
  category_id: null,
  cost_price: 1,
  sale_price: 2,
  quantity: 52,
  min_stock_threshold: 5,
  unit: "قطعة",
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering the exact chains recordReturn/getReturnedQuantitiesForSale
 * call: returns.select().eq() (existing-returns check + getReturnedQuantitiesForSale),
 * returns.insert().select().single(), rpc() (incrementStock), and
 * operations_log.insert() (logOperation). Deliberately minimal, matching the
 * other fakes in this repo (see products.service.test.ts).
 */
function createFakeSupabase(options: {
  existingReturns: { sale_item_id: string; quantity: number }[];
  insertedReturn: Return;
  rpcData: Product[] | null;
}): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedReturn, error: null }),
    }),
  }));
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData, error: null }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "returns") {
        return {
          select: () => ({
            eq: async () => ({ data: options.existingReturns, error: null }),
          }),
          insert: insertSpy,
        };
      }
      if (table === "operations_log") {
        return { insert: logInsertSpy };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: rpcSpy,
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, rpcSpy, logInsertSpy };
}

const BASE_PARAMS = {
  saleId: "sale-1",
  saleItemId: "item-1",
  productId: "product-1",
  productName: "علبة علك",
  unitLabel: null,
  unitConversionFactor: 1,
  originalLineQuantity: 5,
  quantity: 2,
  refundAmount: 4,
  reason: "تالف",
};

describe("recordReturn", () => {
  it("throws a friendly Arabic error when the requested quantity would over-return the line", async () => {
    const { supabase } = createFakeSupabase({
      existingReturns: [{ sale_item_id: "item-1", quantity: 4 }],
      insertedReturn: INSERTED_RETURN,
      rpcData: [RESTORED_PRODUCT],
    });

    await expect(
      recordReturn(supabase, { ...BASE_PARAMS, quantity: 2 }, "user-1", "store-1"),
    ).rejects.toThrow("المتبقي: 1");
  });

  it("calls incrementStock with the base-unit-converted quantity for a unit sale", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({
      existingReturns: [],
      insertedReturn: INSERTED_RETURN,
      rpcData: [RESTORED_PRODUCT],
    });

    await recordReturn(
      supabase,
      { ...BASE_PARAMS, quantity: 1, unitLabel: "كارتون", unitConversionFactor: 24 },
      "user-1",
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 24,
    });
  });

  it("still inserts the return and logs, but skips incrementStock, when productId is null", async () => {
    const { supabase, rpcSpy, insertSpy, logInsertSpy } = createFakeSupabase({
      existingReturns: [],
      insertedReturn: { ...INSERTED_RETURN, product_id: null },
      rpcData: [RESTORED_PRODUCT],
    });

    const result = await recordReturn(supabase, { ...BASE_PARAMS, productId: null }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalled();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "return_created" }));
    expect(result).toEqual({ ...INSERTED_RETURN, product_id: null });
  });
});

describe("getReturnedQuantitiesForSale", () => {
  it("sums quantity across multiple prior partial returns, grouped by sale_item_id", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: [
              { sale_item_id: "item-1", quantity: 2 },
              { sale_item_id: "item-1", quantity: 1 },
              { sale_item_id: "item-2", quantity: 3 },
            ],
            error: null,
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await getReturnedQuantitiesForSale(supabase, "sale-1");

    expect(result.get("item-1")).toBe(3);
    expect(result.get("item-2")).toBe(3);
  });

  it("returns an empty map when there are no returns", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await getReturnedQuantitiesForSale(supabase, "sale-1");
    expect(result.size).toBe(0);
  });
});
