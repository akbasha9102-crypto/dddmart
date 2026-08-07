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
