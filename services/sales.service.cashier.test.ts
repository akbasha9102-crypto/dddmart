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
  actor_id: string | null;
  refund_amount: number;
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
 * sale_items.select().in(), profiles.select().in(). Matches the style of
 * sales.service.export.test.ts.
 */
function createFakeSupabase(fixtures: {
  salesInRange: SaleFixture[];
  originSales: SaleFixture[];
  saleItems: SaleItemFixture[];
  returns: ReturnFixture[];
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
      if (table === "sale_items") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "sale_id") {
                const rows = fixtures.saleItems.filter((item) => values.includes(item.sale_id));
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
      returns: [],
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
      returns: [],
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
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [{ id: "old-sale", cashier_id: "cashier-2" }],
      saleItems: [],
      returns: [{ sale_id: "old-sale", actor_id: null, refund_amount: 25, created_at: "2026-08-05T00:00:00.000Z" }],
      profiles: [{ id: "cashier-2", full_name: "سارة" }],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(2);
    const soldRow = result.find((row) => row.cashierId === "cashier-2");
    expect(soldRow).toMatchObject({
      cashierName: "سارة",
      totalRevenue: 0,
      totalQuantity: 0,
      totalProfit: 0,
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
      returns: [{ sale_id: "sale-1", actor_id: "cashier-3", refund_amount: 15, created_at: "2026-08-05T00:00:00.000Z" }],
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
      returns: [{ sale_id: "sale-1", actor_id: "cashier-1", refund_amount: 20, created_at: "2026-08-05T00:00:00.000Z" }],
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
      returns: [{ sale_id: "sale-2", actor_id: null, refund_amount: 5, created_at: "2026-08-05T00:00:00.000Z" }],
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
      returns: [],
      profiles: [],
    });

    const result = await getCashierRanking(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(result).toHaveLength(1);
    expect(result[0]!.cashierName).toBe("غير معروف");
  });

  it("returns an empty array when there are no sales and no returns in range", async () => {
    const supabase = createFakeSupabase({
      salesInRange: [],
      originSales: [],
      saleItems: [],
      returns: [],
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
      returns: [],
      profiles: [],
    });

    await expect(
      getCashierRanking(supabase, new Date("2026-01-01"), new Date("2026-08-01")),
    ).rejects.toThrow("المدى الزمني الأقصى المسموح به هو 90 يوماً");
  });
});
