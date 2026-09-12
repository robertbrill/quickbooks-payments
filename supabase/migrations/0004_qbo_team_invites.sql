-- Track invites and activity so admins can see who has actually signed in.
alter table public.qbo_team
  add column if not exists invited_at   timestamptz,
  add column if not exists invited_by   uuid references auth.users(id) on delete set null,
  add column if not exists last_seen_at timestamptz;

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
    case when exists (select 1 from public.qbo_team where role = 'admin') then 'member' else 'admin' end,
    now()
  )
  on conflict (id) do update set email = excluded.email, last_seen_at = now()
  returning * into r;
  return r;
end;
$$;
