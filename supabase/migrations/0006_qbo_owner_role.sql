-- Add the owner role. Owners automatically see every app; admins and users need grants.
alter table public.qbo_team drop constraint if exists qbo_team_role_check;
alter table public.qbo_team add constraint qbo_team_role_check
  check (role in ('owner', 'admin', 'member', 'blocked'));

create or replace function public.qbo_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.qbo_team where id = auth.uid() and role = 'owner');
$$;
revoke all on function public.qbo_is_owner() from public, anon;
grant execute on function public.qbo_is_owner() to authenticated;

-- "Admin" checks now include owners.
create or replace function public.qbo_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.qbo_team where id = auth.uid() and role in ('owner', 'admin'));
$$;

create or replace function public.qbo_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.qbo_team where id = auth.uid() and role in ('owner', 'admin', 'member'));
$$;

-- Only owners get every app for free.
create or replace function public.qbo_has_app(app text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.qbo_is_owner()
      or exists (
        select 1
        from public.qbo_user_apps a
        join public.qbo_team t on t.id = a.user_id
        where a.user_id = auth.uid()
          and a.app_key = app
          and t.role in ('owner', 'admin', 'member')
      );
$$;

-- First person ever becomes owner (was admin).
create or replace function public.qbo_join()
returns public.qbo_team
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  em  text;
  r   public.qbo_team;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  select email into em from auth.users where id = uid;
  insert into public.qbo_team (id, email, role, last_seen_at)
  values (
    uid,
    em,
    case when exists (select 1 from public.qbo_team where role in ('owner', 'admin')) then 'member' else 'owner' end,
    now()
  )
  on conflict (id) do update set email = excluded.email, last_seen_at = now()
  returning * into r;
  return r;
end;
$$;

-- Admins can change roles, but only owners can touch owner rows or assign the owner role.
drop policy if exists "team: admin update" on public.qbo_team;
create policy "team: admin update" on public.qbo_team
  for update to authenticated
  using (public.qbo_is_admin() and (role <> 'owner' or public.qbo_is_owner()))
  with check (public.qbo_is_admin() and (role <> 'owner' or public.qbo_is_owner()));

-- Robert's accounts become owners.
update public.qbo_team set role = 'owner'
where lower(email) in ('rbrill2030@gmail.com', 'robert@brillmedia.co');
