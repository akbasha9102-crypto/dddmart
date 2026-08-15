import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupplierBalance,
  createSupplier,
  recordSupplierPurchase,
  recordSupplierPayment,
  linkSupplierProduct,
  unlinkSupplierProduct,
  getSupplierProducts,
} from "./suppliers.service";
import type { Database } from "@/types/database.types";
import type { Supplier, SupplierTransaction, SupplierProduct } from "@/types/supplier";

const INSERTED_SUPPLIER: Supplier = {
  id: "supplier-1",
  name: "شركة الفرات",
  phone: null,
  address: null,
  note: null,
  opening_balance: 0,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

function createFakeSupabase(options: { balance: number | null; insertedSupplier: Supplier }): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedSupplier, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "supplier_balances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.balance === null ? null : { supplier_id: "supplier-1", balance: options.balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "suppliers") {
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

describe("getSupplierBalance", () => {
  it("returns 0 when the view has no row for that supplier", async () => {
    const { supabase } = createFakeSupabase({ balance: null, insertedSupplier: INSERTED_SUPPLIER });

    const result = await getSupplierBalance(supabase, "supplier-1");

    expect(result).toBe(0);
  });

  it("returns the view's balance (including a non-zero opening balance already folded in)", async () => {
    const { supabase } = createFakeSupabase({ balance: 15000, insertedSupplier: INSERTED_SUPPLIER });

    const result = await getSupplierBalance(supabase, "supplier-1");

    expect(result).toBe(15000);
  });
});

describe("createSupplier", () => {
  it("rejects an empty name", async () => {
    const { supabase } = createFakeSupabase({ balance: 0, insertedSupplier: INSERTED_SUPPLIER });

    await expect(createSupplier(supabase, { name: "   " }, "user-1", "store-1")).rejects.toThrow("اسم المورد مطلوب");
  });

  it("inserts a supplier with a default opening_balance of 0 and logs supplier_created", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({
      balance: 0,
      insertedSupplier: INSERTED_SUPPLIER,
    });

    const result = await createSupplier(supabase, { name: "شركة الفرات" }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      name: "شركة الفرات",
      phone: null,
      address: null,
      note: null,
      opening_balance: 0,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_created" }));
    expect(result).toEqual(INSERTED_SUPPLIER);
  });

  it("passes through a non-zero opening_balance", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ balance: 0, insertedSupplier: INSERTED_SUPPLIER });

    await createSupplier(supabase, { name: "شركة الفرات", openingBalance: 25000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ opening_balance: 25000 }));
  });
});

const INSERTED_TRANSACTION: SupplierTransaction = {
  id: "txn-1",
  supplier_id: "supplier-1",
  type: "payment",
  amount: 5000,
  note: null,
  stock_purchase_id: null,
  store_id: "store-1",
  created_at: "",
};

function createFakeSupabaseForLedger(options: { balance: number | null; insertedTransaction: SupplierTransaction }): {
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
      if (table === "supplier_balances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: options.balance === null ? null : { supplier_id: "supplier-1", balance: options.balance },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "supplier_transactions") {
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

describe("recordSupplierPurchase", () => {
  it("rejects an amount of zero or less", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 0, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPurchase(supabase, { supplierId: "supplier-1", amount: 0 }, "user-1", "store-1"),
    ).rejects.toThrow("أكبر من صفر");
  });

  it("inserts a purchase transaction and logs supplier_purchase_recorded", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabaseForLedger({
      balance: 0,
      insertedTransaction: { ...INSERTED_TRANSACTION, type: "purchase", amount: 12000 },
    });

    await recordSupplierPurchase(supabase, { supplierId: "supplier-1", amount: 12000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      supplier_id: "supplier-1",
      type: "purchase",
      amount: 12000,
      note: null,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_purchase_recorded" }));
  });
});

describe("recordSupplierPayment", () => {
  it("rejects an amount of zero or less", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 10000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 0 }, "user-1", "store-1"),
    ).rejects.toThrow("أكبر من صفر");
  });

  it("rejects an amount greater than the current balance, and includes the actual remaining balance in the error", async () => {
    const { supabase } = createFakeSupabaseForLedger({ balance: 3000, insertedTransaction: INSERTED_TRANSACTION });

    await expect(
      recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 5000 }, "user-1", "store-1"),
    ).rejects.toThrow("المستحق: 3000");
  });

  it("inserts a payment transaction and logs supplier_payment_recorded on the happy path", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabaseForLedger({
      balance: 10000,
      insertedTransaction: INSERTED_TRANSACTION,
    });

    const result = await recordSupplierPayment(supabase, { supplierId: "supplier-1", amount: 5000 }, "user-1", "store-1");

    expect(insertSpy).toHaveBeenCalledWith({
      supplier_id: "supplier-1",
      type: "payment",
      amount: 5000,
      note: null,
      store_id: "store-1",
    });
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "supplier_payment_recorded" }));
    expect(result).toEqual(INSERTED_TRANSACTION);
  });
});

describe("linkSupplierProduct", () => {
  it("upserts on (supplier_id, product_id) so re-linking updates cost instead of erroring", async () => {
    const upsertedRow: SupplierProduct = {
      id: "link-1",
      supplier_id: "supplier-1",
      product_id: "product-1",
      cost_price: 1500,
      store_id: "store-1",
      created_at: "",
    };
    const upsertSpy = vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: upsertedRow, error: null }),
      }),
    }));
    const supabase = {
      from: (table: string) => {
        if (table === "supplier_products") return { upsert: upsertSpy };
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await linkSupplierProduct(supabase, { supplierId: "supplier-1", productId: "product-1", costPrice: 1500 }, "store-1");

    expect(upsertSpy).toHaveBeenCalledWith(
      { supplier_id: "supplier-1", product_id: "product-1", cost_price: 1500, store_id: "store-1" },
      { onConflict: "supplier_id,product_id" },
    );
    expect(result).toEqual(upsertedRow);
  });
});

describe("unlinkSupplierProduct", () => {
  it("deletes the join row for the given supplier/product pair", async () => {
    const eqSecondSpy = vi.fn(async () => ({ error: null }));
    const eqFirstSpy = vi.fn(() => ({ eq: eqSecondSpy }));
    const deleteSpy = vi.fn(() => ({ eq: eqFirstSpy }));
    const supabase = {
      from: (table: string) => {
        if (table === "supplier_products") return { delete: deleteSpy };
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    await unlinkSupplierProduct(supabase, "supplier-1", "product-1");

    expect(deleteSpy).toHaveBeenCalled();
    expect(eqFirstSpy).toHaveBeenCalledWith("supplier_id", "supplier-1");
    expect(eqSecondSpy).toHaveBeenCalledWith("product_id", "product-1");
  });
});
