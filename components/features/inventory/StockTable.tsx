"use client";

import { useState } from "react";
import type { Product } from "@/types/product";
import { isLowStock } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ConfirmInline } from "@/components/ui/ConfirmInline";

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
    <table className="w-full text-right text-sm">
      <thead className="bg-gray-100 text-gray-500">
        <tr>
          <th className="p-3 font-medium">المنتج</th>
          <th className="p-3 font-medium">الباركود</th>
          <th className="p-3 font-medium">سعر البيع</th>
          <th className="p-3 font-medium">الكمية</th>
          <th className="p-3" />
        </tr>
      </thead>
      <tbody>
        {products.map((product) => (
          <tr key={product.id} className="border-b border-gray-100">
            <td className="p-3 font-medium text-gray-900">{product.name}</td>
            <td className="p-3 font-mono text-gray-500">{product.barcode}</td>
            <td className="p-3">{formatCurrency(product.sale_price)}</td>
            <td className={cn("p-3 font-semibold", isLowStock(product) && "text-red-600")}>
              {product.quantity}
              {isLowStock(product) ? " ⚠" : ""}
            </td>
            <td className="p-3">
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
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => onEdit(product)} className="text-brand-700 hover:underline">
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(product.id)}
                    className="text-red-600 hover:underline"
                  >
                    حذف
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
