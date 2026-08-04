import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Product } from "@/types/product";
import { getLowStockProducts } from "@/services/products.service";

type Client = SupabaseClient<Database>;

/** Manual stock correction (e.g. after a physical count or damaged goods). */
export async function adjustStock(supabase: Client, productId: string, delta: number): Promise<Product> {
  const { data: current, error: fetchError } = await supabase
    .from("products")
    .select("quantity")
    .eq("id", productId)
    .single();

  if (fetchError) throw fetchError;

  const { data, error } = await supabase
    .from("products")
    .update({ quantity: Math.max(current.quantity + delta, 0) })
    .eq("id", productId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getLowStockAlerts(supabase: Client): Promise<Product[]> {
  return getLowStockProducts(supabase);
}
