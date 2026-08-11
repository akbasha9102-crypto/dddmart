import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordReconciliation } from "./reconciliations.service";
import type { Database } from "@/types/database.types";
import type { StockReconciliation } from "@/types/reconciliations";
import type { Product } from "@/types/product";

const PRODUCT_FIELDS = { quantity: 20, cost_price: 1.5, unit: "قطعة" };

const INSERTED_RECONCILIATION: StockReconciliation = {
  id: "reconciliation-1",
  product_id: "product-1",
  product_name: "علبة علك",
  unit: "قطعة",
  previous_quantity: 20,
  counted_quantity: 18,
  difference: -2,
  cost_price: 1.5,
  loss_value: 3,
  reason: "جرد دوري",
  actor_id: "user-1",
  store_id: "store-1",
  created_at: "",
};

/**
 * Hand-rolled fake covering the exact chains recordReconciliation calls:
 * products.select().eq().maybeSingle() (fresh stock snapshot), rpc()
 * (adjust_product_stock), stock_reconciliations.insert().select().single(),
 * and operations_log.insert() (logOperation). Deliberately minimal,
 * matching the other fakes in this repo (see damages.service.test.ts).
 */
function createFakeSupabase(options: {
  productFields?: { quantity: number; cost_price: number; unit: string } | null;
  rpcData?: Product[] | null;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({
    data: options.rpcData ?? [{ ...PRODUCT_FIELDS } as Product],
    error: null,
  }));
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: INSERTED_RECONCILIATION, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.productFields === undefined ? PRODUCT_FIELDS : options.productFields,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "stock_reconciliations") return { insert: insertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, insertSpy, logInsertSpy };
}

const BASE_PARAMS = {
  productId: "product-1",
  productName: "علبة علك",
  reason: "جرد دوري",
};

describe("recordReconciliation", () => {
  it("throws and inserts nothing when the product can't be found", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({ productFields: null });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر العثور على المنتج");
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("throws and inserts nothing when the counted quantity equals the current quantity", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 20 }, "user-1", "store-1"),
    ).rejects.toThrow("لا يوجد فرق لتسجيله");
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("computes a negative difference and a positive loss_value for a shortage", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", { p_product_id: "product-1", p_delta: -2 });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_quantity: 20,
        counted_quantity: 18,
        difference: -2,
        loss_value: 3,
        store_id: "store-1",
      }),
    );
  });

  it("computes a positive difference with zero loss_value for an overage", async () => {
    const { supabase, rpcSpy, insertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 23 }, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", { p_product_id: "product-1", p_delta: 3 });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ difference: 3, loss_value: 0 }));
  });

  it("throws when the RPC returns no rows (adjustment guard rejected it)", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ rpcData: [] });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر تحديث المخزون");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("logs a stock_reconciled operation after a successful adjustment", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({});

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1");

    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "stock_reconciled", user_id: "user-1", store_id: "store-1" }),
    );
  });
});
