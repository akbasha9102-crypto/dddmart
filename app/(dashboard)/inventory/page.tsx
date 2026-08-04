import { Card } from "@/components/ui/Card";

export default function InventoryPage() {
  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">إدارة المخزون</h1>
      <p className="mt-2 text-gray-500">
        قيد الإنشاء — سيتم بناء جدول المنتجات، الباركود، وتنبيهات نفاد المخزون في المرحلة القادمة (Inventory Agent).
      </p>
    </Card>
  );
}
