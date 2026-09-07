-- Harden handle_new_user() against a forged/fake store_id — fixes audit
-- item 4.1 (mashee_mart_audit_report.md, section 4.1: "دالة handle_new_user
-- لا تتحقق من وجود المتجر (store_id) قبل الوثوق به — احتمال تصعيد
-- صلاحيات").
--
-- The vulnerability: handle_new_user() (00000000000012_multi_tenancy_
-- foundation.sql) reads store_id straight out of raw_user_meta_data — a
-- value the *client* supplies at signup — and never checks it against
-- public.stores. It only ever asks "does any existing profile already use
-- this store_id?" If nobody does, the new account is auto-assigned
-- 'admin'. Via Supabase's public signup endpoint (auth.signUp), any
-- anonymous caller could pass a store_id in the signup payload and be
-- granted 'admin' with zero prior authorization. Public signup has
-- separately already been disabled at the project config level as an
-- immediate mitigation (not part of this migration). This migration is
-- the defense-in-depth fix: harden the function itself, so it fails
-- safely even if public signup is ever re-enabled by mistake, or
-- handle_new_user() is ever reached via some other unforeseen path.
--
-- Fix: before deciding admin-vs-cashier, require target_store_id to be
-- both non-null and a real row in public.stores. Fail with raise
-- exception otherwise — this rolls back the entire triggering statement,
-- including the auth.users insert itself, since on_auth_user_created
-- (00000000000000_init.sql) is an AFTER INSERT trigger on auth.users and
-- the whole statement is one transaction. No application code changes
-- anywhere: confirmed by reading both known call sites of
-- auth.admin.createUser() with a store_id in user_metadata (dddmart's
-- app/api/employees/route.ts and delivery-next's
-- src/app/api/super-admin-dddmart/stores/route.ts) and by grepping both
-- repos for any other auth.signUp/createUser call — there is none. Both
-- confirmed call sites already always pass a real, freshly-resolved
-- store_id, so this migration is a pure tightening of the trigger with no
-- behavior change for any legitimate caller today.
--
-- Deliberately checking existence only, NOT stores.is_active = true:
-- current_store_id() (00000000000013_stores_rls_and_subscription_gate.sql)
-- already fails closed for suspended stores at the RLS layer on every
-- single table, so a profile row created for a suspended-but-real store
-- is immediately inert without this trigger needing to know anything
-- about subscription state. Existence-only is sufficient to fully close
-- the vulnerability class this migration targets.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  assigned_role text;
  target_store_id uuid;
begin
  target_store_id := (new.raw_user_meta_data ->> 'store_id')::uuid;

  if target_store_id is null then
    raise exception 'store_id مطلوب لإنشاء حساب جديد';
  end if;

  if not exists (select 1 from public.stores where id = target_store_id) then
    raise exception 'المتجر المحدد غير موجود';
  end if;

  if not exists (select 1 from public.profiles where store_id = target_store_id) then
    assigned_role := 'admin';
  else
    assigned_role := 'cashier';
  end if;

  insert into public.profiles (id, full_name, role, store_id)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email), assigned_role, target_store_id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;
