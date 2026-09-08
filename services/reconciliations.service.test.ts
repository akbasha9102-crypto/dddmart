import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordReconciliation } from "./reconciliations.service";
import type { Database } from "@/types/database.types";
import type { StockReconciliation } from "@/types/reconciliations";

function makeReconciliation(overrides: Partial<StockReconciliation> = {}): StockReconciliation {
  return {
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
    ...overrides,
  };
}

/**
 * Hand-rolled fake covering the exact calls recordReconciliation makes
 * post-migration-36: a single rpc("record_reconciliation", ...) call (the
 * RPC now row-locks the product, computes previous_quantity/difference/
 * loss_value from the LOCKED read, and inserts the stock_reconciliations
 * row itself — all server-side), followed by operations_log.insert() via
 * logOperation. recordReconciliation itself never touches `.from(...)`
 * directly anymore. Matches the mocking style in returns.service.test.ts
 * (post-migration-35, single RPC mock, error surfaced as a {message}
 * object exactly like a real PostgrestError).
 */
function createFakeSupabase(options: {
  rpcResult: { data: StockReconciliation[] | null; error: { message: string } | null };
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const rpcSpy = vi.fn(async () => options.rpcResult);

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy };
}

const BASE_PARAMS = {
  productId: "product-1",
  productName: "علبة علك",
  reason: "جرد دوري",
};

describe("recordReconciliation", () => {
  it("calls record_reconciliation with the right args and returns the inserted row", async () => {
    const inserted = makeReconciliation();
    const { supabase, rpcSpy } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    const result = await recordReconciliation(
      supabase,
      { ...BASE_PARAMS, countedQuantity: 18 },
      "user-1",
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith("record_reconciliation", {
      p_product_id: "product-1",
      p_product_name: "علبة علك",
      p_counted_quantity: 18,
      p_reason: "جرد دوري",
    });
    expect(result).toEqual(inserted);
  });

  it("propagates the RPC's 'product not found' exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "تعذر العثور على المنتج" } },
    });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر العثور على المنتج");
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("propagates the RPC's 'no difference' exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "لا يوجد فرق لتسجيله" } },
    });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 20 }, "user-1", "store-1"),
    ).rejects.toThrow("لا يوجد فرق لتسجيله");
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("propagates the RPC's tenant-mismatch exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "المنتج لا يتبع هذا المتجر" } },
    });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("المنتج لا يتبع هذا المتجر");
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("throws when the RPC returns no rows with no error (defensive empty-result guard)", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({ rpcResult: { data: [], error: null } });

    await expect(
      recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1"),
    ).rejects.toThrow("تعذر تسجيل التسوية");
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("computes a negative difference and a positive loss_value for a shortage (as returned by the RPC)", async () => {
    const inserted = makeReconciliation({ previous_quantity: 20, counted_quantity: 18, difference: -2, loss_value: 3 });
    const { supabase } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    const result = await recordReconciliation(
      supabase,
      { ...BASE_PARAMS, countedQuantity: 18 },
      "user-1",
      "store-1",
    );

    expect(result.difference).toBe(-2);
    expect(result.loss_value).toBe(3);
  });

  it("computes a positive difference with zero loss_value for an overage (as returned by the RPC)", async () => {
    const inserted = makeReconciliation({ previous_quantity: 20, counted_quantity: 23, difference: 3, loss_value: 0 });
    const { supabase } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    const result = await recordReconciliation(
      supabase,
      { ...BASE_PARAMS, countedQuantity: 23 },
      "user-1",
      "store-1",
    );

    expect(result.difference).toBe(3);
    expect(result.loss_value).toBe(0);
  });

  it("logs a stock_reconciled operation using the RPC's returned previous/counted/difference, after a successful call", async () => {
    const inserted = makeReconciliation({ previous_quantity: 20, counted_quantity: 18, difference: -2 });
    const { supabase, logInsertSpy } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    await recordReconciliation(supabase, { ...BASE_PARAMS, countedQuantity: 18 }, "user-1", "store-1");

    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "stock_reconciled",
        user_id: "user-1",
        store_id: "store-1",
        description: expect.stringContaining("من 20 إلى 18"),
      }),
    );
  });

  // Note on the TOCTOU race fix itself: Vitest against a mocked Supabase
  // client cannot exercise real Postgres row-locking — there is no actual
  // concurrent transaction here, just a single mocked RPC response. The
  // tests above confirm recordReconciliation wires the RPC call and error
  // surfacing correctly, but the concurrency-safety guarantee (the
  // `select ... for update` lock on products, and previous_quantity/
  // difference being derived from that locked read rather than any
  // client-supplied value) is verified at the SQL level by the migration's
  // live dry-run tests, not by a fabricated "two calls at once" unit test
  // that would not actually prove atomicity. See
  // supabase/migrations/00000000000036_atomic_stock_reconciliation.sql.
});
