-- Rollback-wrapped assertions for migration 00000000000005. Safe to run
-- against the live project any number of times: nothing here survives
-- past the final ROLLBACK.
begin;

insert into products (id, name, barcode, sale_price, quantity, unit)
values ('00000000-0000-0000-0000-000000000001', 'TEST_PRODUCT', 'TEST-BASE-0001', 10, 100, 'قطعة');

-- Test 1: conversion_factor = 1 must be rejected (CHECK conversion_factor > 1).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كيس', 1, 'TEST-UNIT-0001', 20);
    raise exception 'TEST FAILED: conversion_factor=1 should have been rejected';
  exception
    when check_violation then
      raise notice 'TEST PASSED: conversion_factor=1 rejected';
  end;
end $$;

-- Test 2: a valid unit insert succeeds.
insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
values ('00000000-0000-0000-0000-000000000001', 'كيس', 6, 'TEST-UNIT-0002', 55);

-- Test 3: duplicate unit_name for the same product is rejected (UNIQUE product_id, unit_name).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كيس', 12, 'TEST-UNIT-0003', 100);
    raise exception 'TEST FAILED: duplicate unit_name should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: duplicate unit_name rejected';
  end;
end $$;

-- Test 4: a unit barcode colliding with an existing product barcode is rejected (cross-table trigger, unit -> product direction).
do $$
begin
  begin
    insert into product_units (product_id, unit_name, conversion_factor, barcode, sale_price)
    values ('00000000-0000-0000-0000-000000000001', 'كارتون', 24, 'TEST-BASE-0001', 200);
    raise exception 'TEST FAILED: unit barcode colliding with a product barcode should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: cross-table barcode collision (unit -> product) rejected';
  end;
end $$;

-- Test 5: a new product barcode colliding with an existing unit barcode is rejected (cross-table trigger, product -> unit direction).
do $$
begin
  begin
    insert into products (name, barcode, sale_price)
    values ('TEST_PRODUCT_2', 'TEST-UNIT-0002', 5);
    raise exception 'TEST FAILED: product barcode colliding with a unit barcode should have been rejected';
  exception
    when unique_violation then
      raise notice 'TEST PASSED: cross-table barcode collision (product -> unit) rejected';
  end;
end $$;

-- Test 6: deleting the parent product cascades to its units.
delete from products where id = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from product_units where product_id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: product_units rows survived parent product delete';
  else
    raise notice 'TEST PASSED: ON DELETE CASCADE removed product_units rows';
  end if;
end $$;

rollback;
