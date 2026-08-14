import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listOperations } from "./archive.service";
import type { Database } from "@/types/database.types";
import type { OperationLog } from "@/types/archive";

interface ProfileFixture {
  id: string;
  full_name: string;
}

/**
 * Hand-rolled fake covering exactly the chains listOperations exercises when
 * called without a filter: operations_log.select().order(), and
 * profiles.select().in(). Matches the style of sales.service.export.test.ts.
 */
function createFakeSupabase(fixtures: { operations: OperationLog[]; profiles: ProfileFixture[] }): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "operations_log") {
        const result = { data: fixtures.operations, error: null };
        return { select: () => ({ order: () => Promise.resolve(result) }) };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column === "id") {
                const rows = fixtures.profiles.filter((profile) => values.includes(profile.id));
                return { data: rows, error: null };
              }
              throw new Error(`unexpected profiles.in column ${column}`);
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

function buildOperation(overrides: Partial<OperationLog> = {}): OperationLog {
  return {
    id: "op-1",
    user_id: "u1",
    action_type: "product_created",
    entity_type: "product",
    entity_id: "prod-1",
    description: "تم إضافة منتج جديد",
    metadata: {},
    store_id: "store-1",
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("listOperations", () => {
  it("resolves actor name from user_id and preserves all original OperationLog fields", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: "u1" })],
      profiles: [{ id: "u1", full_name: "أحمد" }],
    });

    const result = await listOperations(supabase);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "op-1",
      description: "تم إضافة منتج جديد",
      created_at: "2026-08-10T00:00:00.000Z",
      action_type: "product_created",
      entity_type: "product",
      entity_id: "prod-1",
      store_id: "store-1",
    });
    expect(result[0]!.actorName).toBe("أحمد");
  });

  it("falls back to 'غير معروف' when user_id is null", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: null })],
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result).toHaveLength(1);
    expect(result[0]!.actorName).toBe("غير معروف");
  });

  it("falls back to 'غير معروف' when the profile row no longer exists", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: "deleted" })],
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result).toHaveLength(1);
    expect(result[0]!.actorName).toBe("غير معروف");
  });

  it("skips the profiles query when every operation has a null user_id", async () => {
    const throwingSupabase = {
      from: (table: string) => {
        if (table === "operations_log") {
          const result = {
            data: [buildOperation({ id: "op-1", user_id: null }), buildOperation({ id: "op-2", user_id: null })],
            error: null,
          };
          return { select: () => ({ order: () => Promise.resolve(result) }) };
        }
        if (table === "profiles") {
          throw new Error("profiles should not be queried when there are no user_ids");
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await listOperations(throwingSupabase);

    expect(result).toHaveLength(2);
    expect(result.every((op) => op.actorName === "غير معروف")).toBe(true);
  });
});
