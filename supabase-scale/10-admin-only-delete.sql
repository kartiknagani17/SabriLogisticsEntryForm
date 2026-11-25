-- Only admins can delete GC entries, LRs, inward records and delivery slips.
-- Employees keep reading / adding / editing inside their own branch (same rule as before), but no longer delete.
do $$
declare t text;
begin
  foreach t in array array['entries', 'lrs', 'inwards', 'delivery_slips'] loop
    execute format('drop policy if exists branch_scope on public.%I', t);
    execute format('drop policy if exists branch_select on public.%I', t);
    execute format('drop policy if exists branch_insert on public.%I', t);
    execute format('drop policy if exists branch_update on public.%I', t);
    execute format('drop policy if exists admin_delete on public.%I', t);
    execute format('create policy branch_select on public.%I for select using (public.app_is_admin() or branch_id = (select public.app_branch_id()))', t);
    execute format('create policy branch_insert on public.%I for insert with check (public.app_is_admin() or branch_id = (select public.app_branch_id()))', t);
    execute format('create policy branch_update on public.%I for update using (public.app_is_admin() or branch_id = (select public.app_branch_id())) with check (public.app_is_admin() or branch_id = (select public.app_branch_id()))', t);
    execute format('create policy admin_delete on public.%I for delete using (public.app_is_admin())', t);
  end loop;
end $$;
