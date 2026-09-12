-- Replace the security-definer view with an admin-only function, and keep every
-- qbo_ object off the anonymous API surface.
drop view if exists public.qbo_connection_status;

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
  where public.qbo_is_admin()
  order by c.updated_at desc;
$$;

revoke all on function public.qbo_connection_status() from public, anon;
grant execute on function public.qbo_connection_status() to authenticated;

revoke all on function public.qbo_join() from public, anon;
revoke all on function public.qbo_is_admin() from public, anon;
revoke all on function public.qbo_is_member() from public, anon;
grant execute on function public.qbo_is_admin() to authenticated;
grant execute on function public.qbo_is_member() to authenticated;

revoke all on table public.qbo_team, public.qbo_connections, public.qbo_oauth_states,
  public.qbo_customers, public.qbo_payments from anon;
-- Tokens and OAuth state are only ever touched by edge functions (service role).
revoke all on table public.qbo_connections, public.qbo_oauth_states from authenticated;
