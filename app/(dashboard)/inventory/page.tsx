"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { listProducts, getLowStockProducts } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import type { Product, Category } from "@/types/product";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StockTable } from "@/components/features/inventory/StockTable";
import { ProductForm } from "@/components/features/inventory/ProductForm";

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [productList, categoryList, lowStock] = await Promise.all([
      listProducts(supabase),
      listCategories(supabase),
      getLowStockProducts(supabase),
    ]);
    setProducts(productList);
    setCategories(categoryList);
    setLowStockCount(lowStock.length);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function openCreateForm() {
    setEditingProduct(null);
    setIsFormOpen(true);
  }

  function openEditForm(product: Product) {
    setEditingProduct(product);
    setIsFormOpen(true);
  }

  function handleSaved() {
    setIsFormOpen(false);
    void loadData();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">إدارة المخزون</h1>
          {lowStockCount > 0 ? (
            <p className="mt-1 text-sm text-red-600">{lowStockCount} منتج قارب على النفاد</p>
          ) : null}
        </div>
        <Button onClick={openCreateForm}>+ منتج جديد</Button>
      </div>

      <Card className="overflow-hidden p-0">
        {isLoading ? (
          <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
        ) : (
          <StockTable products={products} onEdit={openEditForm} />
        )}
      </Card>

      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingProduct ? "تعديل المنتج" : "منتج جديد"}
      >
        <ProductForm
          product={editingProduct}
          categories={categories}
          onSaved={handleSaved}
          onCancel={() => setIsFormOpen(false)}
        />
      </Modal>
    </div>
  );
}
