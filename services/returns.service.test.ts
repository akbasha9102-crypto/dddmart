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
  sold_by_weight: false,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering the exact calls recordReturn/
 * getReturnedQuantitiesForSale make post-migration-21: recordReturn now
 * calls two different RPCs in sequence (record_return, then
 * adjust_product_stock via incrementStock) and never touches
 * `.from("returns")` directly at all — only getReturnedQuantitiesForSale
 * still does, via .select().eq(), which is untouched here. `.rpc(name,
 * args)` dispatches by name so both RPCs can be mocked independently per
 * test. Deliberately minimal, matching the other fakes in this repo (see
 * products.service.test.ts).
 */
function createFakeSupabase(options: {
  recordReturnResult: { data: Return[] | null; error: { message: string } | null };
  adjustStockData?: Product[] | null;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const rpcSpy = vi.fn(async (name: string) => {
    if (name === "record_return") return options.recordReturnResult;
    if (name === "adjust_product_stock") return { data: options.adjustStockData ?? [RESTORED_PRODUCT], error: null };
    throw new Error(`unexpected rpc ${name}`);
  });

  const supabase = {
    from: (table: string) => {
      if (table === "operations_log") {
        return { insert: logInsertSpy };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: rpcSpy,
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy };
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
  it("calls the record_return RPC with the correct args, then adjust_product_stock with the base-unit-converted delta", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({
      recordReturnResult: { data: [INSERTED_RETURN], error: null },
    });

    const result = await recordReturn(
      supabase,
      { ...BASE_PARAMS, quantity: 1, unitLabel: "كارتون", unitConversionFactor: 24 },
      "user-1",
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith("record_return", {
      p_sale_id: "sale-1",
      p_sale_item_id: "item-1",
      p_product_id: "product-1",
      p_product_name: "علبة علك",
      p_quantity: 1,
      p_unit_label: "كارتون",
      p_unit_conversion_factor: 24,
      p_refund_amount: 4,
      p_reason: "تالف",
    });
    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 2,
    });
    expect(result).toEqual(INSERTED_RETURN);
  });

  it("uses the RPC response's product_id/quantity/unit_conversion_factor for incrementStock, not the client-supplied params (regression test: forged params must not inflate/misdirect stock)", async () => {
    const forgedResponse: Return = {
      ...INSERTED_RETURN,
      product_id: "real-product-1",
      quantity: 1,
      unit_conversion_factor: 24,
    };
    const { supabase, rpcSpy } = createFakeSupabase({
      recordReturnResult: { data: [forgedResponse], error: null },
    });

    await recordReturn(
      supabase,
      {
        ...BASE_PARAMS,
        productId: "forged-product-999",
        quantity: 1,
        unitConversionFactor: 2400,
      },
      "user-1",
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "real-product-1",
      p_delta: 24,
    });
    expect(rpcSpy).not.toHaveBeenCalledWith(
      "adjust_product_stock",
      expect.objectContaining({ p_product_id: "forged-product-999" }),
    );
    expect(rpcSpy).not.toHaveBeenCalledWith("adjust_product_stock", expect.objectContaining({ p_delta: 2400 }));
  });

  it("throws the RPC's Arabic over-quantity error and never touches stock (rejected return must not mutate stock)", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({
      recordReturnResult: {
        data: null,
        error: { message: "الكمية المطلوب إرجاعها أكبر من المتبقي القابل للإرجاع (المتبقي: 1)" },
      },
    });

    await expect(recordReturn(supabase, { ...BASE_PARAMS, quantity: 2 }, "user-1", "store-1")).rejects.toThrow(
      "الكمية المطلوب إرجاعها أكبر من المتبقي القابل للإرجاع (المتبقي: 1)",
    );

    expect(rpcSpy).not.toHaveBeenCalledWith("adjust_product_stock", expect.anything());
  });

  it("throws the RPC's Arabic over-refund-amount error and never touches stock or logs (direct regression test for audit 2.2)", async () => {
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabase({
      recordReturnResult: {
        data: null,
        error: { message: "قيمة الاسترجاع (10) أكبر من الحد المسموح لهذه الكمية (4)" },
      },
    });

    await expect(
      recordReturn(supabase, { ...BASE_PARAMS, refundAmount: 10 }, "user-1", "store-1"),
    ).rejects.toThrow("قيمة الاسترجاع (10) أكبر من الحد المسموح لهذه الكمية (4)");

    expect(rpcSpy).not.toHaveBeenCalledWith("adjust_product_stock", expect.anything());
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("still inserts the return and logs, but skips incrementStock, when productId is null", async () => {
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabase({
      recordReturnResult: { data: [{ ...INSERTED_RETURN, product_id: null }], error: null },
    });

    const result = await recordReturn(supabase, { ...BASE_PARAMS, productId: null }, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("record_return", expect.objectContaining({ p_product_id: null }));
    expect(rpcSpy).not.toHaveBeenCalledWith("adjust_product_stock", expect.anything());
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "return_created" }));
    expect(result).toEqual({ ...INSERTED_RETURN, product_id: null });
  });

  // Note on 2.3 (the double-return race): Vitest against a mocked Supabase
  // client cannot exercise real Postgres row-locking — there is no actual
  // concurrent transaction here, just sequential mock calls. The tests
  // above confirm recordReturn wires the RPC call and error surfacing
  // correctly, but the concurrency-safety guarantee itself (the `select
  // ... for update` lock on sale_items) is verified at the SQL level by
  // the migration, not by a fabricated "two calls at once" unit test that
  // would not actually prove atomicity. See
  // supabase/migrations/00000000000021_atomic_return_recording.sql.

  it("does not pass any customer/debt-related params to record_return — debt reduction is entirely server-side inside the RPC", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({
      recordReturnResult: { data: [INSERTED_RETURN], error: null },
    });

    await recordReturn(supabase, BASE_PARAMS, "user-1", "store-1");

    const recordReturnCall = rpcSpy.mock.calls.find(([name]) => name === "record_return");
    expect(recordReturnCall).toBeDefined();
    const args = recordReturnCall?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(
      [
        "p_sale_id",
        "p_sale_item_id",
        "p_product_id",
        "p_product_name",
        "p_quantity",
        "p_unit_label",
        "p_unit_conversion_factor",
        "p_refund_amount",
        "p_reason",
      ].sort(),
    );
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
