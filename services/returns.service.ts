import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Return } from "@/types/returns";
import { incrementStock } from "@/services/products.service";
import { logOperation } from "@/services/archive.service";
import { toBaseUnits } from "@/lib/units";

type Client = SupabaseClient<Database>;

/**
 * Sums returns.quantity grouped by sale_item_id for one sale — used to
 * compute each line's remaining returnable quantity
 * (originalLineQuantity - alreadyReturned).
 */
export async function getReturnedQuantitiesForSale(supabase: Client, saleId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("returns").select("sale_item_id, quantity").eq("sale_id", saleId);

  if (error) throw error;

  const totals = new Map<string, number>();
  (data ?? []).forEach((row) => {
    totals.set(row.sale_item_id, (totals.get(row.sale_item_id) ?? 0) + row.quantity);
  });
  return totals;
}

export interface RecordReturnParams {
  saleId: string;
  saleItemId: string;
  productId: string | null;
  productName: string;
  unitLabel: string | null;
  unitConversionFactor: number;
  originalLineQuantity: number;
  quantity: number;
  refundAmount: number;
  reason: string | null;
}

/**
 * Records a return: validates against over-returning a sale line, inserts
 * the returns row, then restores stock (skipped if the product was
 * deleted — the return row is still kept for the refund/audit trail).
 * Insert-before-increment is deliberate: if incrementStock fails/no-ops,
 * the return is still recorded rather than silently lost.
 */
export async function recordReturn(
  supabase: Client,
  params: RecordReturnParams,
  actorId: string | null,
  storeId: string,
): Promise<Return> {
  const { data: existingReturns, error: existingError } = await supabase
    .from("returns")
    .select("quantity")
    .eq("sale_item_id", params.saleItemId);

  if (existingError) throw existingError;

  const alreadyReturned = (existingReturns ?? []).reduce((sum, row) => sum + row.quantity, 0);
  if (alreadyReturned + params.quantity > params.originalLineQuantity) {
    throw new Error(
      `الكمية المطلوب إرجاعها أكبر من المتبقي القابل للإرجاع (المتبقي: ${params.originalLineQuantity - alreadyReturned})`,
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("returns")
    .insert({
      sale_id: params.saleId,
      sale_item_id: params.saleItemId,
      product_id: params.productId,
      product_name: params.productName,
      quantity: params.quantity,
      unit_label: params.unitLabel,
      unit_conversion_factor: params.unitConversionFactor,
      refund_amount: params.refundAmount,
      reason: params.reason,
      actor_id: actorId,
      store_id: storeId,
    })
    .select()
    .single();

  if (insertError) throw insertError;

  if (params.productId) {
    await incrementStock(supabase, params.productId, toBaseUnits(params.quantity, params.unitConversionFactor));
  }

  await logOperation(supabase, {
    userId: actorId,
    actionType: "return_created",
    entityType: "sale",
    entityId: params.saleId,
    description: `تم إرجاع ${params.quantity} من "${params.productName}" بقيمة ${params.refundAmount}`,
    storeId,
  });

  return inserted;
}
