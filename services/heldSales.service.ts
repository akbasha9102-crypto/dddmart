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
}

export interface ResumedHeldSale {
  items: CartItem[];
  discountAmount: number;
}

/**
 * Holds the current cart: inserts a snapshot row. No stock action needed —
 * stock is already decremented at add-to-cart time (see hooks/usePOS.ts),
 * so the held items remain reserved exactly as they are.
 */
export async function holdSale(supabase: Client, params: HoldSaleParams): Promise<HeldSale> {
  const { data, error } = await supabase
    .from("held_sales")
    .insert({
      cashier_id: params.cashierId,
      items: params.items as unknown as Record<string, unknown>[],
      discount_amount: params.discountAmount,
      note: params.note,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** All held sales, oldest first. */
export async function listHeldSales(supabase: Client): Promise<HeldSale[]> {
  const { data, error } = await supabase.from("held_sales").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Deletes a held sale and returns its items/discount for the caller to load
 * into the active cart. Single round trip via delete().select().single(),
 * matching this repo's insert().select().single() convention elsewhere.
 * No stock action needed — items go back into the cart exactly as reserved.
 */
export async function resumeHeldSale(supabase: Client, id: string): Promise<ResumedHeldSale> {
  const { data, error } = await supabase.from("held_sales").delete().eq("id", id).select().single();
  if (error) throw error;
  return {
    items: data.items as unknown as CartItem[],
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
