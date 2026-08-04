# DDD Mart

نظام إدارة محلات وماركتات سحابي متكامل ومبسط، مبني على Next.js (App Router), TypeScript, Tailwind CSS, و Supabase. مُحسّن للعمل بسلاسة وسرعة على أجهزة نقاط البيع (POS).

## البنية

- `app/` — المسارات: `(auth)` لتسجيل الدخول، `(pos)` لشاشة الكاشير، `(dashboard)` للمخزون والمبيعات.
- `components/ui` — عناصر أساسية (Button, Input, Modal, Card).
- `components/shared` — عناصر مشتركة (Navbar, Sidebar).
- `components/features` — مكونات مقسمة حسب الميزة (pos, inventory, sales).
- `lib/supabase` — عملاء Supabase (متصفح، خادم، middleware).
- `services/` — طبقة الوصول للبيانات (Supabase queries).
- `types/` — تعريفات TypeScript ومخطط قاعدة البيانات.
- `hooks/` و `context/` — منطق POS (السلة، ماسح الباركود، الجلسة).

## البدء

```bash
npm install
cp .env.local.example .env.local   # ثم أدخل بيانات مشروع Supabase الخاص بك
npm run dev
```

## أوامر مفيدة

```bash
npm run typecheck   # فحص TypeScript
npm run lint         # فحص ESLint
npm run build        # بناء الإنتاج
```

## قاعدة البيانات

يفترض `types/database.types.ts` وجود الجداول التالية في Supabase: `profiles`, `categories`, `products`, `sales`, `sale_items`. يجب إنشاء هذا المخطط في مشروع Supabase قبل تشغيل النظام فعلياً (سيتم إضافة ملفات الهجرة SQL في مرحلة لاحقة).
