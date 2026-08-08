import type { Database } from "./database.types";

export type HeldSale = Database["public"]["Tables"]["held_sales"]["Row"];
export type HeldSaleInsert = Database["public"]["Tables"]["held_sales"]["Insert"];
