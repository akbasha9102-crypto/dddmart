import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARCHIVE_PAGE_SIZE, listOperations } from "./archive.service";
import type { Database } from "@/types/database.types";
import type { OperationLog } from "@/types/archive";

interface ProfileFixture {
  id: string;
  full_name: string;
}

type OrderCall = { column: string; ascending: boolean };

/**
 * Hand-rolled fake covering exactly the chains listOperations exercises when
 * called without a filter: operations_log.select().order().order().range(),
 * and profiles.select().in(). Matches the style of sales.service.export.test.ts.
 *
 * `.range(from, to)` is the thenable that resolves, mirroring the real
 * Supabase builder shape. It slices `fixtures.operations` by [from, to]
 * inclusive so tests can assert real pagination slicing. Each `.order()`
 * call is recorded into `orderCalls` (when provided) so tests can assert
 * ordering args.
 */
function createFakeSupabase(
  fixtures: { operations: OperationLog[]; profiles: ProfileFixture[] },
  orderCalls?: OrderCall[],
): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "operations_log") {
        return {
          select: () => ({
            order: (column: string, opts: { ascending: boolean }) => {
              orderCalls?.push({ column, ascending: opts.ascending });
              return {
                order: (column2: string, opts2: { ascending: boolean }) => {
                  orderCalls?.push({ column: column2, ascending: opts2.ascending });
                  return {
                    range: (from: number, to: number) =>
                      Promise.resolve({ data: fixtures.operations.slice(from, to + 1), error: null }),
                  };
                },
              };
            },
          }),
        };
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

function buildOperations(count: number): OperationLog[] {
  return Array.from({ length: count }, (_, index) => buildOperation({ id: `op-${index + 1}` }));
}

describe("listOperations", () => {
  it("resolves actor name from user_id and preserves all original OperationLog fields", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: "u1" })],
      profiles: [{ id: "u1", full_name: "أحمد" }],
    });

    const result = await listOperations(supabase);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({
      id: "op-1",
      description: "تم إضافة منتج جديد",
      created_at: "2026-08-10T00:00:00.000Z",
      action_type: "product_created",
      entity_type: "product",
      entity_id: "prod-1",
      store_id: "store-1",
    });
    expect(result.operations[0]!.actorName).toBe("أحمد");
  });

  it("falls back to 'غير معروف' when user_id is null", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: null })],
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.actorName).toBe("غير معروف");
  });

  it("falls back to 'غير معروف' when the profile row no longer exists", async () => {
    const supabase = createFakeSupabase({
      operations: [buildOperation({ user_id: "deleted" })],
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.actorName).toBe("غير معروف");
  });

  it("skips the profiles query when every operation has a null user_id", async () => {
    const throwingSupabase = {
      from: (table: string) => {
        if (table === "operations_log") {
          const result = {
            data: [buildOperation({ id: "op-1", user_id: null }), buildOperation({ id: "op-2", user_id: null })],
            error: null,
          };
          return {
            select: () => ({
              order: () => ({
                order: () => ({
                  range: () => Promise.resolve(result),
                }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          throw new Error("profiles should not be queried when there are no user_ids");
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await listOperations(throwingSupabase);

    expect(result.operations).toHaveLength(2);
    expect(result.operations.every((op) => op.actorName === "غير معروف")).toBe(true);
  });

  it("returns hasMore: true when a full page comes back", async () => {
    const supabase = createFakeSupabase({
      operations: buildOperations(ARCHIVE_PAGE_SIZE),
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result.operations).toHaveLength(ARCHIVE_PAGE_SIZE);
    expect(result.hasMore).toBe(true);
  });

  it("returns hasMore: false when fewer than a full page comes back", async () => {
    const supabase = createFakeSupabase({
      operations: buildOperations(3),
      profiles: [],
    });

    const result = await listOperations(supabase);

    expect(result.operations).toHaveLength(3);
    expect(result.hasMore).toBe(false);
  });

  it("requests the correct from/to range for a given page", async () => {
    let capturedFrom: number | undefined;
    let capturedTo: number | undefined;

    const supabase = {
      from: (table: string) => {
        if (table === "operations_log") {
          return {
            select: () => ({
              order: () => ({
                order: () => ({
                  range: (from: number, to: number) => {
                    capturedFrom = from;
                    capturedTo = to;
                    return Promise.resolve({ data: [], error: null });
                  },
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    await listOperations(supabase, { page: 1 });

    expect(capturedFrom).toBe(50);
    expect(capturedTo).toBe(99);
  });

  it("orders by created_at desc then id desc", async () => {
    const orderCalls: OrderCall[] = [];
    const supabase = createFakeSupabase({ operations: [], profiles: [] }, orderCalls);

    await listOperations(supabase);

    expect(orderCalls).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });
});
