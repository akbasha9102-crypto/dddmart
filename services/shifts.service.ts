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

/** Sum of a cashier's cash-paid sales in [fromIso, toIso]. */
export async function getCashSalesSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("sales")
    .select("total_amount")
    .eq("cashier_id", cashierId)
    .eq("payment_method", "cash")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.total_amount, 0);
}

/** Sum of cash debt payments this cashier personally collected in [fromIso, toIso]. */
export async function getCashDebtPaymentsSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data, error } = await supabase
    .from("customer_transactions")
    .select("amount")
    .eq("cashier_id", cashierId)
    .eq("type", "payment")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (error) throw error;
  return (data ?? []).reduce((sum, row) => sum + row.amount, 0);
}

/**
 * Sum of refunds this cashier personally processed (returns.actor_id) in
 * [fromIso, toIso], counted ONLY when the original sale was paid in cash --
 * a return on a credit-sale item reduces the customer's debt, not the cash
 * drawer, so it's excluded. Attribution is by who PROCESSED the return
 * (actor_id), not who made the original sale, since it's whoever is
 * physically handing back the cash during their own shift.
 */
export async function getCashRefundsSum(supabase: Client, cashierId: string, fromIso: string, toIso: string): Promise<number> {
  const { data: returnsData, error: returnsError } = await supabase
    .from("returns")
    .select("sale_id, refund_amount")
    .eq("actor_id", cashierId)
    .gte("created_at", fromIso)
    .lte("created_at", toIso);

  if (returnsError) throw returnsError;
  const returns = returnsData ?? [];
  if (returns.length === 0) return 0;

  const saleIds = Array.from(new Set(returns.map((row) => row.sale_id)));
  const { data: salesData, error: salesError } = await supabase.from("sales").select("id, payment_method").in("id", saleIds);
  if (salesError) throw salesError;

  const paymentMethodBySaleId = new Map((salesData ?? []).map((sale) => [sale.id, sale.payment_method]));

  return returns.reduce((sum, row) => {
    return paymentMethodBySaleId.get(row.sale_id) === "cash" ? sum + row.refund_amount : sum;
  }, 0);
}

/**
 * How much cash SHOULD be in the drawer right now for this shift:
 * opening balance + cash sales + cash debt payments - cash refunds, all
 * attributed to the shift's cashier within [opened_at, closeTime].
 *
 * A null cashier_id (only possible if the cashier's profile was deleted
 * after the shift opened) has nothing to attribute activity to, so this
 * falls back to just the opening balance rather than querying with a null id.
 */
export async function calculateExpectedAmount(supabase: Client, shift: Shift, closeTime: Date): Promise<number> {
  if (!shift.cashier_id) return shift.opening_balance;

  const fromIso = shift.opened_at;
  const toIso = closeTime.toISOString();

  const [cashSales, cashPayments, cashRefunds] = await Promise.all([
    getCashSalesSum(supabase, shift.cashier_id, fromIso, toIso),
    getCashDebtPaymentsSum(supabase, shift.cashier_id, fromIso, toIso),
    getCashRefundsSum(supabase, shift.cashier_id, fromIso, toIso),
  ]);

  return shift.opening_balance + cashSales + cashPayments - cashRefunds;
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
  const { data: shift, error: fetchError } = await supabase.from("shifts").select("*").eq("id", params.shiftId).maybeSingle();
  if (fetchError) throw fetchError;
  if (!shift) throw new Error("لم يتم العثور على الوردية");
  if (shift.status === "closed") throw new Error("هذه الوردية مغلقة أصلاً");

  const closeTime = new Date();
  const expectedAmount = await calculateExpectedAmount(supabase, shift, closeTime);
  const countedAmount = isForced ? null : params.countedAmount;
  const difference = countedAmount === null ? null : countedAmount - expectedAmount;

  const { data: updated, error: updateError } = await supabase
    .from("shifts")
    .update({
      status: "closed",
      closed_at: closeTime.toISOString(),
      expected_amount: expectedAmount,
      counted_amount: countedAmount,
      difference,
      forced_closed_by: isForced ? actorId : null,
    })
    .eq("id", params.shiftId)
    .select()
    .single();

  if (updateError) throw updateError;

  const description = isForced
    ? `تم إغلاق وردية الكاشير قسرياً — المتوقع ${expectedAmount}`
    : `تم إغلاق وردية الكاشير — المتوقع ${expectedAmount}، المعدود ${countedAmount}، الفرق ${difference}`;

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
