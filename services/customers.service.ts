import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Customer, CustomerTransaction, CustomerUpdate, CustomerWithBalance } from "@/types/customer";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** Reads the customer_balances view (a VIEW over customer_transactions — never a stored column, see migration 00000000000011). 0 when the customer has no transactions yet (no row in the view). */
export async function getCustomerBalance(supabase: Client, customerId: string): Promise<number> {
  const { data, error } = await supabase
    .from("customer_balances")
    .select("balance")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data?.balance ?? 0;
}

export interface ListCustomersOptions {
  search?: string;
}

/** Active customers, ordered by name, each joined with its live balance. */
export async function listCustomers(supabase: Client, options?: ListCustomersOptions): Promise<CustomerWithBalance[]> {
  let query = supabase.from("customers").select("*").eq("is_active", true).order("name");

  const term = options?.search?.trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: customers, error } = await query;
  if (error) throw error;

  const rows = customers ?? [];
  if (rows.length === 0) return [];

  const { data: balances, error: balancesError } = await supabase
    .from("customer_balances")
    .select("customer_id, balance")
    .in(
      "customer_id",
      rows.map((row) => row.id),
    );
  if (balancesError) throw balancesError;

  const balanceByCustomerId = new Map<string, number>();
  (balances ?? []).forEach((row) => balanceByCustomerId.set(row.customer_id, row.balance));

  return rows.map((row) => ({ ...row, balance: balanceByCustomerId.get(row.id) ?? 0 }));
}

export interface CustomerDetail {
  customer: Customer;
  balance: number;
  transactions: CustomerTransaction[];
}

/** Full detail for the customer-detail screen: the customer row, its live balance, and its transaction history (newest first). */
export async function getCustomer(supabase: Client, id: string): Promise<CustomerDetail> {
  const { data: customer, error } = await supabase.from("customers").select("*").eq("id", id).single();
  if (error) throw error;

  const [balance, transactionsResult] = await Promise.all([
    getCustomerBalance(supabase, id),
    supabase.from("customer_transactions").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
  ]);

  if (transactionsResult.error) throw transactionsResult.error;

  return { customer, balance, transactions: transactionsResult.data ?? [] };
}

export interface CreateCustomerInput {
  name: string;
  phone?: string | null;
  creditLimit?: number;
  notes?: string | null;
}

export async function createCustomer(
  supabase: Client,
  input: CreateCustomerInput,
  actorId: string | null,
  storeId: string,
): Promise<Customer> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("اسم الزبون مطلوب");
  }

  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: trimmedName,
      phone: input.phone ?? null,
      credit_limit: input.creditLimit ?? 0,
      notes: input.notes ?? null,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "customer_created",
    entityType: "customer",
    entityId: data.id,
    description: `تم إضافة الزبون "${data.name}"`,
    storeId,
  });

  return data;
}

export async function updateCustomer(
  supabase: Client,
  id: string,
  patch: CustomerUpdate,
  actorId: string | null,
  storeId: string,
): Promise<Customer> {
  const { data, error } = await supabase.from("customers").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "customer_updated",
    entityType: "customer",
    entityId: data.id,
    description: `تم تعديل بيانات الزبون "${data.name}"`,
    storeId,
  });

  return data;
}

/** Soft delete: sets is_active = false so the customer disappears from active listings while preserving history/FKs. */
export async function archiveCustomer(supabase: Client, id: string, actorId: string | null, storeId: string): Promise<void> {
  const { data, error } = await supabase.from("customers").update({ is_active: false }).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "customer_archived",
    entityType: "customer",
    entityId: data.id,
    description: `تم أرشفة الزبون "${data.name}"`,
    storeId,
  });
}

export interface RecordPaymentInput {
  customerId: string;
  amount: number;
  note?: string | null;
}

/**
 * Records a payment against a customer's balance. Partial payments under the
 * current balance are fine; overpaying into a negative balance is rejected
 * (an Arabic error shows the actual remaining balance) — matches
 * recordReturn's validate-before-insert style in returns.service.ts.
 */
export async function recordPayment(
  supabase: Client,
  input: RecordPaymentInput,
  actorId: string | null,
  storeId: string,
): Promise<CustomerTransaction> {
  if (input.amount <= 0) {
    throw new Error("مبلغ الدفعة يجب أن يكون أكبر من صفر");
  }

  const currentBalance = await getCustomerBalance(supabase, input.customerId);
  if (input.amount > currentBalance) {
    throw new Error(`مبلغ الدفعة أكبر من الرصيد المتبقي (المتبقي: ${currentBalance})`);
  }

  const { data, error } = await supabase
    .from("customer_transactions")
    .insert({
      customer_id: input.customerId,
      type: "payment",
      amount: input.amount,
      note: input.note ?? null,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "customer_payment_recorded",
    entityType: "customer",
    entityId: input.customerId,
    description: `تم تسجيل دفعة بقيمة ${input.amount} من الزبون`,
    storeId,
  });

  return data;
}
