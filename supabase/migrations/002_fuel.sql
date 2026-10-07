-- =====================================================================
-- Fleet Repair Log — fuel tracking
--
-- Run after 001_schema.sql. One row per fill-up with a single odometer
-- reading; miles and MPG are worked out from the previous fill-up, so
-- nobody has to go back and edit an earlier row.
--
-- Who can do what:
--   admin / mechanic – log, see and correct every fill-up
--   driver           – log fill-ups and see only their own; can fix a typo
--                      on their own entry for 24 hours
-- =====================================================================

create table public.fuel_logs (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid references public.assets (id) on delete restrict,
  vehicle_label  text,            -- rentals / vehicles not in the fleet (no MPG tracking)
  filled_on      date not null default current_date,
  odometer       int check (odometer >= 0),
  gallons        numeric(8, 3) not null check (gallons > 0 and gallons < 500),
  total_cost     numeric(10, 2) not null check (total_cost >= 0),
  full_tank      boolean not null default true,
  location       text,
  notes          text,
  receipt_path   text unique,     -- <fuel_log_id>/<file> in the fuel-receipts bucket
  entered_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  source         text not null default 'app' check (source in ('app', 'import')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fuel_needs_vehicle check (asset_id is not null or nullif(trim(vehicle_label), '') is not null)
);
create index fuel_logs_asset_idx on public.fuel_logs (asset_id, filled_on);
create index fuel_logs_filled_idx on public.fuel_logs (filled_on);
create index fuel_logs_entered_by_idx on public.fuel_logs (entered_by);

-- Who entered it and when can't be rewritten.
create or replace function public.fuel_log_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := old.created_at;
  new.entered_by := old.entered_by;
  new.source     := old.source;
  new.updated_at := now();
  return new;
end;
$$;

create trigger fuel_logs_before_update
  before update on public.fuel_logs
  for each row execute function public.fuel_log_before_update();

-- A fill-up odometer reading keeps the truck's mileage current (which drives
-- mileage-based maintenance). Jumps of more than 3,000 miles are ignored so a
-- typo like 1,089,070 for 108,907 can't push every oil change overdue; the app
-- flags those entries for checking instead.
create or replace function public.fuel_log_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.odometer is not null and new.asset_id is not null then
    update public.assets
       set current_mileage = new.odometer
     where id = new.asset_id
       and kind = 'truck'
       and (current_mileage is null
            or (new.odometer > current_mileage and new.odometer - current_mileage <= 3000));
  end if;
  return null;
end;
$$;

create trigger fuel_logs_after_write
  after insert or update on public.fuel_logs
  for each row execute function public.fuel_log_after_write();

revoke execute on function public.fuel_log_before_update(), public.fuel_log_after_write()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.fuel_logs enable row level security;
revoke all on public.fuel_logs from anon;

create policy "fuel: staff read all, drivers read own" on public.fuel_logs
  for select to authenticated
  using (
    public.is_staff()
    or (public.app_role() = 'driver' and entered_by = (select auth.uid()))
  );

create policy "fuel: staff insert" on public.fuel_logs
  for insert to authenticated with check (public.is_staff());

create policy "fuel: driver logs a fill-up" on public.fuel_logs
  for insert to authenticated
  with check (
    public.app_role() = 'driver'
    and entered_by = (select auth.uid())
    and source = 'app'
    and (
      asset_id is null
      or exists (
        select 1 from public.assets a
        where a.id = asset_id and a.kind = 'truck' and a.retired_at is null
      )
    )
  );

create policy "fuel: staff update" on public.fuel_logs
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "fuel: driver fixes own entry within 24h" on public.fuel_logs
  for update to authenticated
  using (
    public.app_role() = 'driver'
    and entered_by = (select auth.uid())
    and created_at > now() - interval '24 hours'
  )
  with check (
    public.app_role() = 'driver'
    and entered_by = (select auth.uid())
    and (
      asset_id is null
      or exists (
        select 1 from public.assets a
        where a.id = asset_id and a.kind = 'truck' and a.retired_at is null
      )
    )
  );

create policy "fuel: admin or own-within-24h delete" on public.fuel_logs
  for delete to authenticated
  using (
    public.is_admin()
    or (
      public.app_role() in ('mechanic', 'driver')
      and entered_by = (select auth.uid())
      and created_at > now() - interval '24 hours'
    )
  );

-- ---------------------------------------------------------------------
-- Receipt photos (private bucket; path = <fuel_log_id>/<file>, and the
-- path must match the one recorded on the fill-up)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fuel-receipts', 'fuel-receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

create policy "fuel receipts: read if fill-up visible" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fuel-receipts'
    and exists (select 1 from public.fuel_logs f where f.receipt_path = name)
  );
create policy "fuel receipts: upload to own fill-up" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fuel-receipts'
    and public.app_role() in ('admin', 'mechanic', 'driver')
    and exists (select 1 from public.fuel_logs f where f.receipt_path = name)
  );
create policy "fuel receipts: staff or owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'fuel-receipts'
    and (public.is_staff() or owner_id = (select auth.uid())::text)
  );

alter publication supabase_realtime add table public.fuel_logs;
