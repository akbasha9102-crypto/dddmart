import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OperationActionType, OperationEntityType } from "@/types/database.types";
import type { OperationLog, OperationLogWithActor } from "@/types/archive";

type Client = SupabaseClient<Database>;

export interface LogOperationInput {
  userId: string | null;
  actionType: OperationActionType;
  entityType: OperationEntityType;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
  storeId: string;
}

/**
 * Records an entry in the operations_log audit trail.
 *
 * Deliberate deviation from this repo's usual "throw on error" service
 * convention: a logging failure is swallowed here (caught + console.error)
 * instead of thrown. logOperation is always called *after* the primary
 * mutation it describes has already succeeded (e.g. a product delete) —
 * if the log insert itself fails, that must never bubble up and make the
 * already-successful primary action look like it failed to the user.
 */
export async function logOperation(supabase: Client, input: LogOperationInput): Promise<void> {
  try {
    const { error } = await supabase.from("operations_log").insert({
      user_id: input.userId,
      action_type: input.actionType,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      description: input.description,
      metadata: input.metadata ?? {},
      store_id: input.storeId,
    });

    if (error) throw error;
  } catch (error) {
    console.error("logOperation failed:", error);
  }
}

export interface ArchiveFilter {
  startDate?: Date;
  endDate?: Date;
  actionType?: OperationActionType;
  entityType?: OperationEntityType;
}

export async function listOperations(supabase: Client, filter?: ArchiveFilter): Promise<OperationLogWithActor[]> {
  let query = supabase.from("operations_log").select("*").order("created_at", { ascending: false });

  if (filter?.startDate) query = query.gte("created_at", filter.startDate.toISOString());
  if (filter?.endDate) query = query.lte("created_at", filter.endDate.toISOString());
  if (filter?.actionType) query = query.eq("action_type", filter.actionType);
  if (filter?.entityType) query = query.eq("entity_type", filter.entityType);

  const { data, error } = await query;

  if (error) throw error;

  const operations: OperationLog[] = data ?? [];

  const userIds = Array.from(
    new Set(operations.map((op) => op.user_id).filter((id): id is string => id !== null)),
  );

  const actorNameById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);
    if (profilesError) throw profilesError;
    (profiles ?? []).forEach((profile) => actorNameById.set(profile.id, profile.full_name));
  }

  return operations.map((op) => ({
    ...op,
    actorName: op.user_id ? (actorNameById.get(op.user_id) ?? "غير معروف") : "غير معروف",
  }));
}
