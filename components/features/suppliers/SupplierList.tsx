"use client";

import { Pencil } from "lucide-react";
import type { SupplierWithBalance } from "@/types/supplier";
import { formatCurrency, cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface SupplierListProps {
  suppliers: SupplierWithBalance[];
  onSelect: (supplier: SupplierWithBalance) => void;
  onEdit: (supplier: SupplierWithBalance) => void;
}

/** Presentational list of suppliers — mirrors CustomerList's Card/divide layout. Clicking a row (not the pencil) selects the supplier for detail view. */
export function SupplierList({ suppliers, onSelect, onEdit }: SupplierListProps) {
  if (suppliers.length === 0) {
    return <p className="p-6 text-center text-gray-400">لا يوجد موردون بعد</p>;
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {suppliers.map((supplier) => (
          <div
            key={supplier.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(supplier)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSelect(supplier);
            }}
            className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:bg-gray-50"
          >
            <div className="flex flex-col gap-1">
              <p className="font-medium text-gray-900">{supplier.name}</p>
              {supplier.phone ? <p className="text-xs text-gray-500">{supplier.phone}</p> : null}
            </div>

            <div className="flex items-center gap-3">
              <span className={cn("text-sm font-semibold", supplier.balance > 0 ? "text-red-600" : "text-gray-900")}>
                {formatCurrency(supplier.balance)}
              </span>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(supplier);
                }}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="تعديل"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
