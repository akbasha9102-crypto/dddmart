import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** The cashier's currently open shift, or null if they don't have one. */
export async function getOpenShift(supabase: Client, cashierId: string): Promise<Shift | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("cashier_id", cashierId)
    .eq("status", "open")
    .maybeSingle();

  if (error) throw error;
  return data;
}

export interface OpenShiftParams {
  openingBalance: number;
}

/**
 * Opens a new shift for a cashier. Idempotent: if the cashier already has
 * an open shift (e.g. a refresh/re-login, or a double-submit), returns the
 * existing row instead of inserting a duplicate. The DB's partial unique
 * index (shifts_one_open_per_cashier) is the hard backstop for a genuine race.
 */
export async function openShift(
  supabase: Client,
  params: OpenShiftParams,
  cashierId: string,
  storeId: string,
): Promise<Shift> {
  const existing = await getOpenShift(supabase, cashierId);
  if (existing) return existing;

  if (params.openingBalance < 0) {
    throw new Error("الرصيد الافتتاحي يجب أن يكون صفر أو أكبر");
  }

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      cashier_id: cashierId,
      store_id: storeId,
      opening_balance: params.openingBalance,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: cashierId,
    actionType: "shift_opened",
    entityType: "shift",
    entityId: data.id,
    description: `تم فتح وردية جديدة برصيد افتتاحي ${params.openingBalance}`,
    storeId,
  });

  return data;
}
