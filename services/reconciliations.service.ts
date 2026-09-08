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
 * Corrects a product's stock to match a physical count, atomically via the
 * record_reconciliation RPC (security definer). The RPC row-locks the
 * product, derives previous_quantity/cost_price/unit from that locked read
 * (not a value this function read earlier), computes
 * difference = countedQuantity - lockedQuantity, and sets quantity
 * directly to countedQuantity — all inside one lock, so a concurrent
 * sale/return between "open the form" and "submit" cannot make the final
 * quantity diverge from what was physically counted (closes a TOCTOU race
 * the old two-step read-then-adjust_product_stock version had). actor_id/
 * store_id are derived server-side from auth.uid()/current_store_id()
 * inside the RPC, not sent as arguments. loss_value is only positive for a
 * shortage (difference < 0); an overage corrects the quantity but is never
 * valued as profit. See
 * supabase/migrations/00000000000036_atomic_stock_reconciliation.sql.
 */
export async function recordReconciliation(
  supabase: Client,
  params: RecordReconciliationParams,
  actorId: string | null,
  storeId: string,
): Promise<StockReconciliation> {
  const { data, error } = await supabase.rpc("record_reconciliation", {
    p_product_id: params.productId,
    p_product_name: params.productName,
    p_counted_quantity: params.countedQuantity,
    p_reason: params.reason,
  });
  if (error) throw error;
  const inserted = data?.[0];
  if (!inserted) {
    throw new Error("تعذر تسجيل التسوية — حاول مرة أخرى");
  }

  const directionLabel =
    inserted.difference < 0 ? `نقص ${Math.abs(inserted.difference)}` : `زيادة ${inserted.difference}`;
  await logOperation(supabase, {
    userId: actorId,
    actionType: "stock_reconciled",
    entityType: "stock",
    entityId: params.productId,
    description: `تمت تسوية "${params.productName}": من ${inserted.previous_quantity} إلى ${inserted.counted_quantity} (${directionLabel})${
      params.reason ? ` — السبب: ${params.reason}` : ""
    }`,
    storeId,
  });

  return inserted;
}
