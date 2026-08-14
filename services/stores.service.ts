import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Client = SupabaseClient<Database>;

export interface Store {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

export interface StoreUpdate {
  name?: string;
  phone?: string | null;
  address?: string | null;
}

/** Fetches the store's own name/phone/address for the /settings/store screen. */
export async function getStore(supabase: Client, storeId: string): Promise<Store | null> {
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, phone, address")
    .eq("id", storeId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Admin-only edit of the store's own name/phone/address. Relies on the "store admin update own store" RLS policy + column grant (migration 00000000000015) — no API route needed, this is a plain table update. */
export async function updateStore(supabase: Client, storeId: string, updates: StoreUpdate): Promise<Store> {
  const { data, error } = await supabase
    .from("stores")
    .update(updates)
    .eq("id", storeId)
    .select("id, name, phone, address")
    .single();

  if (error) throw error;
  return data;
}
