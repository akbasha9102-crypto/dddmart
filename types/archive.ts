import type { Database } from "./database.types";

export type OperationLog = Database["public"]["Tables"]["operations_log"]["Row"];
export type OperationLogInsert = Database["public"]["Tables"]["operations_log"]["Insert"];
