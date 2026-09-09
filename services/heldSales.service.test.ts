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
  store_id: "store-1",
  created_at: "2026-08-08T10:00:00Z",
  client_local_id: null,
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
  store_id: "store-1",
  created_at: "",
  updated_at: "",
};

/**
 * Hand-rolled fake covering the exact chains heldSales.service functions
 * call: held_sales.select().order(), held_sales.delete().eq().select().single(),
 * held_sales.delete().eq(), and rpc() (hold_sale, incrementStock).
 * Deliberately minimal, matching the other fakes in this repo (see
 * returns.service.test.ts, damages.service.test.ts).
 */
function createFakeSupabase(options: {
  listedRows?: HeldSale[] | null;
  deletedRow?: HeldSale;
  rpcData?: unknown[] | null;
}): {
  supabase: SupabaseClient<Database>;
  orderSpy: ReturnType<typeof vi.fn>;
  deleteEqSpy: ReturnType<typeof vi.fn>;
  rpcSpy: ReturnType<typeof vi.fn>;
} {
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

  return { supabase, orderSpy, deleteEqSpy, rpcSpy };
}

describe("holdSale", () => {
  it("calls the hold_sale RPC with the correct fields and returns the RPC's row unmodified", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [HELD_ROW] });

    const result = await holdSale(
      supabase,
      {
        cashierId: "user-1",
        items: CART_ITEMS,
        discountAmount: 1.5,
        note: "أحمد",
      },
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith("hold_sale", {
      p_cashier_id: "user-1",
      p_items: [
        {
          productId: "product-1",
          name: "علبة علك",
          barcode: "1111",
          quantity: 3,
          availableStock: 47,
          unitName: null,
          unitConversionFactor: null,
        },
      ],
      p_discount_amount: 1.5,
      p_note: "أحمد",
      p_client_local_id: null,
    });
    expect(result).toEqual(HELD_ROW);
  });

  it("does not send unitPrice/costPrice to the RPC — price is server-resolved, not client-supplied", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [HELD_ROW] });

    await holdSale(
      supabase,
      {
        cashierId: "user-1",
        items: CART_ITEMS,
        discountAmount: 1.5,
        note: "أحمد",
      },
      "store-1",
    );

    const [, rpcArgs] = rpcSpy.mock.calls[0] as [string, { p_items: Record<string, unknown>[] }];
    for (const line of rpcArgs.p_items) {
      expect(line).not.toHaveProperty("unitPrice");
      expect(line).not.toHaveProperty("costPrice");
    }
  });

  it("passes unitName/unitConversionFactor through per-line when present on the cart item", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [HELD_ROW] });

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

    await holdSale(
      supabase,
      {
        cashierId: "user-1",
        items,
        discountAmount: 0,
        note: null,
      },
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith(
      "hold_sale",
      expect.objectContaining({
        p_items: [
          expect.objectContaining({
            unitName: "كارتون",
            unitConversionFactor: 24,
          }),
        ],
      }),
    );
  });

  it("passes client_local_id through as p_client_local_id when provided — audit item #11", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [HELD_ROW] });

    await holdSale(
      supabase,
      {
        cashierId: "user-1",
        items: CART_ITEMS,
        discountAmount: 1.5,
        note: "أحمد",
        clientLocalId: "local-held-1",
      },
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith(
      "hold_sale",
      expect.objectContaining({ p_client_local_id: "local-held-1" }),
    );
  });

  it("sends p_client_local_id: null when clientLocalId is omitted", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ rpcData: [HELD_ROW] });

    await holdSale(
      supabase,
      {
        cashierId: "user-1",
        items: CART_ITEMS,
        discountAmount: 1.5,
        note: "أحمد",
      },
      "store-1",
    );

    expect(rpcSpy).toHaveBeenCalledWith(
      "hold_sale",
      expect.objectContaining({ p_client_local_id: null }),
    );
  });

  it("throws a friendly Arabic error when the RPC returns no rows", async () => {
    const { supabase } = createFakeSupabase({ rpcData: [] });

    await expect(
      holdSale(
        supabase,
        {
          cashierId: "user-1",
          items: CART_ITEMS,
          discountAmount: 1.5,
          note: "أحمد",
        },
        "store-1",
      ),
    ).rejects.toThrow("تعذر تعليق الفاتورة");
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
    const { supabase, deleteEqSpy } = createFakeSupabase({ deletedRow: HELD_ROW, rpcData: [RESTORED_PRODUCT] });

    const result = await resumeHeldSale(supabase, "held-1");

    expect(deleteEqSpy).toHaveBeenCalledWith("id", "held-1");
    expect(result).toEqual({
      items: CART_ITEMS,
      discountAmount: 1.5,
    });
  });

  it("releases stock via incrementStock once per line item with the base-unit-converted quantity — migration 43", async () => {
    const { supabase, rpcSpy } = createFakeSupabase({ deletedRow: HELD_ROW, rpcData: [RESTORED_PRODUCT] });

    await resumeHeldSale(supabase, "held-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 3,
    });
  });

  it("converts quantity to base units per line before releasing stock", async () => {
    const heldRowWithUnit: HeldSale = {
      ...HELD_ROW,
      items: [
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
      ] as unknown as Record<string, unknown>[],
    };
    const { supabase, rpcSpy } = createFakeSupabase({ deletedRow: heldRowWithUnit, rpcData: [RESTORED_PRODUCT] });

    await resumeHeldSale(supabase, "held-1");

    expect(rpcSpy).toHaveBeenCalledWith("adjust_product_stock", {
      p_product_id: "product-1",
      p_delta: 48,
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
