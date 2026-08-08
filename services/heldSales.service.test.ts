import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { holdSale, listHeldSales, resumeHeldSale, cancelHeldSale } from "./heldSales.service";
import type { Database } from "@/types/database.types";
import type { HeldSale } from "@/types/heldSales";
import type { CartItem } from "@/types/pos";
import type { Product } from "@/types/product";

const CART_ITEMS: CartItem[] = [
  {
    productId: "product-1",
    name: "علبة علك",
    barcode: "1111",
    unitPrice: 2,
    costPrice: 1,
    quantity: 3,
    availableStock: 47,
  },
];

const HELD_ROW: HeldSale = {
  id: "held-1",
  cashier_id: "user-1",
  items: CART_ITEMS as unknown as Record<string, unknown>[],
  discount_amount: 1.5,
  note: "أحمد",
  created_at: "2026-08-08T10:00:00Z",
};

const RESTORED_PRODUCT: Product = {
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
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering the exact chains heldSales.service functions
 * call: held_sales.insert().select().single(), held_sales.select().order(),
 * held_sales.delete().eq().select().single(), held_sales.delete().eq(), and
 * rpc() (incrementStock). Deliberately minimal, matching the other fakes in
 * this repo (see returns.service.test.ts, damages.service.test.ts).
 */
function createFakeSupabase(options: {
  insertedRow?: HeldSale;
  listedRows?: HeldSale[] | null;
  deletedRow?: HeldSale;
  rpcData?: Product[] | null;
}): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  orderSpy: ReturnType<typeof vi.fn>;
  deleteEqSpy: ReturnType<typeof vi.fn>;
  rpcSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedRow, error: null }),
    }),
  }));
  const orderSpy = vi.fn(async () => ({ data: options.listedRows, error: null }));
  const deleteEqSpy = vi.fn((..._args: unknown[]) => ({
    select: () => ({
      single: async () => ({ data: options.deletedRow, error: null }),
    }),
    then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
  }));
  const rpcSpy = vi.fn(async () => ({ data: options.rpcData ?? null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "held_sales") {
        return {
          insert: insertSpy,
          select: () => ({
            order: orderSpy,
          }),
          delete: () => ({
            eq: deleteEqSpy,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: rpcSpy,
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, orderSpy, deleteEqSpy, rpcSpy };
}

describe("holdSale", () => {
  it("inserts with the correct fields and returns the inserted row", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ insertedRow: HELD_ROW });

    const result = await holdSale(supabase, {
      cashierId: "user-1",
      items: CART_ITEMS,
      discountAmount: 1.5,
      note: "أحمد",
    });

    expect(insertSpy).toHaveBeenCalledWith({
      cashier_id: "user-1",
      items: CART_ITEMS,
      discount_amount: 1.5,
      note: "أحمد",
    });
    expect(result).toEqual(HELD_ROW);
  });
});

describe("listHeldSales", () => {
  it("orders by created_at ascending", async () => {
    const { supabase, orderSpy } = createFakeSupabase({ listedRows: [HELD_ROW] });

    const result = await listHeldSales(supabase);

    expect(orderSpy).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([HELD_ROW]);
  });

  it("returns [] when data is null", async () => {
    const { supabase } = createFakeSupabase({ listedRows: null });

    const result = await listHeldSales(supabase);

    expect(result).toEqual([]);
  });
});

describe("resumeHeldSale", () => {
  it("calls delete().eq(id) and returns items/discountAmount parsed from the returned row", async () => {
    const { supabase, deleteEqSpy } = createFakeSupabase({ deletedRow: HELD_ROW });

    const result = await resumeHeldSale(supabase, "held-1");

    expect(deleteEqSpy).toHaveBeenCalledWith("id", "held-1");
    expect(result).toEqual({
      items: CART_ITEMS,
      discountAmount: 1.5,
    });
  });
});

describe("cancelHeldSale", () => {
  it("calls incrementStock once per line item with the base-unit-converted quantity, then deletes the row", async () => {
    const { supabase, rpcSpy, deleteEqSpy } = createFakeSupabase({ rpcData: [RESTORED_PRODUCT] });

    await cancelHeldSale(supabase, "held-1", CART_ITEMS);

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 3,
    });
    expect(deleteEqSpy).toHaveBeenCalledWith("id", "held-1");
  });

  it("converts quantity to base units per line before releasing stock", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [RESTORED_PRODUCT] });

    const items: CartItem[] = [
      {
        productId: "product-1",
        name: "علبة علك",
        barcode: "1111",
        unitPrice: 2,
        costPrice: 1,
        quantity: 2,
        availableStock: 47,
        unitName: "كارتون",
        unitConversionFactor: 24,
      },
    ];

    await cancelHeldSale(supabase, "held-1", items);

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 48,
    });
  });
});
