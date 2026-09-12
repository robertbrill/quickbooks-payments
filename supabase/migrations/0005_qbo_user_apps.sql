-- Per-user app grants. Admins see every app; users see only what they've been granted.
create table if not exists public.qbo_user_apps (
  user_id     uuid not null references auth.users(id) on delete cascade,
  app_key     text not null,
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, app_key)
);

alter table public.qbo_user_apps enable row level security;
revoke all on table public.qbo_user_apps from anon;

drop policy if exists "apps: read own" on public.qbo_user_apps;
create policy "apps: read own" on public.qbo_user_apps
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "apps: admin read all" on public.qbo_user_apps;
create policy "apps: admin read all" on public.qbo_user_apps
  for select to authenticated using (public.qbo_is_admin());

drop policy if exists "apps: admin insert" on public.qbo_user_apps;
create policy "apps: admin insert" on public.qbo_user_apps
  for insert to authenticated with check (public.qbo_is_admin());

drop policy if exists "apps: admin delete" on public.qbo_user_apps;
create policy "apps: admin delete" on public.qbo_user_apps
  for delete to authenticated using (public.qbo_is_admin());

-- True if the caller is an admin, or an active member granted this app.
create or replace function public.qbo_has_app(app text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.qbo_is_admin()
      or exists (
        select 1
        from public.qbo_user_apps a
        join public.qbo_team t on t.id = a.user_id
        where a.user_id = auth.uid()
          and a.app_key = app
          and t.role in ('admin', 'member')
      );
$$;
revoke all on function public.qbo_has_app(text) from public, anon;
grant execute on function public.qbo_has_app(text) to authenticated;

-- Payments data is now gated by the "payments" app grant.
drop policy if exists "payments: team read tracked" on public.qbo_payments;
create policy "payments: team read tracked" on public.qbo_payments
  for select to authenticated using (
    not deleted
    and public.qbo_has_app('payments')
    and exists (
      select 1 from public.qbo_customers c
      where c.id = qbo_payments.customer_id and c.tracked
    )
  );

drop policy if exists "customers: member read tracked" on public.qbo_customers;
create policy "customers: member read tracked" on public.qbo_customers
  for select to authenticated using (tracked and public.qbo_has_app('payments'));

-- Let the home page update live when an admin changes someone's apps.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'qbo_user_apps'
  ) then
    alter publication supabase_realtime add table public.qbo_user_apps;
  end if;
end $$;
