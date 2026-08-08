import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/employees/requireAdmin";

interface CreateEmployeeBody {
  full_name?: string;
  email?: string;
  password?: string;
}

/** Admin creates a new cashier login account. The handle_new_user DB trigger auto-creates the matching profiles row with role: 'cashier' — this route never inserts into profiles directly. */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return NextResponse.json(
      { error: admin.status === 401 ? "الرجاء تسجيل الدخول" : "ما عندك صلاحية لهذا الإجراء" },
      { status: admin.status },
    );
  }

  let body: CreateEmployeeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بيانات الطلب غير صحيحة" }, { status: 400 });
  }

  const fullName = body.full_name?.trim();
  const email = body.email?.trim();
  const password = body.password?.trim();

  if (!fullName || !email || !password) {
    return NextResponse.json({ error: "الاسم الكامل والإيميل وكلمة المرور مطلوبين" }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, store_id: admin.storeId },
  });

  if (error) {
    console.error("[POST /api/employees] createUser failed:", error);

    if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("already been registered")) {
      return NextResponse.json({ error: "هذا الإيميل مستخدم من قبل" }, { status: 400 });
    }

    if (error.message.toLowerCase().includes("password") && error.message.toLowerCase().includes("least")) {
      return NextResponse.json({ error: "كلمة المرور قصيرة جداً، لازم تكون 6 أحرف على الأقل" }, { status: 400 });
    }

    return NextResponse.json({ error: "حدث خطأ أثناء إنشاء الحساب" }, { status: 500 });
  }

  if (!data.user) {
    console.error("[POST /api/employees] createUser returned no error but no user either");
    return NextResponse.json({ error: "حدث خطأ أثناء إنشاء الحساب" }, { status: 500 });
  }

  return NextResponse.json({ id: data.user.id, email: data.user.email, full_name: fullName }, { status: 201 });
}
