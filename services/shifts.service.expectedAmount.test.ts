import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCashSalesSum,
  getCashDebtPaymentsSum,
  getCashRefundsSum,
  calculateExpectedAmount,
} from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

interface SaleFixture {
  total_amount: number;
}

interface PaymentFixture {
  amount: number;
}

interface ReturnFixture {
  sale_id: string;
  refund_amount: number;
}

interface SalePaymentMethodFixture {
  id: string;
  payment_method: "cash" | "credit";
}

/**
 * Hand-rolled fake covering: sales.select().eq().eq().gte().lte() (cash
 * sales sum), customer_transactions.select().eq().eq().gte().lte() (cash
 * debt payments sum), returns.select().eq().gte().lte() (returns by actor)
 * plus sales.select().in() (resolving each return's original payment
 * method) -- matches the style of sales.service.cashier.test.ts.
 */
function createFakeSupabase(fixtures: {
  cashSales?: SaleFixture[];
  payments?: PaymentFixture[];
  returns?: ReturnFixture[];
  originSales?: SalePaymentMethodFixture[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ data: fixtures.cashSales ?? [], error: null }),
                }),
              }),
            }),
            in: async (column: string, values: string[]) => {
              if (column !== "id") throw new Error(`unexpected sales.in column ${column}`);
              const rows = (fixtures.originSales ?? []).filter((row) => values.includes(row.id));
              return { data: rows, error: null };
            },
          }),
        };
      }
      if (table === "customer_transactions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  lte: async () => ({ data: fixtures.payments ?? [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                lte: async () => ({ data: fixtures.returns ?? [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getCashSalesSum", () => {
  it("sums total_amount across the given rows", async () => {
    const supabase = createFakeSupabase({ cashSales: [{ total_amount: 1000 }, { total_amount: 2500 }] });
    expect(await getCashSalesSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z")).toBe(
      3500,
    );
  });

  it("returns 0 when there are no cash sales", async () => {
    const supabase = createFakeSupabase({ cashSales: [] });
    expect(await getCashSalesSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z")).toBe(
      0,
    );
  });
});

describe("getCashDebtPaymentsSum", () => {
  it("sums payment amounts across the given rows", async () => {
    const supabase = createFakeSupabase({ payments: [{ amount: 500 }, { amount: 1500 }] });
    expect(
      await getCashDebtPaymentsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(2000);
  });
});

describe("getCashRefundsSum", () => {
  it("only counts refunds on returns whose original sale was paid in cash", async () => {
    const supabase = createFakeSupabase({
      returns: [
        { sale_id: "sale-cash", refund_amount: 300 },
        { sale_id: "sale-credit", refund_amount: 700 },
      ],
      originSales: [
        { id: "sale-cash", payment_method: "cash" },
        { id: "sale-credit", payment_method: "credit" },
      ],
    });

    expect(
      await getCashRefundsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(300);
  });

  it("returns 0 when there are no returns", async () => {
    const supabase = createFakeSupabase({ returns: [] });
    expect(
      await getCashRefundsSum(supabase, "cashier-1", "2026-08-15T00:00:00.000Z", "2026-08-15T23:59:59.999Z"),
    ).toBe(0);
  });
});

describe("calculateExpectedAmount", () => {
  const BASE_SHIFT: Shift = {
    id: "shift-1",
    cashier_id: "cashier-1",
    store_id: "store-1",
    status: "open",
    opening_balance: 10000,
    opened_at: "2026-08-15T08:00:00.000Z",
    closed_at: null,
    expected_amount: null,
    counted_amount: null,
    difference: null,
    forced_closed_by: null,
    note: null,
    created_at: "2026-08-15T08:00:00.000Z",
  };

  it("adds opening balance + cash sales + cash debt payments, minus cash refunds", async () => {
    const supabase = createFakeSupabase({
      cashSales: [{ total_amount: 20000 }],
      payments: [{ amount: 5000 }],
      returns: [{ sale_id: "sale-cash", refund_amount: 1000 }],
      originSales: [{ id: "sale-cash", payment_method: "cash" }],
    });

    const expected = await calculateExpectedAmount(supabase, BASE_SHIFT, new Date("2026-08-15T16:00:00.000Z"));

    // 10000 + 20000 + 5000 - 1000
    expect(expected).toBe(34000);
  });

  it("returns just the opening balance when there's no activity", async () => {
    const supabase = createFakeSupabase({});
    const expected = await calculateExpectedAmount(supabase, BASE_SHIFT, new Date("2026-08-15T16:00:00.000Z"));
    expect(expected).toBe(10000);
  });

  it("returns just the opening balance when the shift's cashier_id is null (deleted profile)", async () => {
    const supabase = createFakeSupabase({ cashSales: [{ total_amount: 99999 }] });
    const expected = await calculateExpectedAmount(
      supabase,
      { ...BASE_SHIFT, cashier_id: null },
      new Date("2026-08-15T16:00:00.000Z"),
    );
    expect(expected).toBe(10000);
  });
});
