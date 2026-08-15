import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Supplier, SupplierUpdate, SupplierWithBalance } from "@/types/supplier";
import { logOperation } from "@/services/archive.service";

type Client = SupabaseClient<Database>;

/** Reads the supplier_balances view (a VIEW seeded from suppliers.opening_balance and folded with supplier_transactions — never a stored column, see migration 00000000000016). 0 when the supplier row itself can't be found. */
export async function getSupplierBalance(supabase: Client, supplierId: string): Promise<number> {
  const { data, error } = await supabase
    .from("supplier_balances")
    .select("balance")
    .eq("supplier_id", supplierId)
    .maybeSingle();

  if (error) throw error;
  return data?.balance ?? 0;
}

export interface ListSuppliersOptions {
  search?: string;
}

/** Active suppliers, ordered by name, each joined with its live balance. */
export async function listSuppliers(supabase: Client, options?: ListSuppliersOptions): Promise<SupplierWithBalance[]> {
  let query = supabase.from("suppliers").select("*").eq("is_active", true).order("name");

  const term = options?.search?.trim();
  if (term) {
    query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
  }

  const { data: suppliers, error } = await query;
  if (error) throw error;

  const rows = suppliers ?? [];
  if (rows.length === 0) return [];

  const { data: balances, error: balancesError } = await supabase
    .from("supplier_balances")
    .select("supplier_id, balance")
    .in(
      "supplier_id",
      rows.map((row) => row.id),
    );
  if (balancesError) throw balancesError;

  const balanceBySupplierId = new Map<string, number>();
  (balances ?? []).forEach((row) => balanceBySupplierId.set(row.supplier_id, row.balance));

  return rows.map((row) => ({ ...row, balance: balanceBySupplierId.get(row.id) ?? 0 }));
}

export interface CreateSupplierInput {
  name: string;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  openingBalance?: number;
}

export async function createSupplier(
  supabase: Client,
  input: CreateSupplierInput,
  actorId: string | null,
  storeId: string,
): Promise<Supplier> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("اسم المورد مطلوب");
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name: trimmedName,
      phone: input.phone ?? null,
      address: input.address ?? null,
      note: input.note ?? null,
      opening_balance: input.openingBalance ?? 0,
      store_id: storeId,
    })
    .select()
    .single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_created",
    entityType: "supplier",
    entityId: data.id,
    description: `تم إضافة المورد "${data.name}"`,
    storeId,
  });

  return data;
}

export async function updateSupplier(
  supabase: Client,
  id: string,
  patch: SupplierUpdate,
  actorId: string | null,
  storeId: string,
): Promise<Supplier> {
  const { data, error } = await supabase.from("suppliers").update(patch).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_updated",
    entityType: "supplier",
    entityId: data.id,
    description: `تم تعديل بيانات المورد "${data.name}"`,
    storeId,
  });

  return data;
}

/** Soft delete: sets is_active = false so the supplier disappears from active listings while preserving its ledger history/FKs. */
export async function archiveSupplier(supabase: Client, id: string, actorId: string | null, storeId: string): Promise<void> {
  const { data, error } = await supabase.from("suppliers").update({ is_active: false }).eq("id", id).select().single();

  if (error) throw error;

  await logOperation(supabase, {
    userId: actorId,
    actionType: "supplier_archived",
    entityType: "supplier",
    entityId: data.id,
    description: `تم أرشفة المورد "${data.name}"`,
    storeId,
  });
}
