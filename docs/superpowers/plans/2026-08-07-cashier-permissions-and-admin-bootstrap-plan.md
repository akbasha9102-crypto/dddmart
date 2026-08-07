# Auto-Admin Bootstrap + Hide Cost/Profit From Cashier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first account ever created in this Supabase project becomes `admin` automatically (no manual SQL Editor step, ever), and any user whose role is `cashier` never sees the "سعر التكلفة" (cost price) field or the profit-margin preview when adding or editing a product.

**Architecture:** One new migration (`00000000000007_auto_admin_first_user.sql`) changes the existing `handle_new_user()` Postgres trigger to check `not exists (select 1 from profiles)` at insert time and assign `admin` instead of `cashier` when true, plus a one-time idempotent backfill `update` that promotes the single oldest existing `profiles` row to `admin` if no admin exists yet. Two component edits (`ProductForm.tsx`, `QuickAddProductForm.tsx`) reuse the already-tested `isAdminRole()` predicate from `lib/employees/adminCheck.ts` to conditionally render the cost-price input and `<ProfitPreview />`.

**Tech Stack:** Next.js 15 (App Router) + TypeScript strict + Supabase (Postgres, RLS, `@supabase/ssr`) + Tailwind + Vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-cashier-permissions-and-admin-bootstrap-design.md` (commit `1db3b8b`)

## Global Constraints

- The "is this the first account?" check must run **inside the Postgres trigger itself**, never in application code — this avoids any race condition between two account-creation paths (in-app `/employees` API route vs. direct Supabase Dashboard use).
- The backfill that promotes an existing account to `admin` must be idempotent and must only ever promote **one** row (the oldest by `created_at`), and only when no `admin` row exists yet — re-running the migration must be a no-op the second time.
- Hiding cost price / profit from `cashier` is a **UI-level check only** (`role === "admin"`, same pattern as `app/(dashboard)/sales/page.tsx`), not a new RLS policy — no changes to `supabase/migrations/00000000000000_init.sql` policies in this plan.
- Reuse `isAdminRole()` from `lib/employees/adminCheck.ts` (already exists, already unit-tested) in both component tasks — do not write a second, duplicate role-check function.
- All Arabic UI copy must match existing tone/phrasing in the same files (no new copy is actually needed for this plan — the change is purely conditional rendering).
- `npm run typecheck && npm run lint && npm test && npm run build` must all pass before every commit.
- Applying the migration to the live database (`supabase db push` or the Management API) is a production-database write — stop and get the user's explicit confirmation before running it, same as every prior migration in this project.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/00000000000007_auto_admin_first_user.sql` | Redefines `handle_new_user()` trigger function; one-time backfill `update` (new) |
| `supabase/tests/00000000000007_auto_admin_first_user_test.sql` | Rollback-wrapped SQL assertions for the migration above (new) |
| `components/features/inventory/ProductForm.tsx` | Hide cost-price input + `<ProfitPreview />` for non-admin (modify) |
| `components/features/inventory/QuickAddProductForm.tsx` | Hide cost-price input + `<ProfitPreview />` for non-admin (modify) |

No changes to `services/products.service.ts`, `types/database.types.ts`, or any RLS policy — confirmed while reading the code that hiding the JSX is sufficient because both components' `costPrice` state already defaults correctly (`product?.cost_price ?? 0` for edit, `""` → `0` for create) even when the input never renders, so no submit-time logic changes are needed.

---

### Task 1: Auto-admin bootstrap migration

**Files:**
- Create: `supabase/migrations/00000000000007_auto_admin_first_user.sql`
- Create: `supabase/tests/00000000000007_auto_admin_first_user_test.sql`

**Interfaces:**
- Consumes: existing `public.profiles` table (`id uuid references auth.users`, `role text check (role in ('admin','cashier'))`, `created_at timestamptz`) and existing `on_auth_user_created` trigger on `auth.users`, both defined in `supabase/migrations/00000000000000_init.sql`.
- Produces: nothing consumed by later tasks — this task is independent of Tasks 2/3.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/00000000000007_auto_admin_first_user_test.sql`:

```sql
-- Rollback-wrapped assertions for migration 00000000000007. Safe to run
-- against the live project any number of times: nothing here survives
-- past the final ROLLBACK. Temporarily clears public.profiles inside the
-- transaction to test the "table is empty" branch in isolation from real
-- data — restored automatically by the rollback.
begin;

delete from public.profiles;

-- Test 1: the very first account ever created becomes admin.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'test-first@example.com', crypt('password123', gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
);

do $$
begin
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000001') = 'admin' then
    raise notice 'TEST PASSED: first-ever account got admin role';
  else
    raise exception 'TEST FAILED: first-ever account should be admin, got %',
      (select role from public.profiles where id = '00000000-0000-0000-0000-000000000001');
  end if;
end $$;

-- Test 2: the second account still gets cashier (unchanged default behavior).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000002',
  'authenticated', 'authenticated', 'test-second@example.com', crypt('password123', gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
);

do $$
begin
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000002') = 'cashier' then
    raise notice 'TEST PASSED: second account got cashier role';
  else
    raise exception 'TEST FAILED: second account should be cashier, got %',
      (select role from public.profiles where id = '00000000-0000-0000-0000-000000000002');
  end if;
end $$;

-- Test 3: backfill promotes the single oldest existing account when no admin exists.
delete from public.profiles where id in
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');
delete from auth.users where id in
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000003',
  'authenticated', 'authenticated', 'test-old@example.com', crypt('password123', gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
);
update public.profiles set created_at = now() - interval '1 day' where id = '00000000-0000-0000-0000-000000000003';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000004',
  'authenticated', 'authenticated', 'test-new@example.com', crypt('password123', gen_salt('bf')),
  now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'
);

-- Both rows above are 'admin'/'cashier' per the trigger (Test 1/2 behavior already proved
-- it), but Test 1 already consumed the "table empty" branch — force both back to cashier so
-- this block re-tests the backfill UPDATE statement itself, not the trigger.
update public.profiles set role = 'cashier'
where id in ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004');

update public.profiles
set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

do $$
begin
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000003') = 'admin'
     and (select role from public.profiles where id = '00000000-0000-0000-0000-000000000004') = 'cashier' then
    raise notice 'TEST PASSED: backfill promoted only the oldest account to admin';
  else
    raise exception 'TEST FAILED: backfill did not promote exactly the oldest account';
  end if;
end $$;

-- Test 4: re-running the same backfill statement is a no-op (idempotent).
update public.profiles
set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');

do $$
begin
  if (select count(*) from public.profiles where role = 'admin') = 1 then
    raise notice 'TEST PASSED: re-running backfill did not create a second admin';
  else
    raise exception 'TEST FAILED: re-running backfill changed admin count to %',
      (select count(*) from public.profiles where role = 'admin');
  end if;
end $$;

rollback;
```

- [ ] **Step 2: Run the test to verify it fails (trigger doesn't have the new branch yet)**

Run:
```bash
jq -Rs '{query: .}' supabase/tests/00000000000007_auto_admin_first_user_test.sql | \
  curl -s -X POST "https://api.supabase.com/v1/projects/klctindutdkvsmnsegwy/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```
Expected: Test 1 fails with `TEST FAILED: first-ever account should be admin, got cashier` (current trigger always assigns `cashier`).

> If this step errors out before reaching Test 1 (e.g. `column "instance_id" does not exist` or similar), the live project's `auth.users` schema differs slightly from the columns used above — inspect the actual error, adjust the column list in the test file to match, and re-run. Do not skip straight to a passing state without seeing the intended failure first.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/00000000000007_auto_admin_first_user.sql`:

```sql
-- The very first account ever created in this project (i.e. profiles is
-- still empty at insert time) becomes the store owner (admin) instead of
-- the default cashier — removes the need to ever hand-edit profiles.role
-- via the Supabase SQL Editor to bootstrap the first admin. See
-- docs/superpowers/specs/2026-08-07-cashier-permissions-and-admin-bootstrap-design.md.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  assigned_role text;
begin
  if not exists (select 1 from public.profiles) then
    assigned_role := 'admin';
  else
    assigned_role := 'cashier';
  end if;

  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), assigned_role);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- One-time, idempotent backfill: promotes the oldest existing account to
-- admin if this project already had accounts before this migration ran
-- and none of them is an admin yet.
update public.profiles
set role = 'admin'
where id = (select id from public.profiles order by created_at asc limit 1)
  and not exists (select 1 from public.profiles where role = 'admin');
```

- [ ] **Step 4: Get explicit user confirmation, then apply the migration to the live project**

This runs real DDL against the production Supabase project (`klctindutdkvsmnsegwy`) — stop and get the user's explicit confirmation before running it, same as every prior migration in this project.

Run:
```bash
jq -Rs '{query: .}' supabase/migrations/00000000000007_auto_admin_first_user.sql | \
  curl -s -X POST "https://api.supabase.com/v1/projects/klctindutdkvsmnsegwy/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d @-
```
Expected: `[]` (empty JSON array — DDL statements return no rows) and no `"message"` error field.

- [ ] **Step 5: Run the test again to verify it passes**

Run the same `jq | curl` command from Step 2 (the test file).
Expected: all four `TEST PASSED` notices, no `TEST FAILED`, no error.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/00000000000007_auto_admin_first_user.sql supabase/tests/00000000000007_auto_admin_first_user_test.sql
git commit -m "Add migration: first account auto-becomes admin, backfill existing owner"
```

---

### Task 2: Hide cost price / profit preview from cashier in `ProductForm.tsx`

**Files:**
- Modify: `components/features/inventory/ProductForm.tsx:1-23` (imports + destructure), `:97-131` (JSX)

**Interfaces:**
- Consumes: `isAdminRole(role: UserRole | string | null | undefined): boolean` from `lib/employees/adminCheck.ts` (already exists, already tested in `lib/employees/adminCheck.test.ts`); `role: UserRole | null` from `useAuth()` in `context/AuthContext.tsx`.
- Produces: nothing consumed by later tasks — independent of Task 1 and Task 3.

- [ ] **Step 1: No new unit test needed**

`isAdminRole` is already covered by `lib/employees/adminCheck.test.ts` (admin → true, cashier/null/undefined → false). This task only wires an existing, already-tested predicate into JSX conditionals — there is no new pure logic to unit test. This project's Vitest config runs in a plain `node` environment with no React rendering library installed (`vitest.config.ts` has no `jsdom`/`@testing-library/react`), so component-level rendering tests are out of scope here, matching this plan's design doc, which calls for manual verification of this specific change (done in Task 4, Step 2).

- [ ] **Step 2: Edit imports and destructure `role`**

In `components/features/inventory/ProductForm.tsx`, change:
```tsx
import { useAuth } from "@/context/AuthContext";
```
to:
```tsx
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/employees/adminCheck";
```

And change:
```tsx
  const { user } = useAuth();
```
to:
```tsx
  const { user, role } = useAuth();
```

- [ ] **Step 3: Conditionally render the cost-price input and profit preview**

Replace:
```tsx
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="سعر التكلفة"
          type="number"
          min={0}
          step="0.01"
          value={costPrice}
          onChange={(event) => setCostPrice(event.target.value)}
          required
        />
        <Input
          label="سعر البيع"
          type="number"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          required
        />
        <Input
          label="الكمية"
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Input
          label="حد التنبيه"
          type="number"
          min={0}
          value={minStock}
          onChange={(event) => setMinStock(event.target.value)}
        />
        <ProfitPreview costPrice={costPrice} salePrice={salePrice} className="col-span-2" />
      </div>
```
with:
```tsx
      <div className="grid grid-cols-2 gap-4">
        {isAdminRole(role) ? (
          <Input
            label="سعر التكلفة"
            type="number"
            min={0}
            step="0.01"
            value={costPrice}
            onChange={(event) => setCostPrice(event.target.value)}
            required
          />
        ) : null}
        <Input
          label="سعر البيع"
          type="number"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          required
        />
        <Input
          label="الكمية"
          type="number"
          min={0}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <Input
          label="حد التنبيه"
          type="number"
          min={0}
          value={minStock}
          onChange={(event) => setMinStock(event.target.value)}
        />
        {isAdminRole(role) ? (
          <ProfitPreview costPrice={costPrice} salePrice={salePrice} className="col-span-2" />
        ) : null}
      </div>
```

No change to `handleSubmit` is needed: `costPrice` state is initialized from `product?.cost_price ?? 0` (line 27) and, when the input above doesn't render, that state can never change — so a cashier editing an existing product still submits its real, unmodified `cost_price`, and a cashier creating a new product submits `0` (the same default a new product would get anyway before an admin sets a real cost).

- [ ] **Step 4: Run typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass with no new errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/ProductForm.tsx
git commit -m "Hide cost price and profit preview from cashier in ProductForm"
```

---

### Task 3: Hide cost price / profit preview from cashier in `QuickAddProductForm.tsx`

**Files:**
- Modify: `components/features/inventory/QuickAddProductForm.tsx:1-23` (imports + destructure), `:109-133` (JSX)

**Interfaces:**
- Consumes: same `isAdminRole()` and `useAuth()` as Task 2.
- Produces: nothing consumed by later tasks — independent of Task 1 and Task 2.

- [ ] **Step 1: No new unit test needed**

Same reasoning as Task 2, Step 1 — `isAdminRole` is already tested; this is pure JSX wiring with no jsdom/RTL in this project's test setup. Verified manually in Task 4, Step 3.

- [ ] **Step 2: Edit imports and destructure `role`**

In `components/features/inventory/QuickAddProductForm.tsx`, change:
```tsx
import { useAuth } from "@/context/AuthContext";
```
to:
```tsx
import { useAuth } from "@/context/AuthContext";
import { isAdminRole } from "@/lib/employees/adminCheck";
```

And change:
```tsx
  const { user } = useAuth();
```
to:
```tsx
  const { user, role } = useAuth();
```

- [ ] **Step 3: Conditionally render the cost-price input and profit preview**

Replace:
```tsx
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="سعر الشراء (للسلعة الواحدة)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={costPrice}
          onChange={(event) => setCostPrice(event.target.value)}
          className="h-14 text-lg"
          required
        />
        <Input
          label="سعر البيع (للسلعة الواحدة)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          className="h-14 text-lg"
          required
        />
      </div>
      <ProfitPreview costPrice={costPrice} salePrice={salePrice} />
```
with:
```tsx
      <div className={isAdminRole(role) ? "grid grid-cols-2 gap-4" : ""}>
        {isAdminRole(role) ? (
          <Input
            label="سعر الشراء (للسلعة الواحدة)"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={costPrice}
            onChange={(event) => setCostPrice(event.target.value)}
            className="h-14 text-lg"
            required
          />
        ) : null}
        <Input
          label="سعر البيع (للسلعة الواحدة)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
          className="h-14 text-lg"
          required
        />
      </div>
      {isAdminRole(role) ? <ProfitPreview costPrice={costPrice} salePrice={salePrice} /> : null}
```

No change to `handleSubmit` is needed: this form only creates new products, `costPrice` state starts at `""`, and `Number("") || 0` already evaluates to `0` — a cashier submitting a new product without ever seeing the field still sends `cost_price: 0`, same as today's behavior for any product created with the field left blank.

- [ ] **Step 4: Run typecheck, lint, and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all pass with no new errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add components/features/inventory/QuickAddProductForm.tsx
git commit -m "Hide cost price and profit preview from cashier in QuickAddProductForm"
```

---

### Task 4: End-to-end manual verification

**Files:** none (verification only)

**Interfaces:**
- Consumes: migration already applied live in Task 1 (Step 4), component changes from Tasks 2 and 3.

- [ ] **Step 1: Manual check — the owner's existing account is now admin**

Ask the user to refresh the site (already logged in with their existing account) or log in again. Confirm the "الموظفون" link now appears in the Sidebar/Navbar, and that `/employees` loads without redirect.

- [ ] **Step 2: Manual check — cost price / profit hidden from a cashier account**

Using the now-working `/employees` page, create one test cashier account. Log in as that cashier (separate browser/incognito window), go to `/inventory`, and open both "+ إضافة" (quick add) and "إضافة تفصيلية" (detailed add, desktop). Confirm in both: no "سعر التكلفة"/"سعر الشراء" field is visible, and no profit-margin text appears anywhere on the form. Save a test product as the cashier, then confirm as the admin (in the other window) that the product was created with `سعر التكلفة = 0`.

- [ ] **Step 3: Manual regression check — admin still sees and can set cost price**

Still logged in as admin, open `/inventory`, edit any existing product. Confirm the cost-price field and profit preview are visible and editable exactly as before, and that saving still works.

- [ ] **Step 4: Report results to the user**

Summarize pass/fail for each step above before considering this plan complete.
