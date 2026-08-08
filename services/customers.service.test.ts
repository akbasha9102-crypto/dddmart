import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCustomerBalance, recordPayment } from "./customers.service";
import type { Database } from "@/types/database.types";
import type { CustomerTransaction } from "@/types/customer";

const INSERTED_TRANSACTION: CustomerTransaction = {
  id: "txn-1",
  customer_id: "customer-1",
  type: "payment",
  amount: 5000,
  sale_id: null,
  note: null,
  store_id: "store-1",
  created_at: "",
};

/**
 * Hand-rolled fake covering the exact chains recordPayment/getCustomerBalance
 * call: customer_balances.select().eq().maybeSingle() (getCustomerBalance),
 * customer_transactions.insert().select().single(), and operations_log.insert()
 * (logOperation). Deliberately minimal, matching returns.service.test.ts.
 */
function createFakeSupabase(options: {
  balance: number | null;
  insertedTransaction: CustomerTransaction;
}): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedTransaction, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "customer_balances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.balance === null ? null : { customer_id: "customer-1", balance: options.balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "customer_transactions") {
        return { insert: insertSpy };
      }
      if (table === "operations_log") {
        return { insert: logInsertSpy };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, logInsertSpy };
}

describe("recordPayment", () => {
  it("rejects an amount of zero or less", async () => {
    const { supabase } = createFakeSupabase({ balance: 10000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordPayment(supabase, { customerId: "customer-1", amount: 0 }, "user-1", "store-1"),
    ).rejects.toThrow("أكبر من صفر");
  });

  it("rejects an amount greater than the current balance, and includes the actual remaining balance in the error", async () => {
    const { supabase } = createFakeSupabase({ balance: 3000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordPayment(supabase, { customerId: "customer-1", amount: 5000 }, "user-1", "store-1"),
    ).rejects.toThrow("المتبقي: 3000");
  });

  it("inserts a payment transaction and logs customer_payment_recorded on the happy path", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({
      balance: 10000,
      insertedTransaction: INSERTED_TRANSACTION,
    });

    const result = await recordPayment(supabase, { customerId: "customer-1", amount: 5000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      customer_id: "customer-1",
      type: "payment",
      amount: 5000,
      note: null,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "customer_payment_recorded" }));
    expect(result).toEqual(INSERTED_TRANSACTION);
  });
});

describe("getCustomerBalance", () => {
  it("returns 0 when the view has no row for that customer", async () => {
    const { supabase } = createFakeSupabase({ balance: null, insertedTransaction: INSERTED_TRANSACTION });

    const result = await getCustomerBalance(supabase, "customer-1");

    expect(result).toBe(0);
  });
});
