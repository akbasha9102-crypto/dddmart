import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { StockDamage } from "@/types/returns";
import { decrementStock } from "@/services/products.service";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

export interface RecordDamageParams {
  productId: string;
  productName: string;
  quantity: number;
  reason: string | null;
}

/**
 * Records damaged/expired stock: decrements stock FIRST (opposite order
 * from returns) so a stock_damages row can never exist without its
 * matching decrement having actually happened. Throws a friendly Arabic
 * error and inserts nothing if there isn't enough stock. cost_price is
 * snapshotted from decrementStock's own returned row (not a separate
 * fetch), so it reflects the exact cost basis at the moment of decrement.
 */
export async function recordDamage(
  supabase: Client,
  params: RecordDamageParams,
  actorId: string | null,
  storeId: string,
): Promise<StockDamage> {
  const updated = await decrementStock(supabase, params.productId, params.quantity);
  if (!updated) {
    const { data: current, error: currentError } = await supabase
      .from("products")
      .select("quantity")
      .eq("id", params.productId)
      .maybeSingle();
    if (currentError) throw currentError;
    throw new Error(`الكمية أكبر من المخزون المتوفر (المتوفر: ${current?.quantity ?? 0})`);
  }

  const costPrice = updated.cost_price;
  const lossAmount = params.quantity * costPrice;

  const { data: inserted, error: insertError } = await supabase
    .from("stock_damages")
    .insert({
      product_id: params.productId,
      product_name: params.productName,
      quantity: params.quantity,
      cost_price: costPrice,
      loss_amount: lossAmount,
      reason: params.reason,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();

  if (insertError) throw insertError;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "damage_recorded",
    entityType: "stock",
    entityId: params.productId,
    description: `تم تسجيل تلف ${params.quantity} ${updated.unit} من "${params.productName}" — خسارة ${lossAmount}`,
    storeId,
  });

  return inserted;
}
