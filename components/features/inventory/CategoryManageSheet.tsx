"use client";

import { useState } from "react";
import { Pencil, Trash2, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteCategory, updateCategory } from "@/services/categories.service";
import { useAuth } from "@/context/AuthContext";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { Category } from "@/types/product";
import { Modal } from "@/components/ui/Modal";
import { ConfirmInline } from "@/components/ui/ConfirmInline";
import { cn } from "@/lib/utils";
import { CategoryForm } from "./CategoryForm";

interface CategoryManageSheetProps {
  categories: Category[];
  onChanged: () => void;
  onClose: () => void;
}

/** Modal listing every category (including inactive) with inline edit/delete/restore actions. */
export function CategoryManageSheet({ categories, onChanged, onClose }: CategoryManageSheetProps) {
  const { user } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order);

  async function handleDelete(category: Category) {
    setBusyId(category.id);
    try {
      const supabase = createClient();
      await deleteCategory(supabase, category.id, user?.id ?? null);
      setConfirmingDeleteId(null);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestore(category: Category) {
    setBusyId(category.id);
    try {
      const supabase = createClient();
      await updateCategory(supabase, category.id, { is_active: true }, user?.id ?? null);
      onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="إدارة الأقسام">
      <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
        {sorted.map((category) => {
          const Icon = getCategoryIcon(category.icon);

          if (editingId === category.id) {
            return (
              <div key={category.id} className="rounded-lg border border-gray-200 p-3">
                <CategoryForm
                  category={category}
                  onSaved={() => {
                    setEditingId(null);
                    onChanged();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            );
          }

          if (confirmingDeleteId === category.id) {
            return (
              <div key={category.id} className="rounded-lg border border-gray-200 p-2">
                <ConfirmInline
                  message={`تأكيد حذف القسم "${category.name}"؟`}
                  confirmLabel="حذف"
                  onConfirm={() => void handleDelete(category)}
                  onCancel={() => setConfirmingDeleteId(null)}
                />
              </div>
            );
          }

          return (
            <div
              key={category.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2",
                !category.is_active && "opacity-60",
              )}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
                style={{ backgroundColor: category.color }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 truncate font-medium text-gray-900">{category.name}</span>
              {!category.is_active ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                  غير مفعّل
                </span>
              ) : null}

              {category.is_active ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditingId(category.id)}
                    className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-brand-700"
                    aria-label="تعديل"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(category.id)}
                    className="rounded-md p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                    aria-label="حذف"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busyId === category.id}
                  onClick={() => void handleRestore(category)}
                  className="rounded-md p-2 text-gray-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                  aria-label="استعادة"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
