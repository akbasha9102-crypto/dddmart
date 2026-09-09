import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { HeldSale } from "@/types/heldSales";
import type { CartItem } from "@/types/pos";
import { incrementStock } from "@/services/products.service";
import { toBaseUnits } from "@/lib/units";

type Client = SupabaseClient<Database>;

export interface HoldSaleParams {
  cashierId: string | null;
  items: CartItem[];
  discountAmount: number;
  note: string | null;
  /** Set when replaying a previously-queued offline held sale so a retried replay can recognize its own prior success via a unique-constraint hit instead of inserting a duplicate row. Omitted (and left to the DB default of NULL) for a normal online hold. */
  clientLocalId?: string;
}

export interface ResumedHeldSale {
  items: CartItem[];
  discountAmount: number;
}

/**
 * Holds a sale via the hold_sale RPC, which atomically re-resolves each
 * line's unit_price/cost_price from the live products/product_units tables
 * (same resolution logic as create_sale_atomic) and derives store_id from
 * current_store_id() server-side — see
 * supabase/migrations/00000000000041_hold_sale_atomic_pricing.sql.
 * unitPrice/costPrice are deliberately NOT sent as RPC arguments at all —
 * they're server-computed and any client-supplied value would be ignored,
 * so sending them would be misleading. cashier_id remains client-supplied
 * (params.cashierId, not auth.uid()) — held sales are an intentionally
 * shared-till feature; this was audited separately and explicitly left
 * unchanged (see the migration header for details).
 *
 * As of supabase/migrations/00000000000043_hold_sale_stock_decrement.sql,
 * hold_sale ALSO atomically reserves stock per line (row-locked
 * check-and-decrement, same pattern as create_sale_atomic) — a held sale is
 * now a real commitment, not just a price-resolved snapshot. This means a
 * call to holdSale can now throw an insufficient-stock error where it never
 * could before (e.g. 'الكمية المتوفرة من ... غير كافية') — callers must
 * surface RPC errors from this function the same way they already do for
 * checkout.
 */
export async function holdSale(supabase: Client, params: HoldSaleParams, storeId: string): Promise<HeldSale> {
  const { data, error } = await supabase.rpc("hold_sale", {
    p_cashier_id: params.cashierId,
    p_items: params.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      barcode: item.barcode,
      quantity: item.quantity,
      availableStock: item.availableStock,
      unitName: item.unitName ?? null,
      unitConversionFactor: item.unitConversionFactor ?? null,
    })),
    p_discount_amount: params.discountAmount,
    p_note: params.note,
    p_client_local_id: params.clientLocalId ?? null,
  });

  if (error) throw error;

  const inserted = data?.[0];
  if (!inserted) {
    throw new Error("تعذر تعليق الفاتورة — حاول مرة أخرى");
  }

  return inserted;
}

/** All held sales, oldest first. */
export async function listHeldSales(supabase: Client): Promise<HeldSale[]> {
  const { data, error } = await supabase.from("held_sales").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Deletes a held sale, releases the stock hold_sale reserved for it (see
 * supabase/migrations/00000000000043_hold_sale_stock_decrement.sql), and
 * returns its items/discount for the caller to load into the active cart.
 * Row deleted/fetched in a single round trip via delete().select().single(),
 * matching this repo's insert().select().single() convention elsewhere.
 *
 * The release step mirrors cancelHeldSale's existing incrementStock-per-line
 * pattern below: hold_sale now genuinely decrements products.quantity per
 * line at hold time, so resuming a held sale back into the active cart must
 * give that reservation back — otherwise the resumed cart's later checkout
 * (createSale -> create_sale_atomic) would decrement the exact same stock a
 * second time. This release-then-later-redecrement is intentionally NOT one
 * atomic transaction with the resume itself (nor with the eventual
 * checkout) — same non-atomic pattern cancelHeldSale already uses
 * successfully in production; acceptable, small blast radius (a crash
 * between these two steps just leaves stock slightly over-available for a
 * moment, never under, and never silently lost).
 */
export async function resumeHeldSale(supabase: Client, id: string): Promise<ResumedHeldSale> {
  const { data, error } = await supabase.from("held_sales").delete().eq("id", id).select().single();
  if (error) throw error;

  const items = data.items as unknown as CartItem[];

  await Promise.all(
    items.map((item) => incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor))),
  );

  return {
    items,
    discountAmount: data.discount_amount,
  };
}

/**
 * Cancels/discards a held sale the customer never came back for: releases
 * the stock reservation via incrementStock per line (base-unit-converted,
 * same helper services/returns.service.ts uses), then deletes the row.
 */
export async function cancelHeldSale(supabase: Client, id: string, items: CartItem[]): Promise<void> {
  await Promise.all(
    items.map((item) => incrementStock(supabase, item.productId, toBaseUnits(item.quantity, item.unitConversionFactor))),
  );

  const { error } = await supabase.from("held_sales").delete().eq("id", id);
  if (error) throw error;
}
