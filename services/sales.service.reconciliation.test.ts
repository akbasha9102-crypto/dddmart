import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailySalesSummary } from "./sales.service";
import type { Database } from "@/types/database.types";
import type { Sale, SaleItem } from "@/types/pos";
import type { StockReconciliation } from "@/types/reconciliations";

/**
 * Hand-rolled fake covering exactly the chains getDailySalesSummary
 * exercises for this test: sales.select().gte().lte().order(),
 * sale_items.select().in(), returns.select().gte().lte(),
 * stock_damages.select().gte().lte(), and
 * stock_reconciliations.select().gte().lte(). Deliberately minimal,
 * matching sales.service.returns.test.ts.
 */
function createFakeSupabase(fixtures: {
  sales: Sale[];
  saleItemsBySaleId: Record<string, SaleItem[]>;
  reconciliations: StockReconciliation[];
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
              throw new Error(`unexpected sale_items.in column ${column}`);
            },
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "stock_damages") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "stock_reconciliations") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: fixtures.reconciliations, error: null }),
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

describe("getDailySalesSummary — reconciliation regression", () => {
  it("subtracts a shortage reconciliation's loss_value from totalProfit but not totalRevenue", async () => {
    const RECONCILIATION: StockReconciliation = {
      id: "reconciliation-1",
      product_id: "product-1",
      product_name: "منتج",
      unit: "قطعة",
      previous_quantity: 20,
      counted_quantity: 18,
      difference: -2,
      cost_price: 6,
      loss_value: 12,
      reason: "جرد دوري",
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      reconciliations: [RECONCILIATION],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalRevenue).toBe(100);
    expect(result.totalReconciliationLoss).toBe(12);
    expect(result.totalProfit).toBe((10 - 6) * 10 - 12);
  });

  it("does not subtract anything for an overage reconciliation (loss_value 0)", async () => {
    const RECONCILIATION: StockReconciliation = {
      id: "reconciliation-2",
      product_id: "product-1",
      product_name: "منتج",
      unit: "قطعة",
      previous_quantity: 20,
      counted_quantity: 23,
      difference: 3,
      cost_price: 6,
      loss_value: 0,
      reason: "جرد دوري",
      actor_id: null,
      store_id: "store-1",
      created_at: new Date().toISOString(),
    };

    const supabase = createFakeSupabase({
      sales: [SALE],
      saleItemsBySaleId: { "sale-1": [SALE_ITEM] },
      reconciliations: [RECONCILIATION],
    });

    const result = await getDailySalesSummary(supabase, new Date());

    expect(result.totalReconciliationLoss).toBe(0);
    expect(result.totalProfit).toBe((10 - 6) * 10);
  });
});
