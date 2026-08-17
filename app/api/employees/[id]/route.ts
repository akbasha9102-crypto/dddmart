import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/employees/requireAdmin";
import { isSelfLockout, isSelfTarget } from "@/lib/employees/adminCheck";

interface UpdateEmployeeBody {
  full_name?: string;
  email?: string;
  password?: string;
  is_active?: boolean;
}

/**
 * Admin edits a cashier's name/email, resets their password, and/or
 * activates/deactivates their account ("delete" is a relabeled deactivation
 * — see EmployeeList/ConfirmInline copy — not a real DB delete, so sales
 * history stays attributed to the account). Deactivation is a real Supabase
 * Auth ban (blocks login), not just a UI flag — the profiles.is_active
 * column is updated only after the ban call succeeds.
 */
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

  if (isSelfTarget(id, admin.userId)) {
    return NextResponse.json({ error: "ما تقدر تدير حسابك أنت نفسك من هذي الصفحة" }, { status: 403 });
  }

  if (
    body.full_name === undefined &&
    body.email === undefined &&
    body.password === undefined &&
    body.is_active === undefined
  ) {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }

  const fullName = body.full_name !== undefined ? body.full_name.trim() : undefined;
  if (fullName !== undefined && !fullName) {
    return NextResponse.json({ error: "الاسم لا يمكن أن يكون فارغاً" }, { status: 400 });
  }

  const email = body.email !== undefined ? body.email.trim() : undefined;
  if (email !== undefined && !email) {
    return NextResponse.json({ error: "الإيميل لا يمكن أن يكون فارغاً" }, { status: 400 });
  }

  const password = body.password !== undefined ? body.password.trim() : undefined;
  if (password !== undefined && password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور قصيرة جداً، لازم تكون 6 أحرف على الأقل" }, { status: 400 });
  }

  const isActive = body.is_active;
  const willDeactivate = isActive === false;

  if (isActive !== undefined && isSelfLockout(id, admin.userId, willDeactivate)) {
    return NextResponse.json({ error: "ما تقدر تعطّل حسابك أنت نفسك" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // createAdminClient() bypasses RLS entirely, so store isolation for this
  // route must be checked explicitly here — without this, an admin could
  // manage another store's employee by guessing/enumerating an id (see
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

  if (isActive !== undefined) {
    const banValue = isActive ? "none" : "876000h";
    const { error: authError } = await adminClient.auth.admin.updateUserById(id, { ban_duration: banValue });

    if (authError) {
      console.error("[PATCH /api/employees/[id]] updateUserById (ban) failed:", authError);
      return NextResponse.json({ error: "حدث خطأ أثناء تحديث حالة الحساب" }, { status: 500 });
    }
  }

  if (email !== undefined || password !== undefined) {
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(id, {
      ...(email !== undefined && { email, email_confirm: true }),
      ...(password !== undefined && { password }),
    });

    if (authUpdateError) {
      console.error("[PATCH /api/employees/[id]] updateUserById (email/password) failed:", authUpdateError);

      if (
        authUpdateError.message.toLowerCase().includes("already registered") ||
        authUpdateError.message.toLowerCase().includes("already been registered")
      ) {
        return NextResponse.json({ error: "هذا الإيميل مستخدم من قبل" }, { status: 400 });
      }

      if (authUpdateError.message.toLowerCase().includes("password") && authUpdateError.message.toLowerCase().includes("least")) {
        return NextResponse.json({ error: "كلمة المرور قصيرة جداً، لازم تكون 6 أحرف على الأقل" }, { status: 400 });
      }

      return NextResponse.json({ error: "حدث خطأ أثناء تحديث بيانات الحساب" }, { status: 500 });
    }
  }

  const profileUpdate: { full_name?: string; is_active?: boolean } = {};
  if (fullName !== undefined) profileUpdate.full_name = fullName;
  if (isActive !== undefined) profileUpdate.is_active = isActive;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: dbError } = await adminClient.from("profiles").update(profileUpdate).eq("id", id);

    if (dbError) {
      // The auth-level changes already succeeded and are authoritative —
      // the profiles row is now out of sync with them. Log loudly rather
      // than silently swallowing this edge case.
      console.error(
        `[PATCH /api/employees/[id]] profiles update failed AFTER auth changes succeeded for user ${id}. ` +
          `Auth state is now the source of truth but the DB row was not updated:`,
        dbError,
      );

      const onlyIsActive = isActive !== undefined && fullName === undefined && email === undefined && password === undefined;
      return NextResponse.json(
        {
          error: onlyIsActive
            ? "تم تحديث حالة الدخول لكن حدث خطأ أثناء تحديث بيانات الموظف"
            : "تم تحديث الحساب في نظام الدخول لكن حدث خطأ أثناء تحديث بيانات الموظف",
        },
        { status: 500 },
      );
    }
  }

  const responseBody: { id: string; full_name?: string; email?: string; is_active?: boolean } = { id };
  if (fullName !== undefined) responseBody.full_name = fullName;
  if (email !== undefined) responseBody.email = email;
  if (isActive !== undefined) responseBody.is_active = isActive;

  return NextResponse.json(responseBody, { status: 200 });
}
