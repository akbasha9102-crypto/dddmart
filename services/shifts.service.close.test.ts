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

/**
 * Hand-rolled fake covering: rpc("close_shift_atomic", ...) (the ONLY write
 * path now — see supabase/migrations/00000000000029_atomic_shift_close.sql)
 * plus operations_log.insert() (logOperation). Matches the shape
 * established by sales.service.test.ts / returns.service.test.ts for
 * mocking .rpc() in this same remediation series.
 */
function createFakeSupabase(rpcResult: { data: Shift[] | null; error: { message: string } | null }): {
  supabase: SupabaseClient<Database>;
  rpcSpy: ReturnType<typeof vi.fn>;
  logInsertSpy: ReturnType<typeof vi.fn>;
} {
  const rpcSpy = vi.fn(async () => rpcResult);
  const logInsertSpy = vi.fn(async () => ({ data: null, error: null }));

  const supabase = {
    rpc: rpcSpy,
    from: (table: string) => {
      if (table === "operations_log") return { insert: logInsertSpy };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { supabase, rpcSpy, logInsertSpy };
}

describe("closeShift", () => {
  it("throws when the shift doesn't exist", async () => {
    const { supabase } = createFakeSupabase({ data: null, error: { message: "لم يتم العثور على الوردية" } });

    await expect(
      closeShift(supabase, { shiftId: "missing", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("لم يتم العثور على الوردية");
  });

  it("throws when the shift is already closed", async () => {
    const { supabase } = createFakeSupabase({ data: null, error: { message: "هذه الوردية مغلقة أصلاً" } });

    await expect(
      closeShift(supabase, { shiftId: "shift-1", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("مغلقة أصلاً");
  });

  it("computes a shortage difference on a normal close (counted below expected)", async () => {
    const updatedShift: Shift = {
      ...OPEN_SHIFT,
      status: "closed",
      expected_amount: 10000,
      counted_amount: 9500,
      difference: -500,
    };
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabase({ data: [updatedShift], error: null });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 9500 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(-500);
    expect(rpcSpy).toHaveBeenCalledWith("close_shift_atomic", {
      p_shift_id: "shift-1",
      p_counted_amount: 9500,
      p_is_forced: false,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "shift_closed",
        description: expect.stringContaining("المتوقع 10000، المعدود 9500، الفرق -500"),
      }),
    );
  });

  it("computes a surplus difference on a normal close (counted above expected)", async () => {
    const updatedShift: Shift = {
      ...OPEN_SHIFT,
      status: "closed",
      expected_amount: 10000,
      counted_amount: 10300,
      difference: 300,
    };
    const { supabase, rpcSpy } = createFakeSupabase({ data: [updatedShift], error: null });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: 10300 }, "cashier-1", "store-1", false);

    expect(result.difference).toBe(300);
    expect(rpcSpy).toHaveBeenCalledWith("close_shift_atomic", {
      p_shift_id: "shift-1",
      p_counted_amount: 10300,
      p_is_forced: false,
    });
  });

  it("leaves counted_amount and difference null on a forced close, and sets forced_closed_by", async () => {
    const updatedShift: Shift = {
      ...OPEN_SHIFT,
      status: "closed",
      expected_amount: 10000,
      counted_amount: null,
      difference: null,
      forced_closed_by: "admin-1",
    };
    const { supabase, rpcSpy, logInsertSpy } = createFakeSupabase({ data: [updatedShift], error: null });

    const result = await closeShift(supabase, { shiftId: "shift-1", countedAmount: null }, "admin-1", "store-1", true);

    expect(result.counted_amount).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.forced_closed_by).toBe("admin-1");
    expect(rpcSpy).toHaveBeenCalledWith("close_shift_atomic", {
      p_shift_id: "shift-1",
      p_counted_amount: null,
      p_is_forced: true,
    });
    expect(logInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: "shift_closed",
        description: expect.stringContaining("قسرياً — المتوقع 10000"),
      }),
    );
  });

  it("throws 'تعذر إغلاق الوردية' when the RPC succeeds but returns an empty array", async () => {
    const { supabase } = createFakeSupabase({ data: [], error: null });

    await expect(
      closeShift(supabase, { shiftId: "shift-1", countedAmount: 10000 }, "cashier-1", "store-1", false),
    ).rejects.toThrow("تعذر إغلاق الوردية");
  });
});
