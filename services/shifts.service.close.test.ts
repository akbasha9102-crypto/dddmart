import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { closeShift } from "./shifts.service";
import type { Database } from "@/types/database.types";
import type { Shift } from "@/types/shifts";

const OPEN_SHIFT: Shift = {
  id: "shift-1",
  cashier_id: "cashier-1",
  store_id: "store-1",
  status: "open",
  opening_balance: 10000,
  opened_at: "2026-08-15T08:00:00.000Z",
  closed_at: null,
  expected_amount: null,
  counted_amount: null,
  difference: null,
  forced_closed_by: null,
  note: null,
  created_at: "2026-08-15T08:00:00.000Z",
};

const CLOSED_SHIFT: Shift = { ...OPEN_SHIFT, status: "closed", closed_at: "2026-08-15T16:00:00.000Z" };

/**
 * Hand-rolled fake covering: shifts.select().eq().maybeSingle() (fetch by
 * id), shifts.update().eq().select().single(), plus the three range
 * queries calculateExpectedAmount issues (sales/customer_transactions/
 * returns, all returning empty so expected_amount == opening_balance
 * unless overridden), and operations_log.insert().
 */
function createFakeSupabase(options: {
  fetchedShift?: Shift | null;
  updatedShift?: Shift;
}): {
  supabase: SupabaseClient<Database>;
  updateSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const updateSpy = vi.fn((patch: Record<string, unknown>) => ({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: options.updatedShift ?? { ...options.fetchedShift, ...patch }, error: null }),
      }),
    }),
  }));
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    from: (table: string) => {
      if (table === "shifts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: options.fetchedShift ?? null, error: null }),
            }),
          }),
          update: updateSpy,
        };
      }
      if (table === "sales") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }) }),
            in: async () => ({ data: [], error: null }),
          }),
        };
      }
      if (table === "customer_transactions") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }) }),
          }),
        };
      }
      if (table === "returns") {
        return {
          select: () => ({
            eq: () => ({ gte: () => ({ lte: async () => ({ data: [], error: null }) }) }),
          }),
        };
      }
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, updateSpy, logInsertSpy };
}

describe("closeShift", () => {
  it("throws when the shift doesn't exist", async () => {
    const { supabase } = createFakeSupabase({ fetchedShift: null });
    await expect(
      closeShift(supabase, { shiftId: "missing", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("لم يتم العثور على الوردية");
  });

  it("throws when the shift is already closed", async () => {
    const { supabase } = createFakeSupabase({ fetchedShift: CLOSED_SHIFT });
    await expect(
      closeShift(supabase, { shiftId: "shift-1", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("مغلقة أصلاً");
  });

  it("computes a shortage difference on a normal close (counted below expected)", async () => {
    const { supabase, updateSpy, logInsertSpy } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: 9500, difference: -500 },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 9500 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(-500);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "closed", expected_amount: 10000, counted_amount: 9500, difference: -500, forced_closed_by: null }),
    );
    expect(logInsertSpy).toHaveBeenCalledWith(expect.objectContaining({ action_type: "shift_closed" }));
  });

  it("computes a surplus difference on a normal close (counted above expected)", async () => {
    const { supabase } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: 10300, difference: 300 },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 10300 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(300);
  });

  it("leaves counted_amount and difference null on a forced close, and sets forced_closed_by", async () => {
    const { supabase, updateSpy } = createFakeSupabase({
      fetchedShift: OPEN_SHIFT,
      updatedShift: { ...OPEN_SHIFT, status: "closed", expected_amount: 10000, counted_amount: null, difference: null, forced_closed_by: "admin-1" },
    });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: null }, "admin-1", "store-1", true);

    expect(result.counted_amount).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.forced_closed_by).toBe("admin-1");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ counted_amount: null, difference: null, forced_closed_by: "admin-1" }),
    );
  });
});
