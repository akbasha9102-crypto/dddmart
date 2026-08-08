import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordDamage } from "./damages.service";
import type { Database } from "@/types/database.types";
import type { StockDamage } from "@/types/returns";
import type { Product } from "@/types/product";

const DECREMENTED_PRODUCT: Product = {
  id: "product-1",
  name: "علبة علك",
  barcode: "1111",
  category_id: null,
  cost_price: 1.5,
  sale_price: 2,
  quantity: 48,
  min_stock_threshold: 5,
  unit: "قطعة",
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

const INSERTED_DAMAGE: StockDamage = {
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
};

/**
 * Hand-rolled fake covering the exact chains recordDamage calls: rpc()
 * (decrementStock), stock_damages.insert().select().single(),
 * operations_log.insert() (logOperation), and — only on the insufficient-stock
 * path — products.select().eq().maybeSingle() (to report the available qty).
 * Deliberately minimal, matching the other fakes in this repo.
 */
function createFakeSupabase(options: { rpcData: Product[] | null; currentQuantity?: number }): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData, error: null }));
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: INSERTED_DAMAGE, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "stock_damages") return { insert: insertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      if (table === "products") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { quantity: options.currentQuantity ?? 0 }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, insertSpy, logInsertSpy };
}

const BASE_PARAMS = {
  productId: "product-1",
  productName: "علبة علك",
  quantity: 2,
  reason: "منتهي الصلاحية",
};

describe("recordDamage", () => {
  it("throws a friendly Arabic error and inserts nothing when decrementStock returns null (insufficient stock)", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({ rpcData: [], currentQuantity: 1 });

    await expect(recordDamage(supabase, BASE_PARAMS, "user-1", "store-1")).rejects.toThrow("الكمية أكبر من المخزون المتوفر");
    expect(insertSpy).not.toHaveBeenCalled();
    expect(logInsertSpy).not.toHaveBeenCalled();
  });

  it("computes loss_amount from the post-decrement cost_price returned by decrementStock", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ rpcData: [DECREMENTED_PRODUCT] });

    const result = await recordDamage(supabase, BASE_PARAMS, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cost_price: 1.5, loss_amount: 3, quantity: 2, store_id: "store-1" }),
    );
    expect(result).toEqual(INSERTED_DAMAGE);
  });

  it("logs a damage_recorded operation after a successful decrement", async () => {
    const { supabase, logInsertSpy } = createFakeSupabase({ rpcData: [DECREMENTED_PRODUCT] });

    await recordDamage(supabase, BASE_PARAMS, "user-1", "store-1");

    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "damage_recorded", user_id: "user-1", store_id: "store-1" }),
    );
  });
});
