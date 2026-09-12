-- Non-owners may only grant or revoke apps they themselves have access to.
drop policy if exists "apps: admin insert" on public.qbo_user_apps;
create policy "apps: admin insert" on public.qbo_user_apps
  for insert to authenticated
  with check (public.qbo_can('manage_app_access') and (public.qbo_is_owner() or public.qbo_has_app(app_key)));

drop policy if exists "apps: admin delete" on public.qbo_user_apps;
create policy "apps: admin delete" on public.qbo_user_apps
  for delete to authenticated
  using (public.qbo_can('manage_app_access') and (public.qbo_is_owner() or public.qbo_has_app(app_key)));
