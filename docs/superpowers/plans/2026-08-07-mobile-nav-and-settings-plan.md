# واجهة تنقل مخصصة للجوال والتابلت + قسم "الإعدادات" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** البار السفلي (BottomNav) يصير التنقل الأساسي للجوال والتابلت معاً (3 تبويبات: الكاشير، المخزون، الإعدادات)، صفحة `/settings` جديدة تجمع المبيعات/الأرشيف/الموظفون حسب الدور مع أول زر تسجيل خروج بالتطبيق.

**Architecture:** ملف واحد جديد (`components/shared/navLinks.ts`) يصير مصدر الحقيقة الوحيد لقائمة الروابط الأساسية وروابط الإعدادات، تستورده الثلاث مكونات تنقل الموجودة (`Navbar`, `Sidebar`, `BottomNav`) بدل نسخهم المكررة الحالية. نقطة تحول Tailwind بين واجهة الجوال/التابلت وواجهة الديسكتوب ترتفع من `md` إلى `lg` بكل مكان. صفحة `/settings` جديدة تستخدم نفس القائمة مفلترة حسب الدور، وتضيف زر تسجيل خروج يستدعي `supabase.auth.signOut()` مباشرة.

**Tech Stack:** Next.js 15 (App Router) + TypeScript strict + Tailwind CSS + `@supabase/ssr` (auth) + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-mobile-nav-and-settings-design.md`

## Global Constraints

- نقطة التحول الجديدة بكل الأماكن (`BottomNav`, `Navbar`, `Sidebar`, `app/(dashboard)/layout.tsx`) هي `lg` (1024px) بدل `md` (768px) الحالية — بدون استثناء، وإلا يصير تعارض بين ظهور/اختفاء البار السفلي والحشوة (padding) المرتبطة فيه.
- `PRIMARY_LINKS` (الكاشير، المخزون، الإعدادات) تظهر لكل المستخدمين بدون فلترة حسب الدور — الفلترة الوحيدة المتبقية تصير على `SETTINGS_LINKS` داخل صفحة `/settings` بس.
- صلاحيات `/sales` و `/employees` تبقى محصورة بـ `role === "admin"` تماماً كما هي اليوم (الحماية داخل كل صفحة موجودة أصلاً ولا تتغيّر بهذه الخطة) — هذه الخطة تنقل *مكان الرابط* بس، مو الصلاحية نفسها.
- تسجيل الخروج بدون أي منطق حماية إضافي بـ `middleware.ts` — الموجود أصلاً يكفي (يرجّع أي مستخدم بدون جلسة لـ `/login` تلقائياً).
- `npm run typecheck && npm run lint && npm test && npm run build` لازم كلهم ناجحين قبل آخر commit بهذه الخطة.

---

### Task 1: مصدر الحقيقة الوحيد لقائمة الروابط

**Files:**
- Create: `components/shared/navLinks.ts`
- Test: `components/shared/navLinks.test.ts`

**Interfaces:**
- Consumes: لا شي (لا يعتمد على أي كود من هذا المشروع).
- Produces (يستخدمها Task 2, 3, 4, 6):
  - `PRIMARY_LINKS: { href: string; label: string }[]` — الروابط الثلاثة الأساسية.
  - `SETTINGS_LINKS: { href: string; label: string; adminOnly: boolean }[]` — روابط صفحة الإعدادات.
  - `isSettingsPath(pathname: string): boolean` — هل المسار الحالي يعتبر "داخل الإعدادات".
  - `visibleSettingsLinks(role: string | null): { href: string; label: string; adminOnly: boolean }[]` — `SETTINGS_LINKS` مفلترة حسب الدور.

- [ ] **Step 1: Write the failing test**

Create `components/shared/navLinks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isSettingsPath, visibleSettingsLinks } from "@/components/shared/navLinks";

describe("isSettingsPath", () => {
  it("returns true for the settings page itself", () => {
    expect(isSettingsPath("/settings")).toBe(true);
  });

  it("returns true for sales, archive, and employees pages", () => {
    expect(isSettingsPath("/sales")).toBe(true);
    expect(isSettingsPath("/archive")).toBe(true);
    expect(isSettingsPath("/employees")).toBe(true);
  });

  it("returns true for nested sub-paths", () => {
    expect(isSettingsPath("/employees/123")).toBe(true);
  });

  it("returns false for unrelated paths", () => {
    expect(isSettingsPath("/pos")).toBe(false);
    expect(isSettingsPath("/inventory")).toBe(false);
  });
});

describe("visibleSettingsLinks", () => {
  it("includes admin-only links for an admin role", () => {
    const hrefs = visibleSettingsLinks("admin").map((link) => link.href);
    expect(hrefs).toEqual(["/sales", "/archive", "/employees"]);
  });

  it("excludes admin-only links for a cashier role", () => {
    const hrefs = visibleSettingsLinks("cashier").map((link) => link.href);
    expect(hrefs).toEqual(["/archive"]);
  });

  it("excludes admin-only links for a null role", () => {
    const hrefs = visibleSettingsLinks(null).map((link) => link.href);
    expect(hrefs).toEqual(["/archive"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/shared/navLinks.test.ts`
Expected: FAIL — `components/shared/navLinks` module not found.

- [ ] **Step 3: Write minimal implementation**

Create `components/shared/navLinks.ts`:

```ts
export interface NavLink {
  href: string;
  label: string;
}

export interface SettingsLink extends NavLink {
  adminOnly: boolean;
}

/** The three top-level tabs shown to every user, in every nav surface (BottomNav, Navbar, Sidebar). */
export const PRIMARY_LINKS: NavLink[] = [
  { href: "/pos", label: "الكاشير" },
  { href: "/inventory", label: "المخزون" },
  { href: "/settings", label: "الإعدادات" },
];

/** Links shown inside the /settings page. adminOnly links are hidden from cashiers there. */
export const SETTINGS_LINKS: SettingsLink[] = [
  { href: "/sales", label: "المبيعات", adminOnly: true },
  { href: "/archive", label: "الأرشيف", adminOnly: false },
  { href: "/employees", label: "الموظفون", adminOnly: true },
];

const SETTINGS_PATHS = ["/settings", "/sales", "/archive", "/employees"];

/** True when pathname is /settings or any page reachable from it — used to keep the "الإعدادات" tab visually active on its sub-pages. */
export function isSettingsPath(pathname: string): boolean {
  return SETTINGS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** SETTINGS_LINKS filtered down to what `role` is allowed to see. */
export function visibleSettingsLinks(role: string | null): SettingsLink[] {
  return SETTINGS_LINKS.filter((link) => !link.adminOnly || role === "admin");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/shared/navLinks.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/shared/navLinks.ts components/shared/navLinks.test.ts
git commit -m "Add shared navLinks module as single source of truth for nav links"
```

---

### Task 2: تحديث BottomNav — 3 تبويبات + تحول lg + تفعيل "الإعدادات" على الصفحات الفرعية

**Files:**
- Modify: `components/shared/BottomNav.tsx`

**Interfaces:**
- Consumes: `PRIMARY_LINKS`, `isSettingsPath` من `components/shared/navLinks.ts` (Task 1).
- Produces: لا شي يعتمد عليه تاسك لاحق.

- [ ] **Step 1: Replace the file contents**

Replace `components/shared/BottomNav.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PRIMARY_LINKS, isSettingsPath } from "./navLinks";

/** Fixed bottom tab bar — primary navigation on phones and tablets (lg:hidden on large desktop screens). */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 min-h-14 border-t border-gray-200 bg-white lg:hidden">
      {PRIMARY_LINKS.map((link) => {
        const isActive =
          link.href === "/settings"
            ? isSettingsPath(pathname)
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium text-gray-500",
              isActive && "text-brand-700",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/shared/BottomNav.tsx
git commit -m "Simplify BottomNav to 3 tabs, extend it to tablets, highlight Settings on sub-pages"
```

---

### Task 3: تحديث Navbar — نفس الروابط الثلاثة + تحول lg

**Files:**
- Modify: `components/shared/Navbar.tsx`

**Interfaces:**
- Consumes: `PRIMARY_LINKS` من `components/shared/navLinks.ts` (Task 1).
- Produces: لا شي يعتمد عليه تاسك لاحق. (لاحظ: `BottomNav.tsx` الحالي — قبل Task 2 — كان يستورد `visibleNavLinks` من هذا الملف؛ Task 2 شالت هذا الاستيراد فلا تعارض.)

- [ ] **Step 1: Replace the file contents**

Replace `components/shared/Navbar.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { PRIMARY_LINKS } from "./navLinks";

export function Navbar() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <Link href="/" className="text-lg font-bold text-brand-700">
        DDD Mart
      </Link>
      <nav className="hidden items-center gap-6 lg:flex">
        {PRIMARY_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="text-sm font-medium text-gray-600 hover:text-brand-700">
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/shared/Navbar.tsx
git commit -m "Point Navbar at shared PRIMARY_LINKS, raise desktop breakpoint to lg"
```

---

### Task 4: تحديث Sidebar — نفس الروابط الثلاثة + تحول lg

**Files:**
- Modify: `components/shared/Sidebar.tsx`

**Interfaces:**
- Consumes: `PRIMARY_LINKS` من `components/shared/navLinks.ts` (Task 1).
- Produces: لا شي يعتمد عليه تاسك لاحق.

- [ ] **Step 1: Replace the file contents**

Replace `components/shared/Sidebar.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { PRIMARY_LINKS } from "./navLinks";

export function Sidebar({ activeHref }: { activeHref?: string }) {
  return (
    <aside className="hidden w-56 shrink-0 border-l border-gray-200 bg-white p-4 lg:block">
      <nav className="flex flex-col gap-1">
        {PRIMARY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100",
              activeHref === link.href && "bg-brand-50 text-brand-700",
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

Note: `activeHref` stays an optional prop exactly as before (no caller passes it today — pre-existing, out of scope for this plan).

- [ ] **Step 2: Commit**

```bash
git add components/shared/Sidebar.tsx
git commit -m "Point Sidebar at shared PRIMARY_LINKS, raise desktop breakpoint to lg"
```

---

### Task 5: تحديث حشوة الـ layout لتطابق نقطة التحول الجديدة

**Files:**
- Modify: `app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: لا شي.
- Produces: لا شي يعتمد عليه تاسك لاحق.

- [ ] **Step 1: Update the `main` className**

In `app/(dashboard)/layout.tsx`, change:

```tsx
          <main className="flex-1 p-3 pb-20 md:p-6 md:pb-6">{children}</main>
```

to:

```tsx
          <main className="flex-1 p-3 pb-20 lg:p-6 lg:pb-6">{children}</main>
```

(لا تغيير غير `md:` → `lg:` — لولا هذا التغيير، عرض التابلت يصير فيه فراغ فاضي تحت المحتوى محسوب على وجود Navbar/Sidebar بس ماكو، لأن البار السفلي راح يظل ظاهر على نفس العرض بعد Task 2-4.)

- [ ] **Step 2: Commit**

```bash
git add "app/(dashboard)/layout.tsx"
git commit -m "Match dashboard layout padding to the new lg nav breakpoint"
```

---

### Task 6: صفحة `/settings` + تسجيل الخروج

**Files:**
- Create: `app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes:
  - `SETTINGS_LINKS`, `visibleSettingsLinks` من `components/shared/navLinks.ts` (Task 1).
  - `useAuth()` من `context/AuthContext.tsx` (موجود أصلاً؛ يرجّع `{ user, role, isLoading }`).
  - `createClient()` من `lib/supabase/client.ts` (موجود أصلاً، نفس المستخدم بصفحة `/login`).
  - `Button` من `components/ui/Button.tsx` (موجود أصلاً).
- Produces: لا شي يعتمد عليه تاسك لاحق — آخر تاسك برمجي بهذه الخطة.

- [ ] **Step 1: Create the settings page**

Create `app/(dashboard)/settings/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { visibleSettingsLinks } from "@/components/shared/navLinks";

export default function SettingsPage() {
  const { role } = useAuth();
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const links = visibleSettingsLinks(role);

  async function handleLogout() {
    setLogoutError(null);
    setIsLoggingOut(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      setLogoutError("تعذّر تسجيل الخروج، حاول مرة ثانية");
      setIsLoggingOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-bold text-gray-900">الإعدادات</h1>

      <div className="flex flex-col gap-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex h-14 items-center rounded-lg border border-gray-200 bg-white px-4 text-base font-medium text-gray-900 hover:bg-gray-50"
          >
            {link.label}
          </Link>
        ))}
      </div>

      {logoutError ? <p className="text-sm text-red-600">{logoutError}</p> : null}

      <Button variant="secondary" size="lg" onClick={handleLogout} disabled={isLoggingOut} className="w-full">
        {isLoggingOut ? "جارٍ تسجيل الخروج..." : "تسجيل خروج"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck, lint, test, and build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass with no new errors or warnings.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/settings/page.tsx"
git commit -m "Add /settings page with role-filtered links and logout"
```

---

### Task 7: تحقق يدوي شامل (End-to-end)

**Files:** none (verification only)

**Interfaces:**
- Consumes: كل التغييرات من Task 1-6.

- [ ] **Step 1: تحقق من عرض الجوال (~375px)**

افتح التطبيق بمتصفح مع محاكاة عرض جوال (DevTools device toolbar، أو جوال حقيقي). سجّل دخول كأدمن. تأكد: البار السفلي يعرض 3 تبويبات بس (الكاشير، المخزون، الإعدادات)، والضغط على "الإعدادات" يفتح `/settings` ويعرض المبيعات + الأرشيف + الموظفون + زر تسجيل خروج.

- [ ] **Step 2: تحقق من عرض التابلت (~820px، عمودي وأفقي)**

بنفس المتصفح، بدّل لعرض تابلت (820×1180 وبالعكس). تأكد إن البار السفلي هو الظاهر (مو Navbar/Sidebar) بكلا الاتجاهين.

- [ ] **Step 3: تحقق من عرض ديسكتوب كبير (≥1024px)**

وسّع نافذة المتصفح لعرض ≥1024px. تأكد إن Navbar (فوق) و Sidebar (جنب) يظهرون، والبار السفلي يختفي، وروابطهم الثلاثة (الكاشير، المخزون، الإعدادات) تشتغل.

- [ ] **Step 4: تحقق من صلاحيات الإعدادات بحساب كاشير**

سجّل دخول بحساب كاشير تجريبي (أو استخدم حساب كاشير موجود). افتح `/settings`. تأكد إن رابطي "المبيعات" و"الموظفون" غير ظاهرين، وإن "الأرشيف" ظاهر، وإن زر تسجيل الخروج ظاهر ويشتغل.

- [ ] **Step 5: تحقق من تسجيل الخروج فعلياً**

من حساب أدمن، افتح `/settings` واضغط "تسجيل خروج". تأكد إن التطبيق يرجّعك لصفحة `/login`. بعدها جرّب تفتح `/pos` مباشرة بشريط العنوان — تأكد إنه يرجّعك لـ `/login` تلقائياً (يعني الجلسة فعلاً انمسحت، مو بس تحويل واجهي).

- [ ] **Step 6: تقرير النتائج**

لخّص نجاح/فشل كل خطوة أعلاه قبل اعتبار هذه الخطة مكتملة.
