import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getShiftsForReport } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const SHIFT_A: Shift = {
  id: "shift-a",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "closed",
  opening_balance: 10000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: "2026-08-15T16:00:00.000Z",
  expected_amount: 20000,
  counted_amount: 19500,
  difference: -500,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

const SHIFT_B: Shift = { ...SHIFT_A, id: "shift-b", cashier_id: "cashier-2" };
const SHIFT_UNKNOWN_CASHIER: Shift = { ...SHIFT_A, id: "shift-c", cashier_id: "deleted-cashier" };

function createFakeSupabase(fixtures: {
  shifts: Shift[];
  profiles: { id: string; full_name: string }[];
}): SupabaseClient<Database> {
  return {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            gte: () => ({
              lte: () => ({
                order: async () => ({ data: fixtures.shifts, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: async (column: string, values: string[]) => {
              if (column !== "id") throw new Error(`unexpected profiles.in column ${column}`);
              return { data: fixtures.profiles.filter((profile) => values.includes(profile.id)), error: null };
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getShiftsForReport", () => {
  it("returns an empty array when there are no shifts in range", async () => {
    const supabase = createFakeSupabase({ shifts: [], profiles: [] });
    expect(await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"))).toEqual([]);
  });

  it("attaches each shift's cashier name via a batched profile lookup", async () => {
    const supabase = createFakeSupabase({
      shifts: [SHIFT_A, SHIFT_B],
      profiles: [
        { id: "cashier-1", full_name: "أحمد" },
        { id: "cashier-2", full_name: "سارة" },
      ],
    });

    const result = await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"));

    expect(result).toEqual([
      { ...SHIFT_A, cashierName: "أحمد" },
      { ...SHIFT_B, cashierName: "سارة" },
    ]);
  });

  it("falls back to 'غير معروف' when a cashier_id has no matching profile row", async () => {
    const supabase = createFakeSupabase({ shifts: [SHIFT_UNKNOWN_CASHIER], profiles: [] });
    const result = await getShiftsForReport(supabase, new Date("2026-08-15"), new Date("2026-08-15"));
    expect(result).toHaveLength(1);
    expect(result[0]!.cashierName).toBe("غير معروف");
  });
});
