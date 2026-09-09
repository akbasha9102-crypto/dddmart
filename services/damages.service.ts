import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { StockDamage } from "@/types/returns";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

export interface RecordDamageParams {
  productId: string;
  productName: string;
  quantity: number;
  reason: string | null;
}

/**
 * Records damaged/expired stock via the record_damage RPC, which atomically
 * row-locks the product, validates quantity against the LOCKED read,
 * decrements products.quantity, and inserts the stock_damages row — all in
 * one security-definer transaction (see
 * supabase/migrations/00000000000040_record_damage_atomic.sql). cost_price/
 * loss_amount are always computed server-side from the locked product row,
 * never trusted from a client parameter. On insufficient stock (or any
 * other RPC validation failure), the RPC raises a friendly Arabic
 * exception, which surfaces here as a thrown Error with that message —
 * nothing is inserted in that case. After a successful call, fetches the
 * product's `unit` (display-only, for the operation-log message) with one
 * lightweight follow-up read, then logs a damage_recorded operation.
 */
export async function recordDamage(
  supabase: Client,
  params: RecordDamageParams,
  actorId: string | null,
  storeId: string,
): Promise<StockDamage> {
  const { data, error } = await supabase.rpc("record_damage", {
    p_product_id: params.productId,
    p_product_name: params.productName,
    p_quantity: params.quantity,
    p_reason: params.reason,
  });
  if (error) throw error;

  const inserted = data?.[0];
  if (!inserted) {
    throw new Error("تعذر تسجيل التلف — حاول مرة أخرى");
  }

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("unit")
    .eq("id", params.productId)
    .maybeSingle();
  if (productError) throw productError;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "damage_recorded",
    entityType: "stock",
    entityId: params.productId,
    description: `تم تسجيل تلف ${inserted.quantity} ${product?.unit ?? ""} من "${inserted.product_name}" — خسارة ${inserted.loss_amount}`,
    storeId,
  });

  return inserted;
}
