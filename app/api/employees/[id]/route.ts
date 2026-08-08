import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/employees/requireAdmin";
import { isSelfLockout } from "@/lib/employees/adminCheck";

interface UpdateEmployeeBody {
  is_active?: boolean;
}

/** Admin activates/deactivates a cashier account. Deactivation is a real Supabase Auth ban (blocks login), not just a UI flag — the profiles.is_active column is updated only after the ban call succeeds. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.status === 401 ? "الرجاء تسجيل الدخول" : "ما عندك صلاحية لهذا الإجراء" },
      { status: admin.status },
    );
  }

  const { id } = await params;

  let body: UpdateEmployeeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }

  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }

  const isActive = body.is_active;
  const willDeactivate = !isActive;

  if (isSelfLockout(id, admin.userId, willDeactivate)) {
    return NextResponse.json({ error: "ما تقدر تعطّل حسابك أنت نفسك" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // createAdminClient() bypasses RLS entirely, so store isolation for this
  // route must be checked explicitly here — without this, an admin could
  // deactivate another store's employee by guessing/enumerating an id (see
  // docs/superpowers/specs/2026-08-08-multi-tenancy-foundation-design.md).
  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from("profiles")
    .select("store_id")
    .eq("id", id)
    .maybeSingle();

  if (targetProfileError) {
    console.error("[PATCH /api/employees/[id]] failed to load target profile:", targetProfileError);
    return NextResponse.json({ error: "حدث خطأ أثناء تحديث حالة الحساب" }, { status: 500 });
  }

  if (!targetProfile || targetProfile.store_id !== admin.storeId) {
    return NextResponse.json({ error: "ما عندك صلاحية لهذا الإجراء" }, { status: 403 });
  }

  const banValue = isActive ? "none" : "876000h";
  const { error: authError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: banValue });

  if (authError) {
    console.error("[PATCH /api/employees/[id]] updateUserById (ban) failed:", authError);
    return NextResponse.json({ error: "حدث خطأ أثناء تحديث حالة الحساب" }, { status: 500 });
  }

  const { error: dbError } = await adminClient.from("profiles").update({ is_active: isActive }).eq("id", id);

  if (dbError) {
    // The auth-level ban/unban already succeeded and is authoritative for
    // blocking/allowing login — the profiles flag is now out of sync with
    // it. Log loudly rather than silently swallowing this edge case.
    console.error(
      `[PATCH /api/employees/[id]] profiles.is_active update failed AFTER auth ban succeeded for user ${id}. ` +
        `Auth state is now the source of truth (is_active=${isActive}) but the DB flag was not updated:`,
      dbError,
    );
    return NextResponse.json({ error: "تم تحديث حالة الدخول لكن حدث خطأ أثناء تحديث بيانات الموظف" }, { status: 500 });
  }

  return NextResponse.json({ id, is_active: isActive }, { status: 200 });
}
