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
 * Records a return via the record_return RPC (see
 * supabase/migrations/00000000000021_atomic_return_recording.sql), then
 * restores stock (skipped if the product was deleted — the return row is
 * still kept for the refund/audit trail). All validation (over-return
 * quantity check, refund-amount-vs-original-sale-price cap, tenant
 * check) happens atomically inside the RPC now — this function no longer
 * does its own select+insert, which is what made the old implementation
 * vulnerable to a double-count race (audit 2.3) and an inflated-refund
 * exploit (audit 2.2). RPC-before-increment is deliberate: if
 * incrementStock fails/no-ops, the return is still recorded rather than
 * silently lost. incrementStock uses product_id/quantity/
 * unit_conversion_factor from the RPC's OWN RETURNED ROW (`inserted`),
 * never from `params` -- record_return substitutes the authoritative
 * sale_items values server-side (00000000000039), so trusting `params`
 * here would silently reopen that fix at the stock-increment call site.
 */
export async function recordReturn(
  supabase: Client,
  params: RecordReturnParams,
  actorId: string | null,
  storeId: string,
): Promise<Return> {
  const { data, error } = await supabase.rpc("record_return", {
    p_sale_id: params.saleId,
    p_sale_item_id: params.saleItemId,
    p_product_id: params.productId,
    p_product_name: params.productName,
    p_quantity: params.quantity,
    p_unit_label: params.unitLabel,
    p_unit_conversion_factor: params.unitConversionFactor,
    p_refund_amount: params.refundAmount,
    p_reason: params.reason,
  });

  if (error) throw error;

  const inserted = data?.[0];
  if (!inserted) throw new Error("تعذر تسجيل الإرجاع");

  if (inserted.product_id) {
    await incrementStock(supabase, inserted.product_id, toBaseUnits(inserted.quantity, inserted.unit_conversion_factor));
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
