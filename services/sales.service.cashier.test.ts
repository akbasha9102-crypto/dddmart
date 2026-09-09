import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCashierRanking } from "./sales.service";
import type { Database } from "@/types/database.types";

interface SaleFixture {
  id: string;
  cashier_id: string | null;
}

interface SaleItemFixture {
  sale_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  cost_price: number;
}

interface ReturnFixture {
  sale_id: string;
  sale_item_id: string;
  quantity: number;
  actor_id: string | null;
  refund_amount: number;
  created_at: string;
}

interface DamageFixture {
  actor_id: string | null;
  loss_amount: number;
  created_at: string;
}

interface ReconciliationFixture {
  actor_id: string | null;
  loss_value: number;
  created_at: string;
}

interface ProfileFixture {
  id: string;
  full_name: string;
}

/**
 * Hand-rolled fake covering exactly the chains getCashierRanking exercises:
 * sales.select().gte().lte() (in-range) AND sales.select().in() (origin
 * lookup for returned sale_ids), returns.select().gte().lte(),
 * sale_items.select().in("sale_id", ...) AND sale_items.select().in("id", ...)
 * (returns' referenced lines, mirrors sales.service.returns.test.ts),
 * stock_damages.select().gte().lte(), stock_reconciliations.select().gte().lte()
 * (both mirror sales.service.reconciliation.test.ts), profiles.select().in().
 * Matches the style of sales.service.export.test.ts.
 */
function createFakeSupabase(fixtures: {
  salesInRange: SaleFixture[];
  originSales: SaleFixture[];
  saleItems: SaleItemFixture[];
  saleItemsById: Record<string, { unit_price: number; cost_price: number }>;
  returns: ReturnFixture[];
  damages: DamageFixture[];
  reconciliations: ReconciliationFixture[];
  profiles: ProfileFixture[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            gte: () => ({
              lte: async () => ({ data: fixtures.salesInRange, error: null }),
            }),
            in: async (column: string, values: string[]) => {
              if (column === "id") {
                const rows = fixtures.originSales.filter((sale) => values.includes(sale.id));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected sales.in column ${column}`);
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
              lte: async () => ({ data: fixtures.reconciliations, error: null }),
            }),
          }),
        };
      }
      if (table === "sale_items_secure") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "sale_id") {
                const rows = fixtures.saleItems.filter((item) => values.includes(item.sale_id));
                return { data: rows, error: null };
              }
              if (column === "id") {
                const rows = values
                  .map((id) => {
                    const item = fixtures.saleItemsById[id];
                    return item ? { id, ...item } : null;
                  })
                  .filter((row): row is { id: string; unit_price: number; cost_price: number } => Boolean(row));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected sale_items.in column ${column}`);
            },
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "id") {
                const rows = fixtures.profiles.filter((profile) => values.includes(profile.id));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected profiles.in column ${column}`);
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getCashierRanking", () => {
  it("buckets revenue/quantity/profit by cashier and sorts by totalRevenue desc", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [
        { id: "sale-1", cashier_id: "cashier-1" },
        { id: "sale-2", cashier_id: "cashier-1" },
      ],
      originSales: [],
      saleItems: [
        { sale_id: "sale-1", quantity: 2, unit_price: 50, total_price: 100, cost_price: 30 },
        { sale_id: "sale-2", quantity: 1, unit_price: 40, total_price: 40, cost_price: 20 },
      ],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: "cashier-1",
      cashierName: "أحمد",
      totalRevenue: 140,
      totalQuantity: 3,
      totalProfit: (50 - 30) * 2 + (40 - 20) * 1,
      soldReturnsCount: 0,
      soldReturnsValue: 0,
      processedReturnsCount: 0,
      processedReturnsValue: 0,
    });
  });

  it("sorts multiple cashiers by totalRevenue desc", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [
        { id: "sale-1", cashier_id: "cashier-1" },
        { id: "sale-2", cashier_id: "cashier-2" },
      ],
      originSales: [],
      saleItems: [
        { sale_id: "sale-1", quantity: 1, unit_price: 10, total_price: 10, cost_price: 5 },
        { sale_id: "sale-2", quantity: 1, unit_price: 100, total_price: 100, cost_price: 50 },
      ],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [],
      profiles: [
        { id: "cashier-1", full_name: "أحمد" },
        { id: "cashier-2", full_name: "سارة" },
      ],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result.map((row) => row.cashierId)).toEqual(["cashier-2", "cashier-1"]);
  });

  it("attributes soldReturns* to the originating cashier even when the original sale is out of range", async () => {
    // actor_id is null here (a different cashier processed it, unknown) so the
    // processed side lands in its own "غير معروف" bucket, distinct from the
    // sold-side row — confirms the two metrics are attributed independently.
    // Also asserts totalProfit's reversal works correctly when the origin sale
    // is outside the query's date range (originatingCashierBySaleId is resolved
    // via a separate unfiltered query, independent of the in-range sales fetch).
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [{ id: "old-sale", cashier_id: "cashier-2" }],
      saleItems: [],
      saleItemsById: { "item-1": { unit_price: 25, cost_price: 15 } },
      returns: [{ sale_id: "old-sale", sale_item_id: "item-1", quantity: 1, actor_id: null, refund_amount: 25, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-2", full_name: "سارة" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(2);
    const soldRow = result.find((row) => row.cashierId === "cashier-2");
    expect(soldRow).toMatchObject({
      cashierName: "سارة",
      totalRevenue: 0,
      totalQuantity: 0,
      totalProfit: -(25 - 15) * 1,
      soldReturnsCount: 1,
      soldReturnsValue: 25,
      processedReturnsCount: 0,
      processedReturnsValue: 0,
    });

    const unknownProcessedRow = result.find((row) => row.cashierId === null);
    expect(unknownProcessedRow).toMatchObject({
      cashierName: "غير معروف",
      soldReturnsCount: 0,
      processedReturnsCount: 1,
      processedReturnsValue: 25,
    });
  });

  it("attributes processedReturns* to the cashier who processed the return via actor_id", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [{ id: "sale-1", cashier_id: null }],
      saleItems: [],
      saleItemsById: {},
      returns: [{ sale_id: "sale-1", sale_item_id: "item-1", quantity: 1, actor_id: "cashier-3", refund_amount: 15, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-3", full_name: "ياسر" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    const processedRow = result.find((row) => row.cashierId === "cashier-3");
    expect(processedRow).toMatchObject({
      cashierName: "ياسر",
      totalRevenue: 0,
      processedReturnsCount: 1,
      processedReturnsValue: 15,
    });
  });

  it("merges sales and returns into a single row when the same cashier appears on both sides", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [{ id: "sale-1", cashier_id: "cashier-1" }],
      originSales: [{ id: "sale-1", cashier_id: "cashier-1" }],
      saleItems: [{ sale_id: "sale-1", quantity: 1, unit_price: 100, total_price: 100, cost_price: 60 }],
      saleItemsById: {},
      returns: [{ sale_id: "sale-1", sale_item_id: "item-1", quantity: 1, actor_id: "cashier-1", refund_amount: 20, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: "cashier-1",
      cashierName: "أحمد",
      totalRevenue: 100,
      totalQuantity: 1,
      totalProfit: 40,
      soldReturnsCount: 1,
      soldReturnsValue: 20,
      processedReturnsCount: 1,
      processedReturnsValue: 20,
    });
  });

  it("falls back to 'غير معروف' for null cashier_id, null-cashier origin sale, and null actor_id, merging into one row", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [{ id: "sale-1", cashier_id: null }],
      originSales: [{ id: "sale-2", cashier_id: null }],
      saleItems: [{ sale_id: "sale-1", quantity: 1, unit_price: 10, total_price: 10, cost_price: 5 }],
      saleItemsById: {},
      returns: [{ sale_id: "sale-2", sale_item_id: "item-1", quantity: 1, actor_id: null, refund_amount: 5, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: null,
      cashierName: "غير معروف",
      totalRevenue: 10,
      soldReturnsCount: 1,
      soldReturnsValue: 5,
      processedReturnsCount: 1,
      processedReturnsValue: 5,
    });
  });

  it("falls back to 'غير معروف' when a cashier_id has no matching profile row", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [{ id: "sale-1", cashier_id: "deleted-cashier" }],
      originSales: [],
      saleItems: [{ sale_id: "sale-1", quantity: 1, unit_price: 10, total_price: 10, cost_price: 5 }],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [],
      profiles: [],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]!.cashierName).toBe("غير معروف");
  });

  it("returns an empty array when there are no sales, returns, damages, and reconciliations in range", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [],
      profiles: [],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toEqual([]);
  });

  it("throws an Arabic error when the range exceeds MAX_RANGE_DAYS", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [],
      profiles: [],
    });

    await expect(
      getCashierRanking(supabase, new Date("2026-01-01"), new Date("2026-08-01")),
    ).rejects.toThrow("المدى الزمني الأقصى المسموح به هو 90 يوماً");
  });

  it("reverses the ORIGINATING cashier's totalProfit by the original line's real margin, NOT refund_amount", async () => {
    // Margin reversal is (unit_price - cost_price) * quantity = (50 - 30) * 2 = -40,
    // deliberately far from refund_amount (999) to prove totalProfit doesn't use it.
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [{ id: "sale-1", cashier_id: "cashier-1" }],
      saleItems: [],
      saleItemsById: { "item-1": { unit_price: 50, cost_price: 30 } },
      returns: [{ sale_id: "sale-1", sale_item_id: "item-1", quantity: 2, actor_id: null, refund_amount: 999, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    const soldRow = result.find((row) => row.cashierId === "cashier-1");
    expect(soldRow).toMatchObject({
      totalProfit: -40,
      soldReturnsValue: 999,
    });
  });

  it("leaves totalProfit unaffected when a return's sale_item_id has no matching sale_items row (guard)", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [{ id: "sale-1", cashier_id: "cashier-1" }],
      saleItems: [],
      saleItemsById: {},
      returns: [{ sale_id: "sale-1", sale_item_id: "missing-item", quantity: 1, actor_id: null, refund_amount: 30, created_at: "2026-08-05T00:00:00.000Z" }],
      damages: [],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    const soldRow = result.find((row) => row.cashierId === "cashier-1");
    expect(soldRow).toMatchObject({
      totalProfit: 0,
      soldReturnsValue: 30,
    });
  });

  it("subtracts stock_damages.loss_amount from totalProfit, attributed via actor_id", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [{ id: "sale-1", cashier_id: "cashier-1" }],
      originSales: [],
      saleItems: [{ sale_id: "sale-1", quantity: 1, unit_price: 100, total_price: 100, cost_price: 60 }],
      saleItemsById: {},
      returns: [],
      damages: [{ actor_id: "cashier-1", loss_amount: 12, created_at: "2026-08-05T00:00:00.000Z" }],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    const row = result.find((r) => r.cashierId === "cashier-1");
    expect(row).toMatchObject({
      totalProfit: (100 - 60) - 12,
    });
  });

  it("subtracts stock_reconciliations.loss_value from totalProfit, attributed via actor_id", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [{ id: "sale-1", cashier_id: "cashier-1" }],
      originSales: [],
      saleItems: [{ sale_id: "sale-1", quantity: 1, unit_price: 100, total_price: 100, cost_price: 60 }],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [{ actor_id: "cashier-1", loss_value: 8, created_at: "2026-08-05T00:00:00.000Z" }],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    const row = result.find((r) => r.cashierId === "cashier-1");
    expect(row).toMatchObject({
      totalProfit: (100 - 60) - 8,
    });
  });

  it("buckets a damage/reconciliation with actor_id null into the 'غير معروف' row", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      saleItemsById: {},
      returns: [],
      damages: [{ actor_id: null, loss_amount: 5, created_at: "2026-08-05T00:00:00.000Z" }],
      reconciliations: [{ actor_id: null, loss_value: 3, created_at: "2026-08-05T00:00:00.000Z" }],
      profiles: [],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: null,
      cashierName: "غير معروف",
      totalProfit: -5 - 3,
    });
  });

  it("returns a non-empty result when there are zero sales/returns but a damage exists in range (early-return guard regression)", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      saleItemsById: {},
      returns: [],
      damages: [{ actor_id: "cashier-1", loss_amount: 7, created_at: "2026-08-05T00:00:00.000Z" }],
      reconciliations: [],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).not.toEqual([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: "cashier-1",
      totalProfit: -7,
    });
  });

  it("returns a non-empty result when there are zero sales/returns but a reconciliation exists in range (early-return guard regression)", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      saleItemsById: {},
      returns: [],
      damages: [],
      reconciliations: [{ actor_id: "cashier-1", loss_value: 9, created_at: "2026-08-05T00:00:00.000Z" }],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).not.toEqual([]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      cashierId: "cashier-1",
      totalProfit: -9,
    });
  });
});
