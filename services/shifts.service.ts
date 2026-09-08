import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Shift, ShiftWithCashierName } from "@/types/shifts";
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

export interface CloseShiftParams {
  shiftId: string;
  /** The physically counted cash amount. Must be null when isForced is true (nobody counted it). */
  countedAmount: number | null;
}

/**
 * Closes a shift. A normal close (isForced = false) requires a
 * countedAmount and computes the shortage/surplus difference. A forced
 * close (an admin closing a shift the cashier left open) leaves
 * counted_amount/difference null -- nobody physically counted the drawer
 * -- and records forced_closed_by instead.
 */
export async function closeShift(
  supabase: Client,
  params: CloseShiftParams,
  actorId: string | null,
  storeId: string,
  isForced: boolean,
): Promise<Shift> {
  const { data, error } = await supabase.rpc("close_shift_atomic", {
    p_shift_id: params.shiftId,
    p_counted_amount: params.countedAmount,
    p_is_forced: isForced,
  });

  if (error) throw error;
  const updated = data?.[0];
  if (!updated) throw new Error("تعذر إغلاق الوردية");

  const description = isForced
    ? `تم إغلاق وردية الكاشير قسرياً — المتوقع ${updated.expected_amount}`
    : `تم إغلاق وردية الكاشير — المتوقع ${updated.expected_amount}، المعدود ${updated.counted_amount}، الفرق ${updated.difference}`;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "shift_closed",
    entityType: "shift",
    entityId: params.shiftId,
    description,
    storeId,
  });

  return updated;
}

/**
 * All shifts opened in [startDate, endDate], newest first, with each
 * cashier's name resolved via a batched profiles lookup -- same
 * "غير معروف" fallback convention used by getSalesForExport/getCashierRanking/listOperations.
 */
export async function getShiftsForReport(supabase: Client, startDate: Date, endDate: Date): Promise<ShiftWithCashierName[]> {
  const { data: shiftsData, error } = await supabase
    .from("shifts")
    .select("*")
    .gte("opened_at", startDate.toISOString())
    .lte("opened_at", endDate.toISOString())
    .order("opened_at", { ascending: false });

  if (error) throw error;
  const shifts = shiftsData ?? [];
  if (shifts.length === 0) return [];

  const cashierIds = Array.from(new Set(shifts.map((shift) => shift.cashier_id).filter((id): id is string => id !== null)));
  const nameById = new Map<string, string>();
  if (cashierIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase.from("profiles").select("id, full_name").in("id", cashierIds);
    if (profilesError) throw profilesError;
    (profiles ?? []).forEach((profile) => nameById.set(profile.id, profile.full_name));
  }

  return shifts.map((shift) => ({
    ...shift,
    cashierName: shift.cashier_id ? (nameById.get(shift.cashier_id) ?? "غير معروف") : "غير معروف",
  }));
}
