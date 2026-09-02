create or replace function public.mark_pos_order_delivered(order_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_type text;
begin
  if not private.is_active_pos_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.pos_orders
  set status = 'delivered', delivered_at = now()
  where id = order_id and status <> 'delivered'
  returning type into order_type;

  if not found then return false; end if;

  if order_type = 'full' then
    update public.pos_stock
    set quantity = greatest(0, quantity - 1)
    where category = 'equipment'
      and (lower(name) like '%hookah%' or lower(name) like '%rota%' or lower(name) like '%kop%');
  end if;
  return true;
end;
$$;

create or replace function public.return_pos_order_pipe(order_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_pos_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  update public.pos_orders
  set pipe_returned = true
  where id = order_id and type = 'full' and status = 'delivered' and pipe_returned = false;

  if not found then return false; end if;

  update public.pos_stock
  set quantity = quantity + 1
  where category = 'equipment'
    and (lower(name) like '%hookah%' or lower(name) like '%rota%' or lower(name) like '%kop%');
  return true;
end;
$$;

create or replace function public.delete_pos_order(order_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  restore_equipment boolean;
begin
  if not private.is_pos_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  delete from public.pos_orders
  where id = order_id
  returning type = 'full' and status = 'delivered' and pipe_returned = false
  into restore_equipment;

  if not found then return false; end if;

  if restore_equipment then
    update public.pos_stock
    set quantity = quantity + 1
    where category = 'equipment'
      and (lower(name) like '%hookah%' or lower(name) like '%rota%' or lower(name) like '%kop%');
  end if;
  return true;
end;
$$;

revoke all on function public.mark_pos_order_delivered(bigint) from public, anon;
revoke all on function public.return_pos_order_pipe(bigint) from public, anon;
revoke all on function public.delete_pos_order(bigint) from public, anon;
grant execute on function public.mark_pos_order_delivered(bigint) to authenticated;
grant execute on function public.return_pos_order_pipe(bigint) to authenticated;
grant execute on function public.delete_pos_order(bigint) to authenticated;
