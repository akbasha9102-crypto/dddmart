import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSaleItemRows, createSale } from "./sales.service";
import type { CartItem, CheckoutPayload } from "@/types/pos";
import type { Database } from "@/types/database.types";
import type { Sale, SaleItem } from "@/types/pos";

describe("buildSaleItemRows", () => {
  it("defaults unit_label to null and unit_conversion_factor to 1 for a base-unit sale", () => {
    const items: CartItem[] = [
      { productId: "p1", name: "منتج", barcode: "1111", unitPrice: 10, costPrice: 1, quantity: 2, availableStock: 8 },
    ];

    expect(buildSaleItemRows("sale-1", items)).toEqual([
      {
        sale_id: "sale-1",
        product_id: "p1",
        product_name: "منتج",
        barcode: "1111",
        quantity: 2,
        unit_price: 10,
        total_price: 20,
        unit_label: null,
        unit_conversion_factor: 1,
        cost_price: 1,
      },
    ]);
  });

  it("carries unitName/unitConversionFactor through for a unit sale", () => {
    const items: CartItem[] = [
      {
        productId: "p1",
        name: "منتج",
        barcode: "2222",
        unitPrice: 40,
        costPrice: 24,
        quantity: 1,
        availableStock: 8,
        unitName: "كارتون",
        unitConversionFactor: 24,
      },
    ];

    expect(buildSaleItemRows("sale-1", items)[0]).toMatchObject({
      unit_label: "كارتون",
      unit_conversion_factor: 24,
      cost_price: 24,
    });
  });
});

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
 * sales.insert().select().single(), sale_items.insert().select(),
 * customer_transactions.insert() (credit sales only), and
 * operations_log.insert() (logOperation) — same multi-table router shape as
 * returns.service.test.ts.
 */
function createFakeSupabase(insertedSale: Sale): {
  supabase: SupabaseClient<Database>;
  salesInsertSpy: ReturnType<typeof vi.fn>;
  customerTransactionsInsertSpy: ReturnType<typeof vi.fn>;
} {
  const salesInsertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: insertedSale, error: null }),
    }),
  }));
  const saleItemsInsertSpy = vi.fn(() => ({
    select: async () => ({ data: [] as SaleItem[], error: null }),
  }));
  const customerTransactionsInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "sales") return { insert: salesInsertSpy };
      if (table === "sale_items") return { insert: saleItemsInsertSpy };
      if (table === "customer_transactions") return { insert: customerTransactionsInsertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, salesInsertSpy, customerTransactionsInsertSpy };
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

  it("forces paid_amount and change_amount to 0 on the inserted sales row for a credit sale", async () => {
    const { supabase, salesInsertSpy } = createFakeSupabase(CREDIT_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, paymentMethod: "credit", customerId: "customer-1" }, "store-1");

    expect(salesInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "credit",
        paid_amount: 0,
        change_amount: 0,
        customer_id: "customer-1",
        store_id: "store-1",
      }),
    );
  });

  it("inserts a customer_transactions row (type sale, amount = total, sale_id = new sale id) for a credit sale", async () => {
    const { supabase, customerTransactionsInsertSpy } = createFakeSupabase(CREDIT_SALE);

    await createSale(supabase, { ...BASE_PAYLOAD, paymentMethod: "credit", customerId: "customer-1" }, "store-1");

    expect(customerTransactionsInsertSpy).toHaveBeenCalledWith({
      customer_id: "customer-1",
      type: "sale",
      amount: 200,
      sale_id: "sale-1",
      store_id: "store-1",
    });
  });

  it("regression guard: default/omitted paymentMethod still inserts payment_method cash and never touches customer_transactions", async () => {
    const { supabase, salesInsertSpy, customerTransactionsInsertSpy } = createFakeSupabase(CASH_SALE);

    await createSale(supabase, BASE_PAYLOAD, "store-1");

    expect(salesInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: "cash", customer_id: null, store_id: "store-1" }),
    );
    expect(customerTransactionsInsertSpy).not.toHaveBeenCalled();
  });
});
