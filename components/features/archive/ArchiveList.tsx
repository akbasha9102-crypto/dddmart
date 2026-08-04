"use client";

import { Pencil, Plus, ShoppingCart, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { OperationLog } from "@/types/archive";
import type { OperationActionType } from "@/types/database.types";
import { formatDateTime } from "@/lib/utils";
import { Card } from "@/components/ui/Card";

interface ArchiveListProps {
  operations: OperationLog[];
}

/** Small icon map keyed by action_type — distinct from the category icon system. */
const ACTION_ICON_MAP: Record<OperationActionType, LucideIcon> = {
  sale_created: ShoppingCart,
  product_created: Plus,
  product_updated: Pencil,
  product_deleted: Trash2,
  category_created: Plus,
  category_updated: Pencil,
  category_deleted: Trash2,
  stock_adjusted: Pencil,
};

/** Chronological (newest first) list of logged operations — a list rather than a table since Arabic sentences vary in length. */
export function ArchiveList({ operations }: ArchiveListProps) {
  if (operations.length === 0) {
    return (
      <Card>
        <p className="p-6 text-center text-gray-400">لا توجد عمليات مسجلة</p>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <div className="flex flex-col divide-y divide-gray-100">
        {operations.map((operation) => {
          const Icon = ACTION_ICON_MAP[operation.action_type] ?? Pencil;
          return (
            <div key={operation.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                <Icon className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{operation.description}</p>
                <p className="mt-0.5 text-xs text-gray-400">{formatDateTime(operation.created_at)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
