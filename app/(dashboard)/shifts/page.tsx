"use client";

import { useAuth } from "@/context/AuthContext";
import { BackToSettingsLink } from "@/components/shared/BackToSettingsLink";
import { ShiftsList } from "@/components/features/shifts/ShiftsList";

export default function ShiftsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
        <p className="text-lg font-semibold text-gray-900">هذي الصفحة للمالك فقط</p>
        <p className="text-sm text-gray-500">ما عندك صلاحية الوصول لتقرير الورديات.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <BackToSettingsLink />
      <h1 className="text-xl font-bold text-gray-900">الورديات</h1>
      <ShiftsList />
    </div>
  );
}
