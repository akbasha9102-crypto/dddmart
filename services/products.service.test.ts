import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllProductUnits, receiveStock, recordStockPurchase, resolveBarcode } from "./products.service";
import type { Database } from "@/types/database.types";
import type { Product, ProductUnit, StockPurchase } from "@/types/product";

const BASE_PRODUCT: Product = {
  id: "product-1",
  name: "علبة علك",
  barcode: "1111",
  category_id: null,
  cost_price: 1,
  sale_price: 2,
  quantity: 50,
  min_stock_threshold: 5,
  unit: "قطعة",
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

const CARTON_UNIT: ProductUnit = {
  id: "unit-1",
  product_id: "product-1",
  unit_name: "كارتون",
  conversion_factor: 24,
  barcode: "2222",
  sale_price: 40,
  sort_order: 0,
  is_active: true,
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering only the two chains resolveBarcode actually
 * calls: products.select().eq().eq().maybeSingle() and
 * product_units.select().eq().eq().eq().maybeSingle(). Not a general
 * Supabase mock — deliberately minimal.
 */
function createFakeSupabase(options: {
  productsRow: Product | null;
  unitRow: (ProductUnit & { products: Product }) | null;
}): SupabaseClient<Database> {
  return {
    from: (table: "products" | "product_units") => {
      const result = table === "products" ? { data: options.productsRow, error: null } : { data: options.unitRow, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => result,
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("resolveBarcode", () => {
  it("returns kind 'base' when the barcode matches a product directly", async () => {
    const supabase = createFakeSupabase({ productsRow: BASE_PRODUCT, unitRow: null });
    const result = await resolveBarcode(supabase, "1111");
    expect(result).toEqual({ kind: "base", product: BASE_PRODUCT });
  });

  it("returns kind 'unit' when the barcode matches a product_units row", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: { ...CARTON_UNIT, products: BASE_PRODUCT } });
    const result = await resolveBarcode(supabase, "2222");
    expect(result).toEqual({ kind: "unit", product: BASE_PRODUCT, unit: CARTON_UNIT });
  });

  it("returns null when the barcode matches nothing", async () => {
    const supabase = createFakeSupabase({ productsRow: null, unitRow: null });
    const result = await resolveBarcode(supabase, "9999");
    expect(result).toBeNull();
  });
});

/**
 * Hand-rolled fake covering only the chain listAllProductUnits actually
 * calls: product_units.select().eq(). Not a general Supabase mock —
 * deliberately minimal, matching createFakeSupabase above.
 */
function createFakeSupabaseForUnits(units: ProductUnit[]): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: units, error: null }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("listAllProductUnits", () => {
  it("returns all active product units", async () => {
    const supabase = createFakeSupabaseForUnits([CARTON_UNIT]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([CARTON_UNIT]);
  });

  it("returns an empty array when there are none", async () => {
    const supabase = createFakeSupabaseForUnits([]);
    const result = await listAllProductUnits(supabase);
    expect(result).toEqual([]);
  });
});

const INSERTED_STOCK_PURCHASE: StockPurchase = {
  id: "purchase-1",
  product_id: "product-1",
  product_name: "علبة علك",
  quantity: 10,
  cost_price: 1.5,
  total_cost: 15,
  supplier_id: null,
  invoice_number: null,
  payment_method: null,
  actor_id: "user-1",
  store_id: "store-1",
  created_at: "",
};

/**
 * Hand-rolled fake covering receiveStock's rpc() call and
 * recordStockPurchase's follow-up inserts: stock_purchases (needs
 * .select().single(), returns insertedStockPurchase), supplier_transactions
 * (plain insert, no chain), and operations_log (plain insert). Routed by
 * table name since each needs a different chain shape. Deliberately
 * minimal, matching the other fakes in this file.
 */
function createFakeSupabaseForReceiveStock(options: {
  rpcData: Product[] | null;
  rpcError?: unknown;
  insertedStockPurchase?: StockPurchase;
}): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
  stockPurchaseInsertSpy: ReturnType<typeof vi.fn>;
  supplierTransactionInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData, error: options.rpcError ?? null }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));
  const stockPurchaseInsertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedStockPurchase ?? INSERTED_STOCK_PURCHASE, error: null }),
    }),
  }));
  const supplierTransactionInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "stock_purchases") return { insert: stockPurchaseInsertSpy };
      if (table === "supplier_transactions") return { insert: supplierTransactionInsertSpy };
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy, stockPurchaseInsertSpy, supplierTransactionInsertSpy };
}

const RECEIVED_PRODUCT: Product = { ...BASE_PRODUCT, quantity: 74, cost_price: 1.5 };

describe("receiveStock", () => {
  it("builds the correct RPC args and returns the updated product", async () => {
    const { supabase, rpcSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    const result = await receiveStock(supabase, "product-1", 24, 1.5);
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 24,
      p_unit_base_cost: 1.5,
    });
    expect(result).toEqual(RECEIVED_PRODUCT);
  });

  it("returns null when the RPC returns an empty array", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [] });
    const result = await receiveStock(supabase, "product-1", 24, 1.5);
    expect(result).toBeNull();
  });

  it("throws when the RPC returns an error", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: null, rpcError: new Error("boom") });
    await expect(receiveStock(supabase, "product-1", 24, 1.5)).rejects.toThrow("boom");
  });
});

describe("recordStockPurchase", () => {
  it("passes a base-unit purchase (factor 1) through unchanged", async () => {
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    const result = await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
      },
      "user-1",
      "store-1",
    );
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 10,
      p_unit_base_cost: 1.5,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "stock_received", user_id: "user-1", store_id: "store-1" }),
    );
    expect(result).toEqual(RECEIVED_PRODUCT);
  });

  it("multiplies quantity and divides cost for a carton purchase (factor 24)", async () => {
    const { supabase, rpcSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 2,
        unitName: "كارتون",
        conversionFactor: 24,
        costPerPurchasedUnit: 36,
      },
      "user-1",
      "store-1",
    );
    expect(rpcSpy).toHaveBeenCalledWith("receive_product_stock", {
      p_product_id: "product-1",
      p_added_base_units: 48,
      p_unit_base_cost: 1.5,
    });
  });

  it("throws a friendly Arabic error when the RPC returns no rows", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [] });
    await expect(
      recordStockPurchase(
        supabase,
        {
          productId: "product-1",
          productName: "علبة علك",
          purchasedQuantity: 10,
          unitName: null,
          conversionFactor: 1,
          costPerPurchasedUnit: 1.5,
        },
        "user-1",
        "store-1",
      ),
    ).rejects.toThrow("تعذر استلام المخزون");
  });

  it("always inserts a stock_purchases row, even with no supplier", async () => {
    const { supabase, stockPurchaseInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
      },
      "user-1",
      "store-1",
    );
    expect(stockPurchaseInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        product_id: "product-1",
        quantity: 10,
        cost_price: 1.5,
        total_cost: 15,
        supplier_id: null,
        payment_method: null,
        store_id: "store-1",
      }),
    );
  });

  it("rejects a supplier without a payment method", async () => {
    const { supabase } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await expect(
      recordStockPurchase(
        supabase,
        {
          productId: "product-1",
          productName: "علبة علك",
          purchasedQuantity: 10,
          unitName: null,
          conversionFactor: 1,
          costPerPurchasedUnit: 1.5,
          supplierId: "supplier-1",
        },
        "user-1",
        "store-1",
      ),
    ).rejects.toThrow("يجب تحديد طريقة الدفع عند اختيار مورد");
  });

  it("with a supplier and cash payment, inserts a purchase row and a matching payment row", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
        supplierId: "supplier-1",
        supplierName: "شركة الفرات",
        invoiceNumber: "INV-1",
        paymentMethod: "cash",
      },
      "user-1",
      "store-1",
    );
    expect(supplierTransactionInsertSpy).toHaveBeenCalledTimes(2);
    expect(supplierTransactionInsertSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ supplier_id: "supplier-1", type: "purchase", amount: 15, stock_purchase_id: "purchase-1" }),
    );
    expect(supplierTransactionInsertSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ supplier_id: "supplier-1", type: "payment", amount: 15, stock_purchase_id: "purchase-1" }),
    );
  });

  it("with a supplier and credit payment, inserts only a purchase row", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
        supplierId: "supplier-1",
        paymentMethod: "credit",
      },
      "user-1",
      "store-1",
    );
    expect(supplierTransactionInsertSpy).toHaveBeenCalledTimes(1);
    expect(supplierTransactionInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ supplier_id: "supplier-1", type: "purchase", amount: 15 }),
    );
  });

  it("with no supplier, never touches supplier_transactions", async () => {
    const { supabase, supplierTransactionInsertSpy } = createFakeSupabaseForReceiveStock({ rpcData: [RECEIVED_PRODUCT] });
    await recordStockPurchase(
      supabase,
      {
        productId: "product-1",
        productName: "علبة علك",
        purchasedQuantity: 10,
        unitName: null,
        conversionFactor: 1,
        costPerPurchasedUnit: 1.5,
      },
      "user-1",
      "store-1",
    );
    expect(supplierTransactionInsertSpy).not.toHaveBeenCalled();
  });
});
