"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { createCategory } from "@/services/categories.service";
import type { Category } from "@/types/product";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface AddCategoryFormProps {
  onSaved: (category: Category) => void;
  onCancel: () => void;
}

export function AddCategoryForm({ onSaved, onCancel }: AddCategoryFormProps) {
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const supabase = createClient();
      const category = await createCategory(supabase, name);
      onSaved(category);
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
