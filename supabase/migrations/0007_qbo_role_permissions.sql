-- Which functions each account type may use. Owners always have everything.
create table if not exists public.qbo_role_permissions (
  role        text not null check (role in ('admin', 'member')),
  permission  text not null,
  primary key (role, permission)
);

alter table public.qbo_role_permissions enable row level security;
revoke all on table public.qbo_role_permissions from anon;

drop policy if exists "perms: read" on public.qbo_role_permissions;
create policy "perms: read" on public.qbo_role_permissions
  for select to authenticated using (public.qbo_is_member());

drop policy if exists "perms: owner insert" on public.qbo_role_permissions;
create policy "perms: owner insert" on public.qbo_role_permissions
  for insert to authenticated with check (public.qbo_is_owner());

drop policy if exists "perms: owner delete" on public.qbo_role_permissions;
create policy "perms: owner delete" on public.qbo_role_permissions
  for delete to authenticated using (public.qbo_is_owner());

-- Defaults: admins can do everything an owner can except manage owners; users nothing.
insert into public.qbo_role_permissions (role, permission) values
  ('admin', 'manage_users'),
  ('admin', 'manage_app_access'),
  ('admin', 'manage_quickbooks'),
  ('admin', 'manage_clients')
on conflict do nothing;

create or replace function public.qbo_can(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.qbo_team t
    where t.id = auth.uid()
      and (
        t.role = 'owner'
        or exists (
          select 1 from public.qbo_role_permissions p
          where p.role = t.role and p.permission = perm
        )
      )
  );
$$;
revoke all on function public.qbo_can(text) from public, anon;
grant execute on function public.qbo_can(text) to authenticated;

-- Re-point policies at specific permissions.
drop policy if exists "team: admin read all" on public.qbo_team;
create policy "team: admin read all" on public.qbo_team
  for select to authenticated using (public.qbo_can('manage_users') or public.qbo_can('manage_app_access'));

drop policy if exists "team: admin update" on public.qbo_team;
create policy "team: admin update" on public.qbo_team
  for update to authenticated
  using (public.qbo_can('manage_users') and (role <> 'owner' or public.qbo_is_owner()))
  with check (public.qbo_can('manage_users') and (role <> 'owner' or public.qbo_is_owner()));

drop policy if exists "apps: admin read all" on public.qbo_user_apps;
create policy "apps: admin read all" on public.qbo_user_apps
  for select to authenticated using (public.qbo_can('manage_app_access'));

drop policy if exists "apps: admin insert" on public.qbo_user_apps;
create policy "apps: admin insert" on public.qbo_user_apps
  for insert to authenticated with check (public.qbo_can('manage_app_access'));

drop policy if exists "apps: admin delete" on public.qbo_user_apps;
create policy "apps: admin delete" on public.qbo_user_apps
  for delete to authenticated using (public.qbo_can('manage_app_access'));

drop policy if exists "customers: admin read" on public.qbo_customers;
create policy "customers: admin read" on public.qbo_customers
  for select to authenticated using (public.qbo_can('manage_clients'));

drop policy if exists "customers: admin update" on public.qbo_customers;
create policy "customers: admin update" on public.qbo_customers
  for update to authenticated using (public.qbo_can('manage_clients')) with check (public.qbo_can('manage_clients'));

create or replace function public.qbo_connection_status()
returns table (
  realm_id text,
  company_name text,
  environment text,
  refresh_expires_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.realm_id, c.company_name, c.environment, c.refresh_expires_at, c.updated_at
  from public.qbo_connections c
  where public.qbo_can('manage_quickbooks')
  order by c.updated_at desc;
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qbo_role_permissions'
  ) then
    alter publication supabase_realtime add table public.qbo_role_permissions;
  end if;
end $$;
