-- =====================================================================
-- Fleet Repair Log — repair outcome, repair type and notes
--
-- Run after 002_fuel.sql.
--   resolution  – was it really fixed? (the old log's "Problem Solved?")
--   repair_type – emergency breakdown vs planned maintenance
--   notes       – tips for next time ("check the keypad wiring first")
-- =====================================================================

alter table public.work_orders
  add column resolution  text check (resolution in ('fixed', 'temporary', 'not_fixed')),
  add column repair_type text not null default 'emergency' check (repair_type in ('emergency', 'maintenance')),
  add column notes       text;

create index work_orders_resolution_idx on public.work_orders (resolution) where resolution <> 'fixed';

-- Scheduled-maintenance work orders are maintenance by definition, and the
-- outcome only means something once the job is closed.
create or replace function public.work_order_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  else
    new.closed_at := null;
    new.resolution := null;
  end if;
  if new.pm_schedule_id is not null then
    new.repair_type := 'maintenance';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Driver reports stay simple: a breakdown with no outcome yet.
alter policy "work_orders: driver reports a truck problem" on public.work_orders
  with check (
    public.app_role() = 'driver'
    and reported_by = (select auth.uid())
    and source = 'driver'
    and status = 'open'
    and assigned_to is null
    and vendor_id is null
    and pm_schedule_id is null
    and labor_hours = 0
    and downtime_hours = 0
    and fix is null
    and resolution is null
    and repair_type = 'emergency'
    and notes is null
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and a.kind = 'truck' and a.retired_at is null
    )
  );
