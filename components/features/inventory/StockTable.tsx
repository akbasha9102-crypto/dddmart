"use client";

import { useState } from "react";
import Link from "next/link";
import { PackagePlus, PackageX, ClipboardCheck } from "lucide-react";
import type { Product } from "@/types/product";
import { isLowStock } from "@/types/product";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/employees/adminCheck";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { Card } from "@/components/ui/Card";

interface StockTableProps {
  products: Product[];
  onDelete: (product: Product) => void;
  onReceiveStock: (product: Product) => void;
  onDamageStock: (product: Product) => void;
  onReconcileStock: (product: Product) => void;
}

export function StockTable({ products, onDelete, onReceiveStock, onDamageStock, onReconcileStock }: StockTableProps) {
  const { role } = useAuth();
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
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">{product.name}</span>
                <span className="shrink-0 font-mono text-sm text-gray-500">{product.barcode}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-600">{formatCurrency(product.sale_price)}</span>
                <span className={cn("font-semibold", isLowStock(product) && "text-red-600")}>
                  {product.quantity}
                  {isLowStock(product) ? " ⚠" : ""}
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                {isAdminRole(role) ? (
                  <button
                    type="button"
                    onClick={() => onReceiveStock(product)}
                    aria-label="استلام مخزون"
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50"
                  >
                    <PackagePlus className="h-4 w-4" />
                    استلام
                  </button>
                ) : null}
                {isAdminRole(role) ? (
                  <button
                    type="button"
                    onClick={() => onDamageStock(product)}
                    aria-label="تسجيل تلف"
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-orange-700 hover:bg-orange-50"
                  >
                    <PackageX className="h-4 w-4" />
                    تالف
                  </button>
                ) : null}
                {isAdminRole(role) ? (
                  <button
                    type="button"
                    onClick={() => onReconcileStock(product)}
                    aria-label="تسوية المخزون"
                    className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-indigo-700 hover:bg-indigo-50"
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    تسوية
                  </button>
                ) : null}
                <Link
                  href={`/inventory/${product.id}/edit`}
                  className="flex h-11 flex-1 items-center justify-center rounded-lg text-brand-700 hover:bg-brand-50"
                >
                  تعديل
                </Link>
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
