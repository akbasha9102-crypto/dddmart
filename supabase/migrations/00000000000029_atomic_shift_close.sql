-- Atomic, tenant-safe, status-guarded shift close — fixes audit finding
-- (mashee_mart_security_audit.md, 🟠, "تقفيل الوردية قابل للتلاعب المباشر
-- عبر القاعدة (إخفاء عجز الصندوق)").
--
-- The vulnerability: "close own shift or admin force-close"
-- (00000000000018_cash_drawer_shifts.sql:44-52) only ever checked
-- store_id — never shift.status, never which columns changed:
--   create policy "close own shift or admin force-close" on shifts
--     for update to authenticated
--     using (store_id = current_store_id() and (cashier_id = auth.uid() or <is admin>))
--     with check (store_id = current_store_id());
-- A cashier could PATCH /rest/v1/shifts?id=eq.<own-shift> directly and set
-- counted_amount/difference to whatever they want (hiding a real cash-drawer
-- shortage), or reopen/re-tamper an already-closed shift, entirely bypassing
-- closeShift's app-level `if (status === "closed") throw` check — that
-- check runs in the browser and is not a security boundary.
--
-- Fix, same shape as create_sale_atomic (00000000000027) / record_return
-- (00000000000021): a security definer RPC becomes the ONLY way to close a
-- shift. It row-locks the shift, derives actor identity/store from the
-- session (never trusts client params for either), hard-requires
-- status = 'open' before any write, authorizes exactly the two real
-- call sites this app has (own-shift real close vs admin-only forced close
-- of someone else's shift — verified via grep, no other caller exists), and
-- computes expected_amount server-side by porting
-- services/shifts.service.ts#calculateExpectedAmount's exact logic into
-- SQL, so a cashier's browser never sees (and thus can never influence)
-- the expected amount before submitting their count.
create or replace function public.close_shift_atomic(
  p_shift_id uuid,
  p_counted_amount numeric,
  p_is_forced boolean
)
returns setof shifts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_store_id uuid;
  v_shift shifts%rowtype;
  v_close_time timestamptz := now();
  v_cash_sales numeric := 0;
  v_cash_payments numeric := 0;
  v_cash_refunds numeric := 0;
  v_expected_amount numeric(12,2);
  v_counted_amount numeric(12,2);
  v_difference numeric(12,2);
begin
  v_actor_id := auth.uid();
  v_store_id := current_store_id();

  select * into v_shift from shifts where id = p_shift_id for update;

  if not found then
    raise exception 'لم يتم العثور على الوردية';
  end if;

  if v_shift.store_id <> v_store_id then
    raise exception 'الوردية لا تتبع هذا المتجر';
  end if;

  if v_shift.status <> 'open' then
    raise exception 'هذه الوردية مغلقة أصلاً';
  end if;

  if p_is_forced then
    if not exists (select 1 from profiles where id = v_actor_id and role = 'admin') then
      raise exception 'يجب أن تكون مديراً لإغلاق الوردية قسرياً';
    end if;
  else
    if v_shift.cashier_id <> v_actor_id then
      raise exception 'يمكنك إغلاق ورديتك الخاصة فقط';
    end if;
  end if;

  if p_counted_amount is not null and p_counted_amount < 0 then
    raise exception 'المبلغ المعدود يجب أن يكون صفراً أو أكبر';
  end if;

  if v_shift.cashier_id is null then
    v_expected_amount := v_shift.opening_balance;
  else
    select coalesce(sum(total_amount), 0) into v_cash_sales
      from sales
      where cashier_id = v_shift.cashier_id and payment_method = 'cash'
        and created_at >= v_shift.opened_at and created_at <= v_close_time;

    select coalesce(sum(amount), 0) into v_cash_payments
      from customer_transactions
      where cashier_id = v_shift.cashier_id and type = 'payment'
        and created_at >= v_shift.opened_at and created_at <= v_close_time;

    select coalesce(sum(r.refund_amount), 0) into v_cash_refunds
      from returns r
      join sales s on s.id = r.sale_id
      where r.actor_id = v_shift.cashier_id and s.payment_method = 'cash'
        and r.created_at >= v_shift.opened_at and r.created_at <= v_close_time;

    v_expected_amount := v_shift.opening_balance + v_cash_sales + v_cash_payments - v_cash_refunds;
  end if;

  v_counted_amount := case when p_is_forced then null else p_counted_amount end;
  v_difference := case when v_counted_amount is null then null else v_counted_amount - v_expected_amount end;

  update shifts set
    status = 'closed',
    closed_at = v_close_time,
    expected_amount = v_expected_amount,
    counted_amount = v_counted_amount,
    difference = v_difference,
    forced_closed_by = case when p_is_forced then v_actor_id else null end
  where id = p_shift_id
  returning * into v_shift;

  return next v_shift;
end;
$$;

grant execute on function public.close_shift_atomic(uuid, numeric, boolean) to authenticated;

-- ============================================================================
-- Lock down shifts: drop the UPDATE policy entirely. Closing a shift now
-- goes exclusively through close_shift_atomic (security definer, bypasses
-- RLS by design) — matching how sales/sale_items lost direct INSERT access
-- in migration 27. Confirmed via grep: closeShift (services/shifts.service.ts)
-- was the only code path anywhere that issued .update() against shifts;
-- openShift's INSERT path (unaffected policy "authenticated insert own
-- shift") and the read policy ("authenticated read shifts") are untouched.
-- ============================================================================

drop policy if exists "close own shift or admin force-close" on shifts;
