import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOpenShift, openShift } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const OPEN_SHIFT: Shift = {
  id: "shift-1",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "open",
  opening_balance: 50000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: null,
  expected_amount: null,
  counted_amount: null,
  difference: null,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

/**
 * Hand-rolled fake covering the exact chains getOpenShift/openShift exercise:
 * shifts.select().eq().eq().maybeSingle() (getOpenShift) and
 * shifts.insert().select().single() plus operations_log.insert()
 * (logOperation), matching the style of reconciliations.service.test.ts.
 */
function createFakeSupabase(options: {
  openShiftRow?: Shift | null;
  insertedShift?: Shift;
}): {
  supabase: SupabaseClient<Database>;
  insertSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const insertSpy = vi.fn(() => ({
    select: () => ({
      single: async () => ({ data: options.insertedShift ?? null, error: null }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: options.openShiftRow ?? null, error: null }),
              }),
            }),
          }),
          insert: insertSpy,
        };
      }
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, insertSpy, logInsertSpy };
}

describe("getOpenShift", () => {
  it("returns null when the cashier has no open shift", async () => {
    const { supabase } = createFakeSupabase({ openShiftRow: null });
    expect(await getOpenShift(supabase, "cashier-1")).toBeNull();
  });

  it("returns the open shift row when one exists", async () => {
    const { supabase } = createFakeSupabase({ openShiftRow: OPEN_SHIFT });
    expect(await getOpenShift(supabase, "cashier-1")).toEqual(OPEN_SHIFT);
  });
});

describe("openShift", () => {
  it("rejects a negative opening balance", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ openShiftRow: null });
    await expect(openShift(supabase, { openingBalance: -1 }, "cashier-1", "store-1")).rejects.toThrow(
      "الرصيد الافتتاحي",
    );
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("creates a new shift and logs shift_opened when none is open", async () => {
    const { supabase, insertSpy, logInsertSpy } = createFakeSupabase({
      openShiftRow: null,
      insertedShift: OPEN_SHIFT,
    });

    const result = await openShift(supabase, { openingBalance: 50000 }, "cashier-1", "store-1");

    expect(result).toEqual(OPEN_SHIFT);
    expect(insertSpy).toHaveBeenCalledWith({
      cashier_id: "cashier-1",
      store_id: "store-1",
      opening_balance: 50000,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: "shift_opened", entity_id: OPEN_SHIFT.id }),
    );
  });

  it("returns the existing open shift instead of creating a duplicate", async () => {
    const { supabase, insertSpy } = createFakeSupabase({ openShiftRow: OPEN_SHIFT });

    const result = await openShift(supabase, { openingBalance: 99999 }, "cashier-1", "store-1");

    expect(result).toEqual(OPEN_SHIFT);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
