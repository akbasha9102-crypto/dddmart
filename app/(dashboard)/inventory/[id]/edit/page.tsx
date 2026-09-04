"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getProduct } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import type { Product, Category } from "@/types/product";
import { BackButton } from "@/components/ui/BackButton";
import { ProductForm } from "@/components/features/inventory/ProductForm";

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const router = useRouter();

  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [productResult, categoryList] = await Promise.all([
      getProduct(supabase, productId),
      listCategories(supabase),
    ]);
    setProduct(productResult);
    setCategories(categoryList);
    setIsLoading(false);
  }, [productId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function handleSaved() {
    router.push("/inventory");
  }

  function handleCancel() {
    router.push("/inventory");
  }

  if (isLoading) {
    return <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>;
  }

  if (!product) {
    return <p className="p-6 text-center text-gray-400">المنتج غير موجود</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <BackButton href="/inventory" aria-label="العودة إلى المخزون" className="mb-2" />
      <h1 className="text-xl font-bold text-gray-900">تعديل المنتج</h1>
      <ProductForm product={product} categories={categories} onSaved={handleSaved} onCancel={handleCancel} />
    </div>
  );
}
