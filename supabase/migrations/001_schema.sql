-- =====================================================================
-- Fleet Repair Log — complete schema, security and storage
--
-- Run this once in a NEW, empty Supabase project
-- (Dashboard → SQL Editor → paste → Run). It creates every table,
-- turns on Row Level Security everywhere, adds the policies, the
-- inventory/maintenance triggers, the photo storage bucket and
-- realtime. It inserts NO sample data: the only row it creates is
-- the single empty settings row the app needs.
--
-- Roles (stored in public.profiles.role):
--   admin    – everything: costs, reports, setup, people
--   mechanic – work orders, parts used, asset status/mileage
--   driver   – report a problem on a truck (with photo); no cost data
--   pending  – signed up, waiting for an admin to assign a role; sees nothing
-- The FIRST account that signs up becomes admin automatically.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  role        text not null default 'pending'
              check (role in ('admin', 'mechanic', 'driver', 'pending')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Role of the signed-in user, or NULL if not signed in / retired.
-- SECURITY DEFINER so policies can call it without recursing into
-- the profiles policies.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() in ('admin', 'mechanic'), false)
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

revoke execute on function public.app_role(), public.is_staff(), public.is_admin() from public, anon;
grant execute on function public.app_role(), public.is_staff(), public.is_admin() to authenticated;

-- New sign-up → profile row. First person ever becomes admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('fleet_first_admin'));
  select not exists (select 1 from public.profiles where role = 'admin') into first_user;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    new.email,
    case when first_user then 'admin' else 'pending' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change role/active; the last active admin can't be removed.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'Profile id cannot change';
  end if;

  -- auth.uid() is null when run from the SQL editor / service role.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change roles or access';
    end if;
  end if;

  if old.role = 'admin' and old.active
     and (new.role <> 'admin' or not new.active)
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and active and id <> old.id
     ) then
    raise exception 'There must be at least one active admin';
  end if;

  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id                  int primary key default 1 check (id = 1),
  company_name        text,
  default_labor_rate  numeric(10, 2) check (default_labor_rate >= 0),
  setup_dismissed     boolean not null default false,
  updated_at          timestamptz not null default now()
);
insert into public.app_settings (id) values (1);

-- ---------------------------------------------------------------------
-- Assets: trucks and plant equipment
-- ---------------------------------------------------------------------
create table public.assets (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('truck', 'equipment')),
  unit_number     text,
  name            text,
  label           text generated always as (coalesce(unit_number, name)) stored,
  equipment_type  text check (equipment_type in ('washer', 'dryer', 'ironer', 'folder', 'other')),
  year            int check (year between 1950 and 2100),
  make            text,
  model           text,
  vin             text,
  serial_number   text,
  current_mileage int check (current_mileage >= 0),
  status          text not null default 'in_service' check (status in ('in_service', 'down')),
  notes           text,
  retired_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint truck_needs_unit check (kind <> 'truck' or nullif(trim(unit_number), '') is not null),
  constraint equipment_needs_name check (
    kind <> 'equipment' or (nullif(trim(name), '') is not null and equipment_type is not null)
  )
);
create unique index assets_truck_unit_uq on public.assets (lower(unit_number)) where kind = 'truck';
create index assets_kind_idx on public.assets (kind);

-- Purchase / replacement figures are cost data → separate admin-only table.
create table public.asset_financials (
  asset_id          uuid primary key references public.assets (id) on delete cascade,
  purchase_date     date,
  purchase_price    numeric(12, 2) check (purchase_price >= 0),
  replacement_cost  numeric(12, 2) check (replacement_cost >= 0),
  updated_at        timestamptz not null default now()
);

-- Mechanics may only change status and mileage on an asset.
create or replace function public.guard_asset_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed public.assets;
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  allowed := old;
  allowed.status := new.status;
  allowed.current_mileage := new.current_mileage;
  allowed.label := new.label;  -- generated column
  if row(allowed.*) is distinct from row(new.*) then
    raise exception 'Only an admin can edit asset details';
  end if;
  return new;
end;
$$;

create trigger assets_guard
  before update on public.assets
  for each row execute function public.guard_asset_update();

-- ---------------------------------------------------------------------
-- Vendors and parts
-- ---------------------------------------------------------------------
create table public.vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (nullif(trim(name), '') is not null),
  contact_name  text,
  phone         text,
  email         text,
  notes         text,
  retired_at    timestamptz,
  created_at    timestamptz not null default now()
);
create unique index vendors_name_uq on public.vendors (lower(name));

create table public.parts (
  id             uuid primary key default gen_random_uuid(),
  part_number    text not null check (nullif(trim(part_number), '') is not null),
  description    text not null,
  vendor_id      uuid references public.vendors (id) on delete set null,
  unit_cost      numeric(12, 2) not null default 0 check (unit_cost >= 0),
  qty_on_hand    numeric(12, 2) not null default 0,
  reorder_point  numeric(12, 2) not null default 0 check (reorder_point >= 0),
  location       text,
  retired_at     timestamptz,
  created_at     timestamptz not null default now()
);
create unique index parts_number_uq on public.parts (lower(part_number));
create index parts_vendor_idx on public.parts (vendor_id);

-- Which assets a part fits (many-to-many).
create table public.part_fits (
  part_id   uuid not null references public.parts (id) on delete cascade,
  asset_id  uuid not null references public.assets (id) on delete cascade,
  primary key (part_id, asset_id)
);
create index part_fits_asset_idx on public.part_fits (asset_id);

-- ---------------------------------------------------------------------
-- Preventive maintenance
-- ---------------------------------------------------------------------
create table public.pm_schedules (
  id               uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references public.assets (id) on delete cascade,
  task             text not null check (nullif(trim(task), '') is not null),
  interval_miles   int check (interval_miles > 0),
  interval_days    int check (interval_days > 0),
  last_done_miles  int check (last_done_miles >= 0),
  last_done_on     date,
  notes            text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint pm_has_interval check (interval_miles is not null or interval_days is not null)
);
create index pm_schedules_asset_idx on public.pm_schedules (asset_id);

-- ---------------------------------------------------------------------
-- Work orders
-- ---------------------------------------------------------------------
create table public.work_orders (
  id                uuid primary key default gen_random_uuid(),
  number            bigint generated always as identity (start with 1001) unique,
  asset_id          uuid not null references public.assets (id) on delete restrict,
  opened_on         date not null default current_date,
  reported_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  reported_by_name  text,           -- free text, used by CSV import of old records
  assigned_to       uuid references public.profiles (id) on delete set null,
  vendor_id         uuid references public.vendors (id) on delete set null,
  assigned_name     text,           -- free text, used by CSV import of old records
  problem           text not null check (nullif(trim(problem), '') is not null),
  fix               text,
  labor_hours       numeric(8, 2) not null default 0 check (labor_hours >= 0),
  downtime_hours    numeric(8, 2) not null default 0 check (downtime_hours >= 0),
  mileage           int check (mileage >= 0),
  out_of_service    boolean not null default false,
  status            text not null default 'open' check (status in ('open', 'waiting_parts', 'done')),
  pm_schedule_id    uuid references public.pm_schedules (id) on delete set null,
  source            text not null default 'app' check (source in ('app', 'driver', 'import')),
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index work_orders_asset_idx on public.work_orders (asset_id);
create index work_orders_status_idx on public.work_orders (status);
create index work_orders_opened_idx on public.work_orders (opened_on);
create index work_orders_reported_by_idx on public.work_orders (reported_by);
create index work_orders_assigned_idx on public.work_orders (assigned_to);
create index work_orders_vendor_idx on public.work_orders (vendor_id);
create index work_orders_pm_idx on public.work_orders (pm_schedule_id);

-- Cost fields live in their own table so drivers never receive them.
create table public.work_order_costs (
  work_order_id     uuid primary key references public.work_orders (id) on delete cascade,
  labor_rate        numeric(10, 2) not null default 0 check (labor_rate >= 0),
  vendor_cost       numeric(12, 2) not null default 0 check (vendor_cost >= 0),
  other_parts_cost  numeric(12, 2) not null default 0 check (other_parts_cost >= 0), -- parts not from inventory / imported history
  updated_at        timestamptz not null default now()
);

-- Parts pulled from inventory onto a work order.
create table public.work_order_parts (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  part_id        uuid not null references public.parts (id) on delete restrict,
  quantity       numeric(12, 2) not null check (quantity > 0),
  unit_cost      numeric(12, 2) check (unit_cost >= 0),   -- snapshot of the part cost when used
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index work_order_parts_wo_idx on public.work_order_parts (work_order_id);
create index work_order_parts_part_idx on public.work_order_parts (part_id);
create index work_order_parts_created_by_idx on public.work_order_parts (created_by);

create table public.work_order_photos (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  storage_path   text not null unique,
  uploaded_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index work_order_photos_wo_idx on public.work_order_photos (work_order_id);
create index work_order_photos_uploader_idx on public.work_order_photos (uploaded_by);

-- ---------------------------------------------------------------------
-- Work order triggers
-- ---------------------------------------------------------------------

-- Keep closed_at / updated_at in sync with status.
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
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger work_orders_before_write
  before insert or update on public.work_orders
  for each row execute function public.work_order_before_write();

-- After a work order is saved:
--  * create its cost row with the default labor rate
--  * push a higher mileage reading onto the truck
--  * mark the asset down if the reporter said it's out of service
--  * when a PM work order is completed, reset that PM schedule
create or replace function public.work_order_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.work_order_costs (work_order_id, labor_rate)
    values (new.id, coalesce((select default_labor_rate from public.app_settings where id = 1), 0))
    on conflict (work_order_id) do nothing;

    if new.out_of_service and new.status <> 'done' then
      update public.assets set status = 'down' where id = new.asset_id and status <> 'down';
    end if;
  end if;

  if new.mileage is not null then
    update public.assets
       set current_mileage = new.mileage
     where id = new.asset_id
       and kind = 'truck'
       and (current_mileage is null or current_mileage < new.mileage);
  end if;

  if new.status = 'done' and new.pm_schedule_id is not null
     and (tg_op = 'INSERT' or old.status <> 'done' or old.pm_schedule_id is distinct from new.pm_schedule_id) then
    update public.pm_schedules s
       set last_done_on    = coalesce(new.closed_at::date, current_date),
           last_done_miles = coalesce(new.mileage, (select a.current_mileage from public.assets a where a.id = new.asset_id), s.last_done_miles)
     where s.id = new.pm_schedule_id;
  end if;

  return null;
end;
$$;

create trigger work_orders_after_write
  after insert or update on public.work_orders
  for each row execute function public.work_order_after_write();

-- Using a part deducts it from stock; removing/editing the line puts it back.
create or replace function public.work_order_parts_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_cost is null or (tg_op = 'UPDATE' and new.part_id <> old.part_id) then
    select p.unit_cost into new.unit_cost from public.parts p where p.id = new.part_id;
  end if;
  return new;
end;
$$;

create trigger work_order_parts_before_write
  before insert or update on public.work_order_parts
  for each row execute function public.work_order_parts_before_write();

create or replace function public.work_order_parts_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.parts set qty_on_hand = qty_on_hand + old.quantity where id = old.part_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.parts set qty_on_hand = qty_on_hand - new.quantity where id = new.part_id;
  end if;
  return null;
end;
$$;

create trigger work_order_parts_stock
  after insert or update or delete on public.work_order_parts
  for each row execute function public.work_order_parts_stock();

-- Receiving stock adds atomically, so a part used on a work order at the
-- same moment isn't lost. Runs as the caller: only admins pass parts RLS.
create or replace function public.receive_part(p_part_id uuid, p_qty numeric, p_unit_cost numeric default null)
returns public.parts
language plpgsql
set search_path = ''
as $$
declare
  result public.parts;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be more than zero';
  end if;
  update public.parts
     set qty_on_hand = qty_on_hand + p_qty,
         unit_cost   = coalesce(p_unit_cost, unit_cost)
   where id = p_part_id
  returning * into result;
  if result.id is null then
    raise exception 'Part not found or not allowed';
  end if;
  return result;
end;
$$;

revoke execute on function public.receive_part(uuid, numeric, numeric) from public, anon;
grant execute on function public.receive_part(uuid, numeric, numeric) to authenticated;

-- Generic updated_at
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger work_order_costs_touch before update on public.work_order_costs
  for each row execute function public.touch_updated_at();
create trigger asset_financials_touch before update on public.asset_financials
  for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- Trigger functions are not meant to be called directly.
revoke execute on function
  public.handle_new_user(), public.guard_profile_update(), public.guard_asset_update(),
  public.work_order_before_write(), public.work_order_after_write(),
  public.work_order_parts_before_write(), public.work_order_parts_stock(),
  public.touch_updated_at()
from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Reporting view (respects the caller's RLS: drivers see zero costs)
-- ---------------------------------------------------------------------
create view public.work_order_totals
with (security_invoker = true) as
select
  w.id,
  w.number,
  w.asset_id,
  w.opened_on,
  w.status,
  w.labor_hours,
  w.downtime_hours,
  round(w.labor_hours * coalesce(c.labor_rate, 0), 2)                     as labor_cost,
  coalesce(p.parts_cost, 0) + coalesce(c.other_parts_cost, 0)              as parts_cost,
  coalesce(c.vendor_cost, 0)                                               as vendor_cost,
  round(w.labor_hours * coalesce(c.labor_rate, 0), 2)
    + coalesce(p.parts_cost, 0) + coalesce(c.other_parts_cost, 0)
    + coalesce(c.vendor_cost, 0)                                           as total_cost
from public.work_orders w
left join public.work_order_costs c on c.work_order_id = w.id
left join (
  select work_order_id, sum(quantity * coalesce(unit_cost, 0)) as parts_cost
  from public.work_order_parts
  group by work_order_id
) p on p.work_order_id = w.id;

-- ---------------------------------------------------------------------
-- Row Level Security — on for every table
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.app_settings      enable row level security;
alter table public.assets            enable row level security;
alter table public.asset_financials  enable row level security;
alter table public.vendors           enable row level security;
alter table public.parts             enable row level security;
alter table public.part_fits         enable row level security;
alter table public.pm_schedules      enable row level security;
alter table public.work_orders       enable row level security;
alter table public.work_order_costs  enable row level security;
alter table public.work_order_parts  enable row level security;
alter table public.work_order_photos enable row level security;

-- Nothing is readable without signing in.
revoke all on all tables in schema public from anon;

-- profiles
create policy "profiles: read own or any if approved" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.app_role() in ('admin', 'mechanic', 'driver'));
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- app_settings
create policy "settings: staff read" on public.app_settings
  for select to authenticated using (public.is_staff());
create policy "settings: admin update" on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- assets
create policy "assets: approved users read" on public.assets
  for select to authenticated using (public.app_role() in ('admin', 'mechanic', 'driver'));
create policy "assets: admin insert" on public.assets
  for insert to authenticated with check (public.is_admin());
create policy "assets: staff update" on public.assets
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "assets: admin delete" on public.assets
  for delete to authenticated using (public.is_admin());

-- asset_financials
create policy "asset_financials: admin all" on public.asset_financials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- vendors
create policy "vendors: staff read" on public.vendors
  for select to authenticated using (public.is_staff());
create policy "vendors: admin insert" on public.vendors
  for insert to authenticated with check (public.is_admin());
create policy "vendors: admin update" on public.vendors
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "vendors: admin delete" on public.vendors
  for delete to authenticated using (public.is_admin());

-- parts
create policy "parts: staff read" on public.parts
  for select to authenticated using (public.is_staff());
create policy "parts: admin insert" on public.parts
  for insert to authenticated with check (public.is_admin());
create policy "parts: admin update" on public.parts
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "parts: admin delete" on public.parts
  for delete to authenticated using (public.is_admin());

-- part_fits
create policy "part_fits: staff read" on public.part_fits
  for select to authenticated using (public.is_staff());
create policy "part_fits: admin insert" on public.part_fits
  for insert to authenticated with check (public.is_admin());
create policy "part_fits: admin delete" on public.part_fits
  for delete to authenticated using (public.is_admin());

-- pm_schedules
create policy "pm: staff read" on public.pm_schedules
  for select to authenticated using (public.is_staff());
create policy "pm: admin insert" on public.pm_schedules
  for insert to authenticated with check (public.is_admin());
create policy "pm: admin update" on public.pm_schedules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "pm: admin delete" on public.pm_schedules
  for delete to authenticated using (public.is_admin());

-- work_orders
create policy "work_orders: staff read all, drivers read own" on public.work_orders
  for select to authenticated
  using (
    public.is_staff()
    or (public.app_role() = 'driver' and reported_by = (select auth.uid()))
  );
create policy "work_orders: staff insert" on public.work_orders
  for insert to authenticated with check (public.is_staff());
create policy "work_orders: driver reports a truck problem" on public.work_orders
  for insert to authenticated
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
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and a.kind = 'truck' and a.retired_at is null
    )
  );
create policy "work_orders: staff update" on public.work_orders
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "work_orders: admin delete" on public.work_orders
  for delete to authenticated using (public.is_admin());

-- work_order_costs (never visible to drivers)
create policy "costs: staff read" on public.work_order_costs
  for select to authenticated using (public.is_staff());
create policy "costs: staff insert" on public.work_order_costs
  for insert to authenticated with check (public.is_staff());
create policy "costs: staff update" on public.work_order_costs
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- work_order_parts (never visible to drivers)
create policy "wo_parts: staff read" on public.work_order_parts
  for select to authenticated using (public.is_staff());
create policy "wo_parts: staff insert" on public.work_order_parts
  for insert to authenticated with check (public.is_staff());
create policy "wo_parts: staff update" on public.work_order_parts
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "wo_parts: staff delete" on public.work_order_parts
  for delete to authenticated using (public.is_staff());

-- work_order_photos: anyone who can see the work order can see/add photos
create policy "photos: read if work order visible" on public.work_order_photos
  for select to authenticated
  using (exists (select 1 from public.work_orders w where w.id = work_order_id));
create policy "photos: add if work order visible" on public.work_order_photos
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and public.app_role() in ('admin', 'mechanic', 'driver')
    and exists (select 1 from public.work_orders w where w.id = work_order_id)
  );
create policy "photos: staff or uploader delete" on public.work_order_photos
  for delete to authenticated
  using (public.is_staff() or uploaded_by = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Photo storage (private bucket; path = <work_order_id>/<file>)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-order-photos', 'work-order-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "wo photos: read if work order visible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-order-photos'
    and exists (
      select 1 from public.work_orders w
      where w.id::text = (storage.foldername(name))[1]
    )
  );
create policy "wo photos: upload if work order visible" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-order-photos'
    and public.app_role() in ('admin', 'mechanic', 'driver')
    and exists (
      select 1 from public.work_orders w
      where w.id::text = (storage.foldername(name))[1]
    )
  );
create policy "wo photos: staff or owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-order-photos'
    and (public.is_staff() or owner_id = (select auth.uid())::text)
  );

-- ---------------------------------------------------------------------
-- Realtime: every device gets changes immediately (RLS still applies)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.profiles,
  public.app_settings,
  public.assets,
  public.vendors,
  public.parts,
  public.part_fits,
  public.pm_schedules,
  public.work_orders,
  public.work_order_costs,
  public.work_order_parts,
  public.work_order_photos;
