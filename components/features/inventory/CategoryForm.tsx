"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createCategory, updateCategory } from "@/services/categories.service";
import { useAuth } from "@/context/AuthContext";
import type { Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { IconPicker } from "./IconPicker";

interface CategoryFormProps {
  category?: Category | null;
  onSaved: (category: Category) => void;
  onCancel: () => void;
}

const DEFAULT_COLOR = "#129055";
const DEFAULT_ICON = "shopping-basket";

/** Create/edit form for a category (name, color, icon) — reuses ProductForm's create-or-edit pattern. */
export function CategoryForm({ category, onSaved, onCancel }: CategoryFormProps) {
  const { user } = useAuth();
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR);
  const [icon, setIcon] = useState(category?.icon ?? DEFAULT_ICON);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      const actorId = user?.id ?? null;

      const saved = category
        ? await updateCategory(supabase, category.id, { name: name.trim(), color, icon }, actorId)
        : await createCategory(supabase, { name, color, icon }, actorId);

      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ القسم");
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input
        label="اسم القسم"
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="h-14 text-lg"
        required
        autoFocus
      />

      <ColorSwatchPicker value={color} onChange={setColor} />
      <IconPicker value={icon} onChange={setIcon} />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          إلغاء
        </Button>
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? "جارٍ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </form>
  );
}
