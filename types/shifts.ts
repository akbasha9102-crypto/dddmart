import type { Database } from "./database.types";

export type Shift = Database["public"]["Tables"]["shifts"]["Row"];

export interface ShiftWithCashierName extends Shift {
  cashierName: string;
}
