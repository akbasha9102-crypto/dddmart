import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSale } from "./sales.service";
import type { CartItem, CheckoutPayload } from "@/types/pos";
import type { Database } from "@/types/database.types";
import type { Sale, SaleItem } from "@/types/pos";

const BASE_ITEMS: CartItem[] = [
  { productId: "p1", name: "منتج", barcode: "1111", unitPrice: 100, costPrice: 60, quantity: 2, availableStock: 8 },
];

const BASE_PAYLOAD: CheckoutPayload = {
  items: BASE_ITEMS,
  discountAmount: 0,
  paidAmount: 200,
  cashierId: "cashier-1",
};

/**
 * Hand-rolled fake router covering the exact chains createSale calls:
 * rpc("create_sale_atomic", ...) (the ONLY write path now — see
 * supabase/migrations/00000000000027_atomic_sale_recording.sql),
 * sale_items.select().eq() (follow-up RLS-scoped fetch to assemble the
 * receipt), and operations_log.insert() (logOperation) — same multi-table
 * router shape as returns.service.test.ts.
 */
function createFakeSupabase(
  insertedSale: Sale,
  saleItems: SaleItem[] = [],
): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({ data: [insertedSale], error: null }));
  const saleItemsSelectSpy = vi.fn(() => ({
    eq: async () => ({ data: saleItems, error: null }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "sale_items_secure") return { select: saleItemsSelectSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy };
}

const CASH_SALE: Sale = {
  id: "sale-1",
  invoice_number: "INV-1",
  cashier_id: "cashier-1",
  subtotal: 200,
  discount_amount: 0,
  total_amount: 200,
  paid_amount: 200,
  change_amount: 0,
  payment_method: "cash",
  customer_id: null,
  store_id: "store-1",
  created_at: "",
};

const CREDIT_SALE: Sale = {
  ...CASH_SALE,
  payment_method: "credit",
  paid_amount: 0,
  change_amount: 0,
  customer_id: "customer-1",
};

describe("createSale — credit sale path", () => {
  it("throws when paymentMethod is credit and no customerId is provided", async () => {
    const { supabase } = createFakeSupabase(CREDIT_SALE);

    await expect(
      createSale(supabase, { ...BASE_PAYLOAD, paymentMethod: "credit" }, "store-1"),
    ).rejects.toThrow("يجب اختيار زبون");
  });

  it("calls the RPC with p_paid_amount/p_customer_id forced correctly for a credit sale", async () => {
    const { supabase, rpcSpy } = createFakeSupabase(CREDIT_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, paymentMethod: "credit", customerId: "customer-1" }, "store-1");

    expect(rpcSpy).toHaveBeenCalledWith(
      "create_sale_atomic",
      expect.objectContaining({
        p_payment_method: "credit",
        p_paid_amount: 0,
        p_customer_id: "customer-1",
      }),
    );
  });

  it("passes p_customer_id/p_payment_method through to the RPC for a credit sale (customer_transactions insert is now server-side, not observable here)", async () => {
    const { supabase, rpcSpy } = createFakeSupabase(CREDIT_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, paymentMethod: "credit", customerId: "customer-1" }, "store-1");

    expect(rpcSpy).toHaveBeenCalledWith(
      "create_sale_atomic",
      expect.objectContaining({
        p_customer_id: "customer-1",
        p_payment_method: "credit",
      }),
    );
  });

  it("regression guard: default/omitted paymentMethod calls the RPC with p_payment_method cash and p_customer_id null", async () => {
    const { supabase, rpcSpy } = createFakeSupabase(CASH_SALE);

    await createSale(supabase, BASE_PAYLOAD, "store-1");

    expect(rpcSpy).toHaveBeenCalledWith(
      "create_sale_atomic",
      expect.objectContaining({ p_payment_method: "cash", p_customer_id: null }),
    );
  });
});

describe("createSale — discount validation", () => {
  it("succeeds when discount equals subtotal exactly (boundary): RPC called with p_discount_amount = subtotal", async () => {
    const { supabase, rpcSpy } = createFakeSupabase(CASH_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, discountAmount: 200, paidAmount: 0 }, "store-1");

    expect(rpcSpy).toHaveBeenCalledWith(
      "create_sale_atomic",
      expect.objectContaining({ p_discount_amount: 200 }),
    );
  });

  it("rejects a discount slightly over subtotal with the Arabic over-subtotal error", async () => {
    const { supabase } = createFakeSupabase(CASH_SALE);

    await expect(
      createSale(supabase, { ...BASE_PAYLOAD, discountAmount: 200.01, paidAmount: 0 }, "store-1"),
    ).rejects.toThrow("قيمة الخصم أكبر من إجمالي الفاتورة");
  });

  it("rejects a negative discount with the Arabic negative-value error", async () => {
    const { supabase } = createFakeSupabase(CASH_SALE);

    await expect(
      createSale(supabase, { ...BASE_PAYLOAD, discountAmount: -1 }, "store-1"),
    ).rejects.toThrow("قيمة الخصم يجب أن تكون صفراً أو أكبر");
  });

  it("succeeds with a discount of 0 (common case): RPC called with p_discount_amount = 0", async () => {
    const { supabase, rpcSpy } = createFakeSupabase(CASH_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, discountAmount: 0 }, "store-1");

    expect(rpcSpy).toHaveBeenCalledWith(
      "create_sale_atomic",
      expect.objectContaining({ p_discount_amount: 0 }),
    );
  });
});
