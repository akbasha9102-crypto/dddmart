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
