-- Atomic, race-safe stock adjustment for the POS scan-time decrement feature.
-- Used to decrement stock the instant an item enters the cart (scan or manual
-- add), and to restore it if the item is later removed/reduced/cart cleared
-- before checkout. A single UPDATE ... WHERE ... RETURNING is atomic under
-- Postgres row locking, so concurrent calls against the same product cannot
-- both succeed against a quantity that only supports one of them.
--
-- delta may be negative (decrement) or positive (increment/restore).
-- The guard `quantity + delta >= 0` prevents stock from ever going negative;
-- when the guard fails, zero rows are returned (not an error) — callers must
-- treat an empty result as "insufficient stock at this instant".
create or replace function public.adjust_product_stock(p_product_id uuid, p_delta integer)
returns setof products
language sql
security invoker
as $$
  update products
  set quantity = quantity + p_delta,
      updated_at = now()
  where id = p_product_id
    and quantity + p_delta >= 0
  returning *;
$$;

grant execute on function public.adjust_product_stock(uuid, integer) to authenticated;
