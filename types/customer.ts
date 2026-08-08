import type { Database } from "./database.types";

export type Customer = Database["public"]["Tables"]["customers"]["Row"];
export type CustomerInsert = Database["public"]["Tables"]["customers"]["Insert"];
export type CustomerUpdate = Database["public"]["Tables"]["customers"]["Update"];

export type CustomerTransaction = Database["public"]["Tables"]["customer_transactions"]["Row"];
export type CustomerTransactionInsert = Database["public"]["Tables"]["customer_transactions"]["Insert"];

export type CustomerBalance = Database["public"]["Views"]["customer_balances"]["Row"];

export interface CustomerWithBalance extends Customer {
  balance: number;
}
