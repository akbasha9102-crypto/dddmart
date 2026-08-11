import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailySalesSummary } from "./sales.service";
import type { Database } from "@/types/database.types";
import type { Sale, SaleItem } from "@/types/pos";
import type { Return } from "@/types/returns";
import type { StockDamage } from "@/types/returns";

/**
 * Hand-rolled fake Supabase covering exactly the chains getDailySalesSummary
 * exercises: sales.select().gte().lte().order(), sale_items.select().in(),
 * returns.select().gte().lte() (+ a follow-up sale_items.select().in("id",...)
 * for the referenced lines), stock_damages.select().gte().lte(), and
 * stock_reconciliations.select().gte().lte() (always empty here — reconciliation
 * netting itself is covered by sales.service.reconciliation.test.ts). Table
 * dispatch is by name; every chain resolves to a plain data/error object,
 * filtered in-memory by the fixture data passed in — deliberately minimal,
 * matching the other fakes in this repo (see products.service.test.ts).
 */
function createFakeSupabase(fixtures: {
  sales: Sale[];
  saleItemsBySaleId: Record<string, SaleItem[]>;
  saleItemsById: Record<string, SaleItem>;
  returns: Return[];
  damages: StockDamage[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                order: async () => ({ data: fixtures.sales, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "sale_items") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "sale_id") {
                const rows = values.flatMap((saleId) => fixtures.saleItemsBySaleId[saleId] ?? []);
                return { data: rows, error: null };
              }
              if (column === "id") {
                const rows = values.map((id) => fixtures.saleItemsById[id]).filter((row): row is SaleItem => Boolean(row));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected sale_items.in column ${column}`);
            },
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: fixtures.returns, error: null }),
            }),
          }),
        };
      }
      if (table === "stock_damages") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: fixtures.damages, error: null }),
            }),
          }),
        };
      }
      if (table === "stock_reconciliations") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

const SALE: Sale = {
  id: "sale-1",
  invoice_number: "INV-1",
  cashier_id: null,
  subtotal: 100,
  discount_amount: 0,
  total_amount: 100,
  paid_amount: 100,
  change_amount: 0,
  payment_method: "cash",
  customer_id: null,
  store_id: "store-1",
  created_at: new Date().toISOString(),
};

const SALE_ITEM: SaleItem = {
  id: "item-1",
  sale_id: "sale-1",
  product_id: "product-1",
  product_name: "منتج",
  barcode: "1111",
  quantity: 10,
  unit_price: 10,
  total_price: 100,
  unit_label: null,
  unit_conversion_factor: 1,
  cost_price: 6,
  store_id: "store-1",
};

describe("getDailySalesSummary — returns/damage regression", () => {
  it("leaves totals unchanged from current behavior when there are zero returns/damage in range", async () => {
    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      saleItemsById: {},
      returns: [],
      damages: [],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalRevenue).toBe(100);
    expect(result.totalProfit).toBe((10 - 6) * 10);
    expect(result.totalReturnsValue).toBe(0);
    expect(result.totalDamageLoss).toBe(0);
  });

  it("nets a return dated in-range against its own day, even when the original sale is dated out-of-range", async () => {
    // No sales in range at all — proves the return's netting doesn't depend on the sale being in range too.
    const RETURN: Return = {
      id: "return-1",
      sale_id: "sale-1",
      sale_item_id: "item-1",
      product_id: "product-1",
      product_name: "منتج",
      quantity: 2,
      unit_label: null,
      unit_conversion_factor: 1,
      refund_amount: 20,
      reason: null,
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [],
      saleItemsBySaleId: {},
      saleItemsById: { "item-1": SALE_ITEM },
      returns: [RETURN],
      damages: [],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    // Revenue nets against the return's refund_amount even with zero sales today.
    expect(result.totalRevenue).toBe(-20);
    expect(result.totalReturnsValue).toBe(20);
    // Profit reversal uses the original line's real margin (10-6)*2=8, NOT refund_amount (20).
    expect(result.totalProfit).toBe(-8);
  });

  it("subtracts damage loss from totalProfit but not from totalRevenue", async () => {
    const DAMAGE: StockDamage = {
      id: "damage-1",
      product_id: "product-1",
      product_name: "منتج",
      quantity: 3,
      cost_price: 6,
      loss_amount: 18,
      reason: null,
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      saleItemsById: {},
      returns: [],
      damages: [DAMAGE],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalRevenue).toBe(100);
    expect(result.totalDamageLoss).toBe(18);
    expect(result.totalProfit).toBe((10 - 6) * 10 - 18);
  });
});
