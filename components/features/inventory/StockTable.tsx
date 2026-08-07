"use client";

import { useState } from "react";
import type { Product } from "@/types/product";
import { isLowStock } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { Card } from "@/components/ui/Card";

interface StockTableProps {
  products: Product[];
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

export function StockTable({ products, onEdit, onDelete }: StockTableProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (products.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا توجد منتجات بعد — أضف أول منتج</p>;
  }

  return (
    <Card className="divide-y divide-gray-100 p-0">
      {products.map((product) => (
        <div key={product.id} className="p-4">
          {confirmingId === product.id ? (
            <ConfirmInline
              message="تأكيد الحذف؟"
              confirmLabel="حذف"
              onConfirm={() => {
                setConfirmingId(null);
                onDelete(product);
              }}
              onCancel={() => setConfirmingId(null)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-gray-900">{product.name}</span>
                <span className="font-mono text-sm text-gray-500">{product.barcode}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">{formatCurrency(product.sale_price)}</span>
                <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
                  {product.quantity}
                  {isLowStock(product) ? " ⚠" : ""}
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onEdit(product)}
                  className="flex h-11 flex-1 items-center justify-center rounded-lg text-brand-700 hover:bg-brand-50"
                >
                  تعديل
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(product.id)}
                  className="flex h-11 flex-1 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"
                >
                  حذف
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
