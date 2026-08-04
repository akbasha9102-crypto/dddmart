"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { listCategories } from "@/services/categories.service";
import type { Category } from "@/types/product";
import { QuickAddProductForm } from "@/components/features/inventory/QuickAddProductForm";

export default function AddProductPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadCategories() {
      const supabase = createClient();
      const categoryList = await listCategories(supabase);
      setCategories(categoryList);
      setIsLoading(false);
    }

    void loadCategories();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">إضافة سلعة</h1>
        <Link href="/inventory" className="text-sm font-medium text-gray-600 hover:text-brand-700">
          إلغاء
        </Link>
      </div>

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : (
        <QuickAddProductForm categories={categories} />
      )}
    </div>
  );
}
