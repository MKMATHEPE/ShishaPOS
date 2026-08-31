drop policy if exists orders_delete on public.pos_orders;
create policy orders_delete on public.pos_orders
for delete to authenticated
using ((select private.is_pos_admin()));
