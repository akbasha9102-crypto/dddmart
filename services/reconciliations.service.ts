import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { StockReconciliation } from "@/types/reconciliations";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

export interface RecordReconciliationParams {
  productId: string;
  productName: string;
  countedQuantity: number;
  reason: string | null;
}

/**
 * Corrects a product's stock to match a physical count. Re-fetches the
 * product's quantity/cost_price/unit fresh (not trusting a value the UI
 * opened with — stock can move between opening the form and submitting),
 * computes difference = countedQuantity - freshQuantity, and applies it
 * atomically via adjust_product_stock (which supports both directions,
 * unlike decrementStock). loss_value is only positive for a shortage
 * (difference < 0); an overage corrects the quantity but is never valued
 * as profit.
 */
export async function recordReconciliation(
  supabase: Client,
  params: RecordReconciliationParams,
  actorId: string | null,
  storeId: string,
): Promise<StockReconciliation> {
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("quantity, cost_price, unit")
    .eq("id", params.productId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error("تعذر العثور على المنتج");

  const previousQuantity = product.quantity;
  const difference = params.countedQuantity - previousQuantity;
  if (difference === 0) {
    throw new Error("لا يوجد فرق لتسجيله");
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("adjust_product_stock", {
    p_product_id: params.productId,
    p_delta: difference,
  });
  if (rpcError) throw rpcError;
  const updated = rpcData?.[0] ?? null;
  if (!updated) {
    throw new Error("تعذر تحديث المخزون — حاول مرة أخرى");
  }

  const lossValue = difference < 0 ? Math.abs(difference) * product.cost_price : 0;

  const { data: inserted, error: insertError } = await supabase
    .from("stock_reconciliations")
    .insert({
      product_id: params.productId,
      product_name: params.productName,
      unit: product.unit,
      previous_quantity: previousQuantity,
      counted_quantity: params.countedQuantity,
      difference,
      cost_price: product.cost_price,
      loss_value: lossValue,
      reason: params.reason,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();
  if (insertError) throw insertError;

  const directionLabel = difference < 0 ? `نقص ${Math.abs(difference)}` : `زيادة ${difference}`;
  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_reconciled",
    entityType: "stock",
    entityId: params.productId,
    description: `تمت تسوية "${params.productName}": من ${previousQuantity} إلى ${params.countedQuantity} (${directionLabel})${
      params.reason ? ` — السبب: ${params.reason}` : ""
    }`,
    storeId,
  });

  return inserted;
}
