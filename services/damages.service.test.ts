import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordDamage } from "./damages.service";
import type { Database } from "@/types/database.types";
import type { StockDamage } from "@/types/returns";

function makeDamage(overrides: Partial<StockDamage> = {}): StockDamage {
  return {
    id: "damage-1",
    product_id: "product-1",
    product_name: "علبة علك",
    quantity: 2,
    cost_price: 1.5,
    loss_amount: 3,
    reason: "منتهي الصلاحية",
    actor_id: "user-1",
    store_id: "store-1",
    created_at: "",
    ...overrides,
  };
}

/**
 * Hand-rolled fake covering the exact calls recordDamage makes
 * post-migration-40: a single rpc("record_damage", ...) call (the RPC now
 * row-locks the product, validates quantity against the LOCKED read,
 * computes cost_price/loss_amount server-side, decrements
 * products.quantity, and inserts the stock_damages row itself — all
 * server-side), one lightweight products.select("unit") follow-up read
 * (display-only, for the log message), then operations_log.insert() via
 * logOperation. recordDamage itself never inserts into stock_damages
 * directly anymore.
 */
function createFakeSupabase(options: {
  rpcResult: { data: StockDamage[] | null; error: { message: string } | null };
  productUnit?: string | null;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => options.rpcResult);
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "operations_log") return { insert: logInsertSpy };
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { unit: options.productUnit ?? "قطعة" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy };
}

const BASE_PARAMS = {
  productId: "product-1",
  productName: "علبة علك",
  quantity: 2,
  reason: "منتهي الصلاحية",
};

describe("recordDamage", () => {
  it("calls record_damage with exactly the client-trusted args and returns the inserted row", async () => {
    const inserted = makeDamage();
    const { supabase, rpcSpy } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    const result = await recordDamage(supabase, BASE_PARAMS, "user-1", "store-1");

    expect(rpcSpy).toHaveBeenCalledWith("record_damage", {
      p_product_id: "product-1",
      p_product_name: "علبة علك",
      p_quantity: 2,
      p_reason: "منتهي الصلاحية",
    });
    expect(result).toEqual(inserted);
  });

  it("propagates the RPC's insufficient-stock exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "الكمية أكبر من المخزون المتوفر (المتوفر: 1)" } },
    });

    await expect(recordDamage(supabase, BASE_PARAMS, "user-1", "store-1")).rejects.toThrow(
      "الكمية أكبر من المخزون المتوفر",
    );
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("propagates the RPC's 'product not found' exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "تعذر العثور على المنتج" } },
    });

    await expect(recordDamage(supabase, BASE_PARAMS, "user-1", "store-1")).rejects.toThrow(
      "تعذر العثور على المنتج",
    );
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("propagates the RPC's tenant-mismatch exception and never logs", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({
      rpcResult: { data: null, error: { message: "المنتج لا يتبع هذا المتجر" } },
    });

    await expect(recordDamage(supabase, BASE_PARAMS, "user-1", "store-1")).rejects.toThrow(
      "المنتج لا يتبع هذا المتجر",
    );
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("throws when the RPC returns no rows with no error (defensive empty-result guard)", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({ rpcResult: { data: [], error: null } });

    await expect(recordDamage(supabase, BASE_PARAMS, "user-1", "store-1")).rejects.toThrow(
      "تعذر تسجيل التلف",
    );
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("logs a damage_recorded operation using the RPC's own returned quantity/product_name/loss_amount, after a successful call", async () => {
    const inserted = makeDamage({ quantity: 2, product_name: "علبة علك", loss_amount: 3 });
    const { supabase, logInsertSpy } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    await recordDamage(supabase, BASE_PARAMS, "user-1", "store-1");

    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "damage_recorded",
        user_id: "user-1",
        store_id: "store-1",
        description: expect.stringContaining("تلف 2 قطعة"),
      }),
    );
  });

  it("never computes or overrides cost_price/loss_amount client-side — always relays exactly what the RPC returned, even if product_name looks mismatched", async () => {
    const inserted = makeDamage({
      product_name: "اسم مختلف عن ما أرسله العميل",
      cost_price: 1.5,
      loss_amount: 3,
    });
    const { supabase, rpcSpy } = createFakeSupabase({ rpcResult: { data: [inserted], error: null } });

    const result = await recordDamage(
      supabase,
      { ...BASE_PARAMS, productName: "اسم مزوّر يرسله العميل" },
      "user-1",
      "store-1",
    );

    expect(result.cost_price).toBe(1.5);
    expect(result.loss_amount).toBe(3);
    expect(rpcSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ p_product_name: "اسم مزوّر يرسله العميل" }),
    );
  });

  // Note on the atomicity/lock-vs-forgery guarantee itself: Vitest against
  // a mocked Supabase client cannot exercise real Postgres row-locking or
  // RLS — there is no actual concurrent transaction or REST-level policy
  // check here, just a mocked RPC response. The tests above confirm
  // recordDamage wires the RPC call and error surfacing correctly, and that
  // no client-supplied cost/loss value can reach stock_damages through this
  // service function. The actual security guarantee (stock_damages' INSERT
  // policy dropped, record_damage as the sole write path, the row lock on
  // products, and cost_price/loss_amount always derived from the locked
  // row) is enforced at the SQL level — see
  // supabase/migrations/00000000000040_record_damage_atomic.sql.
});
