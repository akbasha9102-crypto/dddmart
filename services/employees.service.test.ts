import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmployee, type Employee } from "./employees.service";
import type { Database } from "@/types/database.types";

const EMPLOYEE: Employee = {
  id: "employee-1",
  full_name: "أحمد الكاشير",
  role: "cashier",
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
};

/**
 * Hand-rolled fake covering the exact chain getEmployee calls:
 * profiles.select().eq().maybeSingle(). Deliberately minimal, matching
 * the other fakes in this repo (see stores.service.test.ts).
 */
function createFakeSupabaseForGetEmployee(options: { data: Employee | null; error?: unknown }): {
  supabase: SupabaseClient<Database>;
  eqSpy: ReturnType<typeof vi.fn>;
} {
  const eqSpy = vi.fn(() => ({
    maybeSingle: async () => ({ data: options.data, error: options.error ?? null }),
  }));
  const supabase = {
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: eqSpy }) };
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;
  return { supabase, eqSpy };
}

describe("getEmployee", () => {
  it("returns the row", async () => {
    const { supabase } = createFakeSupabaseForGetEmployee({ data: EMPLOYEE });

    const result = await getEmployee(supabase, "employee-1");

    expect(result).toEqual(EMPLOYEE);
  });

  it("returns null when maybeSingle yields no row", async () => {
    const { supabase } = createFakeSupabaseForGetEmployee({ data: null });

    const result = await getEmployee(supabase, "employee-1");

    expect(result).toBeNull();
  });

  it("throws when error is set", async () => {
    const { supabase } = createFakeSupabaseForGetEmployee({ data: null, error: new Error("boom") });

    await expect(getEmployee(supabase, "employee-1")).rejects.toThrow("boom");
  });
});
