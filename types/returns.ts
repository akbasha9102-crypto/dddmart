import type { Database } from "./database.types";

export type Return = Database["public"]["Tables"]["returns"]["Row"];
export type ReturnInsert = Database["public"]["Tables"]["returns"]["Insert"];
export type StockDamage = Database["public"]["Tables"]["stock_damages"]["Row"];
export type StockDamageInsert = Database["public"]["Tables"]["stock_damages"]["Insert"];
