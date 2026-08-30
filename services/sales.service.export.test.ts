import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSalesForExport } from "./sales.service";
import type { Database } from "@/types/database.types";
import type { Sale } from "@/types/pos";

interface ProfileFixture {
  id: string;
  full_name: string;
}

interface SaleItemFixture {
  sale_id: string;
  quantity: number;
}

/**
 * Hand-rolled fake covering exactly the chains getSalesForExport exercises:
 * sales.select().gte().lte().order(), profiles.select().in(), and
 * sale_items.select().in(). Matches the style of sales.service.reconciliation.test.ts.
 */
function createFakeSupabase(fixtures: {
  sales: Sale[];
  profiles: ProfileFixture[];
  saleItems: SaleItemFixture[];
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
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

function buildSale(overrides: Partial<Sale> = {}): Sale {
  return {
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
    ...overrides,
  };
}

describe("getSalesForExport", () => {
  it("returns invoice rows with resolved cashier name and summed item count", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: "cashier-1" })],
      profiles: [{ id: "cashier-1", full_name: "أحمد" }],
      saleItems: [
        { sale_id: "sale-1", quantity: 3 },
        { sale_id: "sale-1", quantity: 2 },
      ],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      invoiceNumber: "INV-1",
      cashierName: "أحمد",
      itemCount: 5,
      totalAmount: 100,
      discountAmount: 0,
      paymentMethod: "cash",
    });
  });

  it("falls back to 'غير معروف' when cashier_id is null", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: null })],
      profiles: [],
      saleItems: [],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.cashierName).toBe("غير معروف");
    expect(rows[0]!.itemCount).toBe(0);
  });

  it("falls back to 'غير معروف' when the profile row no longer exists", async () => {
    const supabase = createFakeSupabase({
      sales: [buildSale({ cashier_id: "deleted-cashier" })],
      profiles: [],
      saleItems: [],
    });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.cashierName).toBe("غير معروف");
  });

  it("returns an empty array without querying profiles/sale_items when there are no sales in range", async () => {
    const supabase = createFakeSupabase({ sales: [], profiles: [], saleItems: [] });

    const rows = await getSalesForExport(supabase, new Date("2026-08-01"), new Date("2026-08-14"));

    expect(rows).toEqual([]);
  });

  it("throws an Arabic error when the range exceeds MAX_RANGE_DAYS", async () => {
    const supabase = createFakeSupabase({ sales: [], profiles: [], saleItems: [] });

    await expect(
      getSalesForExport(supabase, new Date("2026-01-01"), new Date("2026-08-01")),
    ).rejects.toThrow("المدى الزمني الأقصى المسموح به هو 90 يوماً");
  });

  it("does not throw for an exact 90-day inclusive range", async () => {
    const supabase = createFakeSupabase({ sales: [], profiles: [], saleItems: [] });
    const start = new Date("2026-01-01");
    const end = new Date("2026-03-31"); // Jan(31) + Feb(28, 2026 not leap) + Mar(31) = 90 days inclusive
    await expect(getSalesForExport(supabase, start, end)).resolves.toEqual([]);
  });
});
