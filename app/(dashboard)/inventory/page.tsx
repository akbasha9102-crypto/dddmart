"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { listProducts, listProductsWithCategory, getLowStockProducts } from "@/services/products.service";
import { listCategories } from "@/services/categories.service";
import type { Product, ProductWithCategory, Category } from "@/types/product";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { StockTable } from "@/components/features/inventory/StockTable";
import { CategoryProductList } from "@/components/features/inventory/CategoryProductList";
import { ProductForm } from "@/components/features/inventory/ProductForm";
import { AddCategoryForm } from "@/components/features/inventory/AddCategoryForm";

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsWithCategory, setProductsWithCategory] = useState<ProductWithCategory[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAddChoiceOpen, setIsAddChoiceOpen] = useState(false);
  const [isCategoryFormOpen, setIsCategoryFormOpen] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const [productList, groupedProducts, categoryList, lowStock] = await Promise.all([
      listProducts(supabase),
      listProductsWithCategory(supabase),
      listCategories(supabase),
      getLowStockProducts(supabase),
    ]);
    setProducts(productList);
    setProductsWithCategory(groupedProducts);
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

  function handleCategorySaved() {
    setIsCategoryFormOpen(false);
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
        <div className="flex gap-2">
          <Button variant="secondary" className="hidden md:inline-flex" onClick={openCreateForm}>
            إضافة تفصيلية
          </Button>
          <Button onClick={() => setIsAddChoiceOpen(true)}>+ إضافة</Button>
        </div>
      </div>

      {isLoading ? (
        <p className="p-6 text-center text-gray-400">جارٍ التحميل...</p>
      ) : (
        <>
          <div className="md:hidden">
            <CategoryProductList products={productsWithCategory} categories={categories} />
          </div>
          <Card className="hidden overflow-hidden p-0 md:block">
            <StockTable products={products} onEdit={openEditForm} />
          </Card>
        </>
      )}

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

      <Modal open={isAddChoiceOpen} onClose={() => setIsAddChoiceOpen(false)} title="ماذا تريد أن تضيف؟">
        <div className="flex flex-col gap-3">
          <Link href="/inventory/add" onClick={() => setIsAddChoiceOpen(false)}>
            <Button size="lg" className="w-full">
              ➕ عنصر جديد
            </Button>
          </Link>
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={() => {
              setIsAddChoiceOpen(false);
              setIsCategoryFormOpen(true);
            }}
          >
            ➕ قسم جديد
          </Button>
        </div>
      </Modal>

      <Modal open={isCategoryFormOpen} onClose={() => setIsCategoryFormOpen(false)} title="قسم جديد">
        <AddCategoryForm onSaved={handleCategorySaved} onCancel={() => setIsCategoryFormOpen(false)} />
      </Modal>
    </div>
  );
}
