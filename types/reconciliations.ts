import type { Database } from "./database.types";

export type StockReconciliation = Database["public"]["Tables"]["stock_reconciliations"]["Row"];
export type StockReconciliationInsert = Database["public"]["Tables"]["stock_reconciliations"]["Insert"];
