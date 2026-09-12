-- QBO Payment Feed
-- All objects are prefixed qbo_ so this can live alongside other apps in a shared project.

-- ---------------------------------------------------------------------------
-- Team members & roles
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_team (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now()
);

-- First person to sign in becomes admin; everyone after is a member.
create or replace function public.qbo_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.qbo_team (id, email, role)
  values (
    new.id,
    new.email,
    case when exists (select 1 from public.qbo_team where role = 'admin') then 'member' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists qbo_on_auth_user_created on auth.users;
create trigger qbo_on_auth_user_created
  after insert on auth.users
  for each row execute function public.qbo_handle_new_user();

create or replace function public.qbo_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.qbo_team where id = auth.uid() and role = 'admin');
$$;

create or replace function public.qbo_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.qbo_team where id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- QuickBooks connection (tokens). Service-role only — no RLS policies.
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_connections (
  realm_id            text primary key,
  company_name        text,
  environment         text not null default 'production' check (environment in ('sandbox', 'production')),
  access_token        text not null,
  refresh_token       text not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz not null,
  connected_by        uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Short-lived OAuth state tokens. Service-role only.
create table if not exists public.qbo_oauth_states (
  state       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Admin-safe view of the connection (no tokens).
create or replace view public.qbo_connection_status
with (security_invoker = false) as
  select realm_id, company_name, environment, refresh_expires_at, updated_at
  from public.qbo_connections
  where public.qbo_is_admin();

-- ---------------------------------------------------------------------------
-- QuickBooks customers (the "clients" the admin picks from)
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_customers (
  id            text primary key,             -- QBO Customer.Id
  realm_id      text not null,
  display_name  text not null,
  company_name  text,
  email         text,
  active        boolean not null default true,
  tracked       boolean not null default false,
  raw           jsonb,
  synced_at     timestamptz not null default now()
);
create index if not exists qbo_customers_tracked_idx on public.qbo_customers (tracked) where tracked;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table if not exists public.qbo_payments (
  id                text primary key,         -- QBO Payment.Id
  realm_id          text not null,
  customer_id       text,
  customer_name     text,
  total_amount      numeric(14, 2) not null,
  unapplied_amount  numeric(14, 2),
  currency          text,
  txn_date          date,
  payment_method    text,
  reference_number  text,
  private_note      text,
  linked_invoices   jsonb,                    -- [{ invoice_id, doc_number, amount }]
  qbo_created_at    timestamptz,
  qbo_updated_at    timestamptz,
  deleted           boolean not null default false,
  raw               jsonb,
  received_at       timestamptz not null default now(),   -- when we first saw it
  updated_at        timestamptz not null default now()
);
create index if not exists qbo_payments_received_idx on public.qbo_payments (received_at desc);
create index if not exists qbo_payments_customer_idx on public.qbo_payments (customer_id);
create index if not exists qbo_payments_txn_date_idx on public.qbo_payments (txn_date desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.qbo_team          enable row level security;
alter table public.qbo_connections   enable row level security;
alter table public.qbo_oauth_states  enable row level security;
alter table public.qbo_customers     enable row level security;
alter table public.qbo_payments      enable row level security;

-- qbo_team: everyone sees their own row; admins see and manage everyone.
drop policy if exists "team: read own" on public.qbo_team;
create policy "team: read own" on public.qbo_team
  for select to authenticated using (id = auth.uid());

drop policy if exists "team: admin read all" on public.qbo_team;
create policy "team: admin read all" on public.qbo_team
  for select to authenticated using (public.qbo_is_admin());

drop policy if exists "team: admin update" on public.qbo_team;
create policy "team: admin update" on public.qbo_team
  for update to authenticated using (public.qbo_is_admin()) with check (public.qbo_is_admin());

drop policy if exists "team: admin delete" on public.qbo_team;
create policy "team: admin delete" on public.qbo_team
  for delete to authenticated using (public.qbo_is_admin() and id <> auth.uid());

-- qbo_customers: admins see all; members see only tracked clients. Only admins change tracking.
drop policy if exists "customers: admin read" on public.qbo_customers;
create policy "customers: admin read" on public.qbo_customers
  for select to authenticated using (public.qbo_is_admin());

drop policy if exists "customers: member read tracked" on public.qbo_customers;
create policy "customers: member read tracked" on public.qbo_customers
  for select to authenticated using (tracked and public.qbo_is_member());

drop policy if exists "customers: admin update" on public.qbo_customers;
create policy "customers: admin update" on public.qbo_customers
  for update to authenticated using (public.qbo_is_admin()) with check (public.qbo_is_admin());

-- qbo_payments: team sees payments from tracked clients only. Writes come from edge functions (service role).
drop policy if exists "payments: team read tracked" on public.qbo_payments;
create policy "payments: team read tracked" on public.qbo_payments
  for select to authenticated using (
    not deleted
    and public.qbo_is_member()
    and exists (
      select 1 from public.qbo_customers c
      where c.id = qbo_payments.customer_id and c.tracked
    )
  );

-- Realtime: push payment and customer changes to connected clients (RLS still applies).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qbo_payments'
  ) then
    alter publication supabase_realtime add table public.qbo_payments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qbo_customers'
  ) then
    alter publication supabase_realtime add table public.qbo_customers;
  end if;
end $$;

-- Grants for the view
grant select on public.qbo_connection_status to authenticated;
